<?php

declare(strict_types=1);

namespace AgriPass\Controllers;

use AgriPass\Core\AuditLog;
use AgriPass\Core\Auth;
use AgriPass\Core\Database;
use AgriPass\Core\HttpException;
use AgriPass\Core\Request;
use AgriPass\Core\Response;
use AgriPass\Services\CheckInService;
use AgriPass\Services\EventContext;

final class CheckInController
{
    private const MAX_SYNC_BATCH = 1000;

    public static function scan(Request $request): void
    {
        $user = Auth::require();
        $event = EventContext::resolve($request);
        EventContext::assertEditable($event);
        $data = $request->validate(['qr_token' => 'required', 'session_id' => 'required', 'device_id' => 'optional', 'client_uuid' => 'optional']);
        $session = self::sessionFor($event, (int) $data['session_id']);
        if ($data['client_uuid'] !== null && !self::isUuid($data['client_uuid'])) {
            throw new HttpException(422, 'Validation failed.', ['client_uuid' => 'Must be a UUID.']);
        }

        $result = CheckInService::checkIn(
            (string) $data['qr_token'],
            $session,
            $user['user_id'],
            is_string($data['device_id']) ? mb_substr($data['device_id'], 0, 64) : null,
            $data['client_uuid'],
        );
        Response::json($result);
    }

    /** Full roster for the scanner's IndexedDB cache prior to going offline. */
    public static function roster(Request $request): void
    {
        Auth::require();
        $event = EventContext::find($request->param('id'));

        Response::json([
            'event' => [
                'event_id' => (int) $event['event_id'],
                'title' => $event['title'],
                'status' => $event['status'],
            ],
            'sessions' => Database::all(
                'SELECT session_id, session_name, session_date, start_time, end_time FROM event_sessions WHERE event_id = ? ORDER BY session_date, start_time',
                [$event['event_id']],
            ),
            'registrations' => Database::all(
                "SELECT r.registration_id, r.qr_token, r.payment_status,
                        CONCAT(m.first_name, ' ', m.last_name) AS name, m.chapter_region, m.prc_license_number
                 FROM registrations r JOIN members m ON m.member_id = r.member_id
                 WHERE r.event_id = ?",
                [$event['event_id']],
            ),
            'attendances' => Database::all(
                'SELECT a.registration_id, a.session_id, a.check_in_time
                 FROM attendances a JOIN registrations r ON r.registration_id = a.registration_id
                 WHERE r.event_id = ?',
                [$event['event_id']],
            ),
            'generated_at' => date('c'),
        ]);
    }

    /** Batch upload of offline scans. Safe to retry: records are deduplicated by client_uuid and session. */
    public static function sync(Request $request): void
    {
        $user = Auth::require();
        $event = EventContext::resolve($request);
        EventContext::assertEditable($event);

        $deviceId = $request->input('device_id');
        $records = $request->input('records');
        if (!is_array($records) || !array_is_list($records)) {
            throw new HttpException(422, 'Validation failed.', ['records' => 'Must be a list of scan records.']);
        }
        if (count($records) > self::MAX_SYNC_BATCH) {
            throw new HttpException(413, 'Sync batches are limited to ' . self::MAX_SYNC_BATCH . ' records.');
        }

        $sessions = [];
        foreach (Database::all('SELECT * FROM event_sessions WHERE event_id = ?', [$event['event_id']]) as $session) {
            $sessions[(int) $session['session_id']] = $session;
        }

        $results = [];
        $summary = [];
        foreach ($records as $i => $record) {
            $clientUuid = is_array($record) ? ($record['client_uuid'] ?? null) : null;
            $session = is_array($record) ? ($sessions[(int) ($record['session_id'] ?? 0)] ?? null) : null;
            $time = is_array($record) ? ($record['check_in_time'] ?? null) : null;

            if (!self::isUuid($clientUuid)) {
                $outcome = ['result' => 'rejected', 'message' => 'Missing or invalid client_uuid.'];
            } elseif ($session === null) {
                $outcome = ['result' => 'rejected', 'message' => 'Session does not belong to this event.'];
            } elseif (!is_string($time) || strtotime($time) === false) {
                $outcome = ['result' => 'rejected', 'message' => 'Invalid check_in_time.'];
            } else {
                $outcome = CheckInService::checkIn(
                    (string) ($record['qr_token'] ?? ''),
                    $session,
                    $user['user_id'],
                    is_string($deviceId) ? mb_substr($deviceId, 0, 64) : null,
                    $clientUuid,
                    $time,
                    offline: true,
                );
            }

            $summary[$outcome['result']] = ($summary[$outcome['result']] ?? 0) + 1;
            $results[] = ['index' => $i, 'client_uuid' => $clientUuid, ...$outcome];
        }

        AuditLog::record($user['user_id'], 'attendance.sync', 'event', (int) $event['event_id'], [
            'device_id' => $deviceId,
            'summary' => $summary,
        ]);
        Response::json(['summary' => $summary, 'results' => $results]);
    }

    private static function isUuid(mixed $value): bool
    {
        return is_string($value) && preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i', $value) === 1;
    }

    private static function sessionFor(array $event, int $sessionId): array
    {
        $session = Database::one('SELECT * FROM event_sessions WHERE session_id = ? AND event_id = ?', [$sessionId, $event['event_id']]);
        if ($session === null) {
            throw new HttpException(422, 'Validation failed.', ['session_id' => 'Session does not belong to the current event.']);
        }

        return $session;
    }
}
