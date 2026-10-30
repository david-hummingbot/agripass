<?php

declare(strict_types=1);

namespace AgriPass\Services;

use AgriPass\Core\Database;
use PDOException;

final class CheckInService
{
    public const VALID = 'valid';
    public const INVALID = 'invalid';
    public const WRONG_EVENT = 'wrong_event';
    public const UNPAID = 'unpaid';
    public const DUPLICATE = 'duplicate';
    public const ALREADY_SYNCED = 'already_synced';

    private const CLEARED_PAYMENT = ['Paid', 'Waived'];

    /**
     * @param array $session row from event_sessions; must belong to the scanner's event context
     */
    public static function checkIn(
        string $qrToken,
        array $session,
        ?int $scannedBy,
        ?string $deviceId = null,
        ?string $clientUuid = null,
        ?string $checkInTime = null,
        bool $offline = false,
    ): array {
        if ($clientUuid !== null) {
            $existing = Database::one('SELECT attendance_id, check_in_time FROM attendances WHERE client_uuid = ?', [$clientUuid]);
            if ($existing !== null) {
                return ['result' => self::ALREADY_SYNCED, 'check_in_time' => $existing['check_in_time']];
            }
        }

        $parsed = QrToken::parse($qrToken);
        if ($parsed === null) {
            return ['result' => self::INVALID, 'message' => 'Unrecognized or tampered QR pass.'];
        }
        if ($parsed['event_id'] !== (int) $session['event_id']) {
            return ['result' => self::WRONG_EVENT, 'message' => 'This pass is for a different event.'];
        }

        $registration = Database::one(
            'SELECT r.registration_id, r.event_id, r.payment_status, r.qr_token,
                    m.member_id, m.first_name, m.last_name, m.chapter_region, m.prc_license_number
             FROM registrations r JOIN members m ON m.member_id = r.member_id
             WHERE r.registration_id = ? AND r.qr_token = ?',
            [$parsed['registration_id'], $qrToken],
        );
        if ($registration === null) {
            return ['result' => self::INVALID, 'message' => 'Registration not found.'];
        }

        $attendee = [
            'registration_id' => (int) $registration['registration_id'],
            'name' => $registration['first_name'] . ' ' . $registration['last_name'],
            'chapter_region' => $registration['chapter_region'],
            'prc_license_number' => $registration['prc_license_number'],
            'payment_status' => $registration['payment_status'],
        ];

        if (!in_array($registration['payment_status'], self::CLEARED_PAYMENT, true)) {
            return ['result' => self::UNPAID, 'message' => 'Payment Pending - Direct to Registration Desk.', 'attendee' => $attendee];
        }

        $duplicate = self::existingAttendance($attendee['registration_id'], (int) $session['session_id']);
        if ($duplicate !== null) {
            return [
                'result' => self::DUPLICATE,
                'message' => 'Already Checked In for this Session.',
                'check_in_time' => $duplicate['check_in_time'],
                'attendee' => $attendee,
            ];
        }

        $time = $checkInTime !== null ? date('Y-m-d H:i:s', strtotime($checkInTime)) : date('Y-m-d H:i:s');

        try {
            Database::run(
                'INSERT INTO attendances (registration_id, session_id, scanned_by, device_id, client_uuid, check_in_time, is_offline_sync)
                 VALUES (?, ?, ?, ?, ?, ?, ?)',
                [$attendee['registration_id'], $session['session_id'], $scannedBy, $deviceId, $clientUuid, $time, $offline ? 1 : 0],
            );
        } catch (PDOException $e) {
            if ($e->getCode() !== '23000') {
                throw $e;
            }
            $duplicate = self::existingAttendance($attendee['registration_id'], (int) $session['session_id']);

            return [
                'result' => self::DUPLICATE,
                'message' => 'Already Checked In for this Session.',
                'check_in_time' => $duplicate['check_in_time'] ?? null,
                'attendee' => $attendee,
            ];
        }

        return ['result' => self::VALID, 'message' => 'Welcome!', 'check_in_time' => $time, 'attendee' => $attendee];
    }

    private static function existingAttendance(int $registrationId, int $sessionId): ?array
    {
        return Database::one(
            'SELECT attendance_id, check_in_time FROM attendances WHERE registration_id = ? AND session_id = ?',
            [$registrationId, $sessionId],
        );
    }
}
