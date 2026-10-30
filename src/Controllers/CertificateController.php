<?php

declare(strict_types=1);

namespace AgriPass\Controllers;

use AgriPass\Core\AuditLog;
use AgriPass\Core\Auth;
use AgriPass\Core\Database;
use AgriPass\Core\HttpException;
use AgriPass\Core\Request;
use AgriPass\Core\Response;
use AgriPass\Services\CertificateMailer;
use AgriPass\Services\CertificatePdf;
use AgriPass\Services\CertificateService;
use AgriPass\Services\EventContext;
use AgriPass\Services\QrToken;

final class CertificateController
{
    /** Each issue call renders and emails at most this many PDFs so requests stay well under PHP/HTTP timeouts. */
    private const ISSUE_BATCH = 20;
    private const MAX_SIGNATURE_BYTES = 2 * 1024 * 1024;
    private const SIGNATURE_MAX_WIDTH = 800;

    public static function index(Request $request): void
    {
        Auth::require(Auth::ADMINS);
        $event = EventContext::find($request->param('id'));
        $rows = CertificateService::eligibility($event);

        $public = array_map(static function (array $r): array {
            unset($r['qr_token']);
            return $r;
        }, $rows);

        Response::json([
            'summary' => [
                'registrations' => count($rows),
                'eligible' => count(array_filter($rows, static fn ($r) => $r['eligible'])),
                'issued' => count(array_filter($rows, static fn ($r) => $r['certificate_id'] !== null && $r['revoked_at'] === null)),
                'pending' => count(self::issuable($rows)),
                'revoked' => count(array_filter($rows, static fn ($r) => $r['revoked_at'] !== null)),
            ],
            'settings' => [
                'cpd_units' => $event['cpd_units'],
                'cpd_min_attendance_pct' => (int) $event['cpd_min_attendance_pct'],
                'prc_accreditation_no' => $event['prc_accreditation_no'],
                'signatory_name' => $event['cert_signatory_name'],
                'signatory_title' => $event['cert_signatory_title'],
                'has_signature' => CertificatePdf::signatureFile($event['cert_signature_path']) !== null,
            ],
            'can_issue' => self::issueBlocker($event),
            'certificates' => $public,
        ]);
    }

    /** Issues (and emails) the next batch of certificates. The client repeats the call until `remaining` is 0. */
    public static function issue(Request $request): void
    {
        $user = Auth::require(Auth::ADMINS);
        $event = EventContext::find($request->param('id'));
        $blocker = self::issueBlocker($event);
        if ($blocker !== null) {
            throw new HttpException(409, $blocker);
        }

        $pending = self::issuable(CertificateService::eligibility($event));
        $onlyId = $request->input('registration_id');
        if ($onlyId !== null) {
            $pending = array_values(array_filter($pending, static fn ($r) => $r['registration_id'] === (int) $onlyId));
            if (!$pending) {
                throw new HttpException(409, 'This attendee does not meet the certificate requirements or already has a certificate.');
            }
        }

        $batch = array_slice($pending, 0, self::ISSUE_BATCH);
        $issued = 0;
        $emailed = 0;
        foreach ($batch as $row) {
            $certificate = CertificateService::issue($event, $row, $user['user_id']);
            $issued++;
            if (CertificateMailer::send($certificate, $event, CertificateService::pdf($certificate, $event))) {
                Database::run('UPDATE certificates SET emailed_at = NOW() WHERE certificate_id = ?', [$certificate['certificate_id']]);
                $emailed++;
            }
        }

        if ($issued) {
            AuditLog::record($user['user_id'], 'certificate.issue', 'event', (int) $event['event_id'], ['issued' => $issued, 'emailed' => $emailed]);
        }
        Response::json(['issued' => $issued, 'emailed' => $emailed, 'remaining' => count($pending) - $issued]);
    }

