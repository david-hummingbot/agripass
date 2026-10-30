<?php

declare(strict_types=1);

namespace AgriPass\Controllers;

use AgriPass\Core\AuditLog;
use AgriPass\Core\Auth;
use AgriPass\Core\Database;
use AgriPass\Core\HttpException;
use AgriPass\Core\Request;
use AgriPass\Core\Response;
use AgriPass\Services\EventContext;

final class EventController
{
    private const TYPES = ['Convention', 'General Assembly', 'Seminar', 'Workshop', 'Field Demo'];

    private const TRANSITIONS = [
        'Draft' => ['Active'],
        'Active' => ['Completed'],
        'Completed' => ['Archived'],
        'Archived' => [],
    ];

    private const FIELDS = [
        'title' => 'required',
        'event_type' => 'required',
        'venue' => 'required',
        'start_date' => 'required',
        'end_date' => 'required',
        'description' => 'optional',
        'registration_fee' => 'optional',
        'cpd_units' => 'optional',
        'cpd_min_attendance_pct' => 'optional',
        'prc_accreditation_no' => 'optional',
        'cert_signatory_name' => 'optional',
        'cert_signatory_title' => 'optional',
    ];

    public static function index(Request $request): void
    {
        Auth::require();
        Response::json(['events' => Database::all(
            'SELECT e.*,
                    (SELECT COUNT(*) FROM registrations r WHERE r.event_id = e.event_id) AS registration_count,
                    (SELECT COUNT(*) FROM event_sessions s WHERE s.event_id = e.event_id) AS session_count
             FROM events e ORDER BY e.start_date DESC',
        )]);
    }

    public static function show(Request $request): void
    {
        Auth::require();
        $event = self::withDetails(EventContext::find($request->param('id')));
        $event['stats'] = self::stats((int) $event['event_id']);
        Response::json(['event' => $event]);
    }

    /** Public: the event currently open for registration and scanning. */
    public static function active(Request $request): void
    {
        $event = Database::one("SELECT * FROM events WHERE is_active = 1 AND status = 'Active' LIMIT 1");
        if ($event === null) {
            throw new HttpException(404, 'No event is currently open.');
        }
        unset($event['created_by'], $event['cert_signature_path']);
        Response::json(['event' => self::withDetails($event)]);
    }

    public static function store(Request $request): void
    {
        $user = Auth::require(Auth::ADMINS);
        $data = self::validated($request);
        $id = Database::insert(
            'INSERT INTO events (title, event_type, description, venue, start_date, end_date, registration_fee,
                                 cpd_units, cpd_min_attendance_pct, prc_accreditation_no, cert_signatory_name, cert_signatory_title, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [...self::columns($data), $user['user_id']],
        );
        AuditLog::record($user['user_id'], 'event.create', 'event', $id);
        Response::json(['event' => EventContext::find($id)], 201);
    }

    public static function update(Request $request): void
    {
        $user = Auth::require(Auth::ADMINS);
        $event = EventContext::find($request->param('id'));
        EventContext::assertEditable($event);
        $data = self::validated($request);
        Database::run(
            'UPDATE events SET title = ?, event_type = ?, description = ?, venue = ?, start_date = ?, end_date = ?,
                               registration_fee = ?, cpd_units = ?, cpd_min_attendance_pct = ?, prc_accreditation_no = ?,
                               cert_signatory_name = ?, cert_signatory_title = ?
             WHERE event_id = ?',
            [...self::columns($data), $event['event_id']],
        );
        AuditLog::record($user['user_id'], 'event.update', 'event', (int) $event['event_id']);
        Response::json(['event' => EventContext::find((int) $event['event_id'])]);
    }

    /** Sets the global Active Event context used by registration, payments and scanners. */
    public static function activate(Request $request): void
    {
        $user = Auth::require(Auth::ADMINS);
        $event = EventContext::find($request->param('id'));
        if (!in_array($event['status'], ['Draft', 'Active'], true)) {
            throw new HttpException(409, "A {$event['status']} event cannot be made the active event.");
        }

        $pdo = Database::pdo();
        $pdo->beginTransaction();
        Database::run('UPDATE events SET is_active = 0 WHERE is_active = 1');
        Database::run("UPDATE events SET is_active = 1, status = 'Active' WHERE event_id = ?", [$event['event_id']]);
        $pdo->commit();

        AuditLog::record($user['user_id'], 'event.activate', 'event', (int) $event['event_id']);
        Response::json(['event' => EventContext::find((int) $event['event_id'])]);
    }

