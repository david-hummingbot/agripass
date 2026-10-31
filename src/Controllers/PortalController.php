<?php

declare(strict_types=1);

namespace AgriPass\Controllers;

use AgriPass\Core\AuditLog;
use AgriPass\Core\Database;
use AgriPass\Core\HttpException;
use AgriPass\Core\MemberAuth;
use AgriPass\Core\RateLimiter;
use AgriPass\Core\Request;
use AgriPass\Core\Response;
use AgriPass\Services\CertificateService;
use AgriPass\Services\MemberProfile;
use AgriPass\Services\PortalMailer;
use PDOException;

/** Self-service for members: sign-in links, profile, registrations, passes and certificates. */
final class PortalController
{
    private const LINKS_PER_MEMBER = 3;

    /** Always answers the same way, so it can't be used to find out who is a member. */
    public static function requestLink(Request $request): void
    {
        RateLimiter::assertUnder('portal.link_requested', 5, 15);
        $email = strtolower((string) $request->validate(['email' => 'required'])['email']);
        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
            throw new HttpException(422, 'Validation failed.', ['email' => 'Enter a valid email address.']);
        }
        AuditLog::record(null, 'portal.link_requested');

        $member = Database::one('SELECT member_id, first_name, last_name, email FROM members WHERE email = ?', [$email]);
        if ($member !== null) {
            $recent = (int) Database::one(
                'SELECT COUNT(*) AS total FROM member_login_tokens WHERE member_id = ? AND created_at > NOW() - INTERVAL 15 MINUTE',
                [$member['member_id']],
            )['total'];
            if ($recent < self::LINKS_PER_MEMBER) {
                PortalMailer::sendLoginLink($member, MemberAuth::createLoginToken((int) $member['member_id']));
            }
        }

        Response::json(['message' => "If {$email} is registered with AgriPass, a sign-in link is on its way. Check your inbox."]);
    }

    public static function signIn(Request $request): void
    {
        RateLimiter::assertUnder('portal.signin_failed', 10, 15);
        $member = MemberAuth::redeem((string) $request->input('token', ''));
        if ($member === null) {
            AuditLog::record(null, 'portal.signin_failed');
            throw new HttpException(401, 'This sign-in link has expired or was already used. Request a new one below.');
        }
        AuditLog::record(null, 'portal.signin', 'member', (int) $member['member_id']);
        Response::json(['member' => $member]);
    }

    public static function logout(Request $request): void
    {
        MemberAuth::logout();
        Response::json(['ok' => true]);
    }

    public static function me(Request $request): void
    {
        Response::json(['member' => MemberAuth::require()]);
    }

    /** Email is the sign-in identity and is changed by PAA staff only. */
    public static function updateProfile(Request $request): void
    {
        $member = MemberAuth::require();
        $data = MemberProfile::validate($request);

        try {
            Database::run(
                'UPDATE members SET first_name = ?, last_name = ?, contact_number = ?, chapter_region = ?, prc_license_number = ?, paa_id_number = ?
                 WHERE member_id = ?',
                [$data['first_name'], $data['last_name'], $data['contact_number'], $data['chapter_region'],
                 $data['prc_license_number'], $data['paa_id_number'], $member['member_id']],
            );
        } catch (PDOException $e) {
            if ($e->getCode() !== '23000') {
                throw $e;
            }
            throw MemberProfile::duplicateError($e);
        }

        AuditLog::record(null, 'portal.profile_update', 'member', (int) $member['member_id'], [
            'changed' => MemberProfile::changedFields($member, $data),
        ]);
        Response::json(['member' => MemberAuth::member()]);
    }

    /** The member's registrations, newest event first, with pass tokens and certificate status. */
    public static function registrations(Request $request): void
    {
        $member = MemberAuth::require();
        $rows = Database::all(
            "SELECT r.registration_id, r.registration_date, r.payment_status, r.amount_paid, r.qr_token,
                    e.event_id, e.title, e.event_type, e.venue, e.start_date, e.end_date, e.status AS event_status,
                    e.registration_fee, e.cpd_units, e.cpd_min_attendance_pct,
                    (SELECT COUNT(*) FROM event_sessions s WHERE s.event_id = e.event_id) AS sessions_total,
                    (SELECT COUNT(*) FROM attendances a JOIN event_sessions s ON s.session_id = a.session_id
                     WHERE a.registration_id = r.registration_id AND s.event_id = e.event_id) AS sessions_attended,
                    c.certificate_no, c.verification_code, c.issued_at, c.cpd_units AS certificate_cpd_units, c.revoked_at
             FROM registrations r
             JOIN events e ON e.event_id = r.event_id
             LEFT JOIN certificates c ON c.registration_id = r.registration_id
             WHERE r.member_id = ?
             ORDER BY e.start_date DESC, e.event_id DESC",
            [$member['member_id']],
        );

        $registrations = array_map(static function (array $r): array {
            $ended = in_array($r['event_status'], ['Completed', 'Archived'], true);
            $hasCertificate = $r['certificate_no'] !== null && $r['revoked_at'] === null;

            return [
                'registration_id' => (int) $r['registration_id'],
                'registration_date' => $r['registration_date'],
                'payment_status' => $r['payment_status'],
                'amount_paid' => $r['amount_paid'],
                'qr_token' => $r['qr_token'],
                'sessions_attended' => (int) $r['sessions_attended'],
                'sessions_total' => (int) $r['sessions_total'],
                'event' => [
                    'event_id' => (int) $r['event_id'],
                    'title' => $r['title'],
                    'event_type' => $r['event_type'],
                    'venue' => $r['venue'],
                    'start_date' => $r['start_date'],
                    'end_date' => $r['end_date'],
                    'status' => $r['event_status'],
                    'registration_fee' => $r['registration_fee'],
                    'cpd_units' => $r['cpd_units'],
                    'cpd_min_attendance_pct' => (int) $r['cpd_min_attendance_pct'],
                ],
                'certificate' => $hasCertificate ? [
                    'certificate_no' => $r['certificate_no'],
                    'verification_code' => $r['verification_code'],
                    'issued_at' => $r['issued_at'],
                    'cpd_units' => $r['certificate_cpd_units'],
                ] : null,
                'certificate_note' => $ended && !$hasCertificate && (float) $r['cpd_units'] > 0 ? self::certificateNote($r) : null,
            ];
        }, $rows);

        Response::json([
            'registrations' => $registrations,
            'cpd_units_earned' => array_sum(array_map(static fn ($r) => (float) ($r['certificate']['cpd_units'] ?? 0), $registrations)),
        ]);
    }

    private static function certificateNote(array $r): string
    {
        if ($r['revoked_at'] !== null) {
            return 'Your CPD certificate for this event was revoked. Contact PAA for details.';
        }
        $reason = CertificateService::ineligibleReason(
            $r['payment_status'], (int) $r['sessions_attended'], (int) $r['sessions_total'], (int) $r['cpd_min_attendance_pct'],
        );

        return $reason === null
            ? 'You qualify for a CPD certificate. PAA will email it to you once it is issued.'
            : "No CPD certificate: {$reason}";
    }
}