    /** Sample PDF so admins can check the layout and signature before issuing. */
    public static function preview(Request $request): void
    {
        Auth::require(Auth::ADMINS);
        $event = EventContext::find($request->param('id'));
        $sessions = (int) Database::one('SELECT COUNT(*) AS total FROM event_sessions WHERE event_id = ?', [$event['event_id']])['total'];
        $sample = [
            'attendee_name' => 'Juan Dela Cruz',
            'prc_license_number' => '0012345',
            'certificate_no' => sprintf('PAA-%s-%03d-00000', substr($event['start_date'], 0, 4), $event['event_id']),
            'verification_code' => 'SAMPLE0000000000',
            'cpd_units' => $event['cpd_units'],
            'sessions_attended' => $sessions,
            'sessions_total' => $sessions,
            'issued_at' => date('Y-m-d H:i:s'),
        ];
        self::sendPdf(CertificateService::pdf($sample, $event, sample: true), 'certificate-sample.pdf', inline: true);
    }

    /** Admin copy of an issued certificate. */
    public static function show(Request $request): void
    {
        Auth::require(Auth::ADMINS);
        $certificate = self::findOr404($request->param('id'));
        $event = EventContext::find((int) $certificate['event_id']);
        self::sendPdf(CertificateService::pdf($certificate, $event), "{$certificate['certificate_no']}.pdf", inline: true);
    }

    public static function resend(Request $request): void
    {
        $user = Auth::require(Auth::ADMINS);
        $certificate = self::findOr404($request->param('id'));
        if ($certificate['revoked_at'] !== null) {
            throw new HttpException(409, 'This certificate has been revoked.');
        }
        $event = EventContext::find((int) $certificate['event_id']);
        if (!CertificateMailer::send($certificate, $event, CertificateService::pdf($certificate, $event))) {
            throw new HttpException(502, 'The email could not be sent. Check the mail server settings and try again.');
        }
        Database::run('UPDATE certificates SET emailed_at = NOW() WHERE certificate_id = ?', [$certificate['certificate_id']]);
        AuditLog::record($user['user_id'], 'certificate.resend', 'certificate', (int) $certificate['certificate_id']);
        Response::json(['ok' => true]);
    }

    public static function revoke(Request $request): void
    {
        $user = Auth::require(Auth::ADMINS);
        $certificate = self::findOr404($request->param('id'));
        $reason = (string) $request->validate(['reason' => 'required'])['reason'];
        if ($certificate['revoked_at'] !== null) {
            throw new HttpException(409, 'This certificate is already revoked.');
        }
        Database::run(
            'UPDATE certificates SET revoked_at = NOW(), revoked_reason = ? WHERE certificate_id = ?',
            [mb_substr($reason, 0, 255), $certificate['certificate_id']],
        );
        AuditLog::record($user['user_id'], 'certificate.revoke', 'certificate', (int) $certificate['certificate_id'], ['reason' => $reason]);
        Response::json(['ok' => true]);
    }

    /** Public: the attendee's own certificate, authorised by their signed pass token. */
    public static function download(Request $request): void
    {
        $token = (string) $request->query('token', '');
        $registration = QrToken::parse($token) === null
            ? null
            : Database::one('SELECT registration_id FROM registrations WHERE qr_token = ?', [$token]);
        $certificate = $registration ? CertificateService::forRegistration((int) $registration['registration_id']) : null;
        if ($certificate === null || $certificate['revoked_at'] !== null) {
            throw new HttpException(404, 'No certificate is available for this pass.');
        }
        $event = EventContext::find((int) $certificate['event_id']);
        self::sendPdf(CertificateService::pdf($certificate, $event), "{$certificate['certificate_no']}.pdf", inline: false);
    }