    public static function transition(Request $request): void
    {
        $user = Auth::require(Auth::ADMINS);
        $event = EventContext::find($request->param('id'));
        $status = (string) $request->validate(['status' => 'required'])['status'];

        if (!in_array($status, self::TRANSITIONS[$event['status']], true)) {
            throw new HttpException(409, "Cannot move an event from {$event['status']} to {$status}.");
        }
        $isActive = $status === 'Active' ? (int) $event['is_active'] : 0;
        Database::run('UPDATE events SET status = ?, is_active = ? WHERE event_id = ?', [$status, $isActive, $event['event_id']]);

        AuditLog::record($user['user_id'], 'event.status', 'event', (int) $event['event_id'], ['from' => $event['status'], 'to' => $status]);
        Response::json(['event' => EventContext::find((int) $event['event_id'])]);
    }

    private static function withDetails(array $event): array
    {
        $event['sessions'] = Database::all(
            'SELECT * FROM event_sessions WHERE event_id = ? ORDER BY session_date, start_time',
            [$event['event_id']],
        );
        $event['custom_fields'] = array_map(
            static fn (array $f) => [...$f, 'field_options' => $f['field_options'] === null ? null : json_decode($f['field_options'], true)],
            Database::all('SELECT * FROM event_custom_fields WHERE event_id = ? ORDER BY field_id', [$event['event_id']]),
        );

        return $event;
    }

    private static function stats(int $eventId): array
    {
        $payments = ['Pending' => 0, 'Paid' => 0, 'Waived' => 0, 'Refunded' => 0];
        $revenue = 0.0;
        foreach (Database::all(
            'SELECT payment_status, COUNT(*) AS total, SUM(amount_paid) AS amount FROM registrations WHERE event_id = ? GROUP BY payment_status',
            [$eventId],
        ) as $row) {
            $payments[$row['payment_status']] = (int) $row['total'];
            if ($row['payment_status'] === 'Paid') {
                $revenue = (float) $row['amount'];
            }
        }

        $checkedIn = (int) Database::one(
            'SELECT COUNT(DISTINCT a.registration_id) AS total
             FROM attendances a JOIN registrations r ON r.registration_id = a.registration_id
             WHERE r.event_id = ?',
            [$eventId],
        )['total'];

        $sessionAttendance = [];
        foreach (Database::all(
            'SELECT s.session_id, COUNT(a.attendance_id) AS total
             FROM event_sessions s LEFT JOIN attendances a ON a.session_id = s.session_id
             WHERE s.event_id = ? GROUP BY s.session_id',
            [$eventId],
        ) as $row) {
            $sessionAttendance[$row['session_id']] = (int) $row['total'];
        }

        return [
            'registrations' => array_sum($payments),
            'payments' => $payments,
            'revenue' => $revenue,
            'checked_in' => $checkedIn,
            'session_attendance' => (object) $sessionAttendance,
        ];
    }

    private static function validated(Request $request): array
    {
        $data = $request->validate(self::FIELDS);
        $errors = [];

        if (!in_array($data['event_type'], self::TYPES, true)) {
            $errors['event_type'] = 'Must be one of: ' . implode(', ', self::TYPES) . '.';
        }
        foreach (['start_date', 'end_date'] as $field) {
            if (\DateTime::createFromFormat('Y-m-d', (string) $data[$field]) === false) {
                $errors[$field] = 'Must be a date in YYYY-MM-DD format.';
            }
        }
        if (!$errors && $data['end_date'] < $data['start_date']) {
            $errors['end_date'] = 'End date cannot be before the start date.';
        }
        foreach (['registration_fee', 'cpd_units'] as $field) {
            if ($data[$field] !== null && (!is_numeric($data[$field]) || $data[$field] < 0)) {
                $errors[$field] = 'Must be a non-negative number.';
            }
        }
        foreach (['cert_signatory_name' => 100, 'cert_signatory_title' => 150] as $field => $max) {
            if ($data[$field] !== null && mb_strlen((string) $data[$field]) > $max) {
                $errors[$field] = "Use {$max} characters or fewer.";
            }
        }
        $pct = $data['cpd_min_attendance_pct'];
        if ($pct !== null && (!is_numeric($pct) || $pct < 0 || $pct > 100)) {
            $errors['cpd_min_attendance_pct'] = 'Must be between 0 and 100.';
        }
        if ($errors) {
            throw new HttpException(422, 'Validation failed.', $errors);
        }

        return $data;
    }

    private static function columns(array $data): array
    {
        return [
            $data['title'],
            $data['event_type'],
            $data['description'],
            $data['venue'],
            $data['start_date'],
            $data['end_date'],
            $data['registration_fee'] ?? 0,
            $data['cpd_units'] ?? 0,
            $data['cpd_min_attendance_pct'] ?? 80,
            $data['prc_accreditation_no'],
            $data['cert_signatory_name'],
            $data['cert_signatory_title'],
        ];
    }
}
