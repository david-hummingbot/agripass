<?php

declare(strict_types=1);

namespace AgriPass\Services;

use AgriPass\Core\Database;
use PDOException;

final class CertificateService
{
    private const CLEARED_PAYMENT = ['Paid', 'Waived'];

    /**
     * One row per registration with attendance progress and why it does or doesn't qualify.
     * Every session of the event counts toward the requirement.
     */
    public static function eligibility(array $event): array
    {
        $total = (int) Database::one('SELECT COUNT(*) AS total FROM event_sessions WHERE event_id = ?', [$event['event_id']])['total'];
        $minPct = (int) $event['cpd_min_attendance_pct'];

        $rows = Database::all(
            "SELECT r.registration_id, r.payment_status, r.qr_token,
                    m.first_name, m.last_name, m.email, m.prc_license_number, m.chapter_region,
                    (SELECT COUNT(*) FROM attendances a JOIN event_sessions s ON s.session_id = a.session_id
                     WHERE a.registration_id = r.registration_id AND s.event_id = r.event_id) AS sessions_attended,
                    c.certificate_id, c.certificate_no, c.verification_code, c.issued_at, c.emailed_at, c.revoked_at, c.revoked_reason
             FROM registrations r
             JOIN members m ON m.member_id = r.member_id
             LEFT JOIN certificates c ON c.registration_id = r.registration_id
             WHERE r.event_id = ?
             ORDER BY m.last_name, m.first_name",
            [$event['event_id']],
        );

        return array_map(static function (array $row) use ($total, $minPct): array {
            $attended = (int) $row['sessions_attended'];
            $pct = $total > 0 ? round($attended / $total * 100, 1) : 0.0;
            $reason = match (true) {
                $total === 0 => 'The event has no sessions.',
                !in_array($row['payment_status'], self::CLEARED_PAYMENT, true) => "Payment is {$row['payment_status']}.",
                $pct < $minPct => "Attended {$attended} of {$total} sessions; {$minPct}% required.",
                default => null,
            };

            return [
                ...$row,
                'registration_id' => (int) $row['registration_id'],
                'sessions_attended' => $attended,
                'sessions_total' => $total,
                'attendance_pct' => $pct,
                'eligible' => $reason === null,
                'reason' => $reason,
            ];
        }, $rows);
    }

    /** Creates the certificate for an eligible row, or returns the existing one. */
    public static function issue(array $event, array $row, ?int $issuedBy): array
    {
        if ($row['certificate_id'] !== null) {
            return self::find((int) $row['certificate_id']);
        }

        $number = sprintf('PAA-%s-%03d-%05d', substr($event['start_date'], 0, 4), $event['event_id'], $row['registration_id']);
        try {
            $id = Database::insert(
                'INSERT INTO certificates (registration_id, certificate_no, verification_code, attendee_name, prc_license_number,
                                           cpd_units, sessions_attended, sessions_total, issued_by)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [
                    $row['registration_id'], $number, strtoupper(bin2hex(random_bytes(8))),
                    trim("{$row['first_name']} {$row['last_name']}"), $row['prc_license_number'],
                    $event['cpd_units'], $row['sessions_attended'], $row['sessions_total'], $issuedBy,
                ],
            );
        } catch (PDOException $e) {
            if ($e->getCode() !== '23000') {
                throw $e;
            }
            // Issued concurrently by another request.
            return self::forRegistration($row['registration_id']);
        }

        return self::find($id);
    }

    public static function find(int $certificateId): ?array
    {
        return self::query('c.certificate_id = ?', [$certificateId]);
    }

    public static function forRegistration(int $registrationId): ?array
    {
        return self::query('c.registration_id = ?', [$registrationId]);
    }

    public static function byCode(string $code): ?array
    {
        return self::query('c.verification_code = ?', [strtoupper($code)]);
    }

    public static function verifyUrl(string $code): string
    {
        return Mailer::appUrl('/verify/?code=' . rawurlencode($code));
    }

    public static function pdf(array $certificate, array $event, bool $sample = false): string
    {
        return CertificatePdf::render($certificate, $event, $sample);
    }

    /** Row with the certificate, its registration token and the attendee's contact details. */
    private static function query(string $where, array $params): ?array
    {
        return Database::one(
            "SELECT c.*, r.event_id, r.qr_token, m.email, m.first_name
             FROM certificates c
             JOIN registrations r ON r.registration_id = c.registration_id
             JOIN members m ON m.member_id = r.member_id
             WHERE {$where}",
            $params,
        );
    }
}