    /** Public verification of a printed certificate. Only shows what is already printed on it. */
    public static function verify(Request $request): void
    {
        $code = strtoupper(trim((string) $request->query('code', '')));
        $certificate = preg_match('/^[0-9A-F]{16}$/', $code) ? CertificateService::byCode($code) : null;
        if ($certificate === null) {
            throw new HttpException(404, 'No certificate matches this verification code.');
        }
        $event = EventContext::find((int) $certificate['event_id']);

        Response::json(['certificate' => [
            'status' => $certificate['revoked_at'] === null ? 'valid' : 'revoked',
            'certificate_no' => $certificate['certificate_no'],
            'attendee_name' => $certificate['attendee_name'],
            'prc_license_number' => $certificate['prc_license_number'],
            'cpd_units' => $certificate['cpd_units'],
            'sessions_attended' => (int) $certificate['sessions_attended'],
            'sessions_total' => (int) $certificate['sessions_total'],
            'issued_at' => $certificate['issued_at'],
            'revoked_at' => $certificate['revoked_at'],
            'event_title' => $event['title'],
            'event_venue' => $event['venue'],
            'event_start_date' => $event['start_date'],
            'event_end_date' => $event['end_date'],
            'prc_accreditation_no' => $event['prc_accreditation_no'],
        ]]);
    }

    /** Multipart upload of the signatory's signature image; re-encoded as PNG to strip metadata and anything else embedded. */
    public static function uploadSignature(Request $request): void
    {
        $user = Auth::require(Auth::ADMINS);
        $event = EventContext::find($request->param('id'));
        EventContext::assertEditable($event);

        $file = $_FILES['signature'] ?? null;
        if (!is_array($file) || ($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
            throw new HttpException(422, 'Validation failed.', ['signature' => 'Choose a PNG or JPEG image.']);
        }
        if ($file['size'] > self::MAX_SIGNATURE_BYTES) {
            throw new HttpException(422, 'Validation failed.', ['signature' => 'The image must be 2 MB or smaller.']);
        }
        $info = @getimagesize($file['tmp_name']);
        $image = match ($info[2] ?? null) {
            IMAGETYPE_PNG => @imagecreatefrompng($file['tmp_name']),
            IMAGETYPE_JPEG => @imagecreatefromjpeg($file['tmp_name']),
            default => false,
        };
        if ($image === false) {
            throw new HttpException(422, 'Validation failed.', ['signature' => 'Choose a PNG or JPEG image.']);
        }

        if (imagesx($image) > self::SIGNATURE_MAX_WIDTH) {
            $image = imagescale($image, self::SIGNATURE_MAX_WIDTH);
        }
        imagealphablending($image, false);
        imagesavealpha($image, true);

        $relative = sprintf('storage/uploads/signatures/event-%d-%s.png', $event['event_id'], bin2hex(random_bytes(4)));
        $absolute = dirname(__DIR__, 2) . '/' . $relative;
        if (!is_dir(dirname($absolute))) {
            mkdir(dirname($absolute), 0775, true);
        }
        imagepng($image, $absolute);

        $previous = CertificatePdf::signatureFile($event['cert_signature_path']);
        Database::run('UPDATE events SET cert_signature_path = ? WHERE event_id = ?', [$relative, $event['event_id']]);
        if ($previous !== null) {
            @unlink($previous);
        }
        AuditLog::record($user['user_id'], 'event.signature', 'event', (int) $event['event_id']);
        Response::json(['ok' => true]);
    }

    private static function issueBlocker(array $event): ?string
    {
        return match (true) {
            $event['status'] !== 'Completed' => $event['status'] === 'Archived'
                ? 'Certificates cannot be issued for an archived event.'
                : 'Mark the event as Completed before issuing certificates, so attendance is final.',
            empty($event['cert_signatory_name']) => 'Add the certificate signatory in the event settings first.',
            default => null,
        };
    }

    private static function issuable(array $rows): array
    {
        return array_values(array_filter($rows, static fn ($r) => $r['eligible'] && $r['certificate_id'] === null));
    }

    private static function findOr404(int $id): array
    {
        $certificate = CertificateService::find($id);
        if ($certificate === null) {
            throw new HttpException(404, 'Certificate not found.');
        }

        return $certificate;
    }

    private static function sendPdf(string $pdf, string $filename, bool $inline): void
    {
        header('Content-Type: application/pdf');
        header('Content-Disposition: ' . ($inline ? 'inline' : 'attachment') . '; filename="' . $filename . '"');
        header('Content-Length: ' . strlen($pdf));
        header('Cache-Control: private, no-store');
        echo $pdf;
    }
}
