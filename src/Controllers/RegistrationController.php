<?php

declare(strict_types=1);

namespace AgriPass\Controllers;

use AgriPass\Core\AuditLog;
use AgriPass\Core\Auth;
use AgriPass\Core\Database;
use AgriPass\Core\HttpException;
use AgriPass\Core\Request;
use AgriPass\Core\Response;
use AgriPass\Core\RateLimiter;
use AgriPass\Services\EventContext;
use AgriPass\Services\PassMailer;
use AgriPass\Services\QrToken;

final class RegistrationController
{
    private const PAYMENT_STATUSES = ['Pending', 'Paid', 'Waived', 'Refunded'];

    /** Public registration for an open event. Existing members (matched by email) are reused. */
    public static function store(Request $request): void
    {
        $event = EventContext::find($request->param('id'));
        if ($event['status'] !== 'Active') {
            throw new HttpException(409, 'Registration is not open for this event.');
        }

        $data = $request->validate([
            'first_name' => 'required',
            'last_name' => 'required',
            'email' => 'required',
            'paa_id_number' => 'optional',
            'prc_license_number' => 'optional',
            'contact_number' => 'optional',
            'chapter_region' => 'optional',
        ]);
        $errors = [];
        if (!filter_var($data['email'], FILTER_VALIDATE_EMAIL)) {
            $errors['email'] = 'Must be a valid email address.';
        }
        if ($request->input('privacy_consent') !== true) {
            $errors['privacy_consent'] = 'You must agree to the data privacy notice to register.';
        }
        if ($errors) {
            throw new HttpException(422, 'Validation failed.', $errors);
        }
        $data['email'] = strtolower((string) $data['email']);
        $responses = self::validatedResponses((int) $event['event_id'], $request->input('custom_responses', []));

        $pdo = Database::pdo();
        $pdo->beginTransaction();
        try {
            $memberId = self::upsertMember($data);

            if (Database::one('SELECT 1 FROM registrations WHERE event_id = ? AND member_id = ?', [$event['event_id'], $memberId])) {
                throw new HttpException(409, 'This email is already registered for this event.');
            }

            $isFree = (float) $event['registration_fee'] <= 0;
            $registrationId = Database::insert(
                'INSERT INTO registrations (event_id, member_id, qr_token, payment_status, custom_responses) VALUES (?, ?, ?, ?, ?)',
                [$event['event_id'], $memberId, 'pending:' . bin2hex(random_bytes(16)), $isFree ? 'Waived' : 'Pending', json_encode((object) $responses)],
            );
            $token = QrToken::make((int) $event['event_id'], $registrationId);
            Database::run('UPDATE registrations SET qr_token = ? WHERE registration_id = ?', [$token, $registrationId]);
            $pdo->commit();
        } catch (\Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }

        $paymentStatus = $isFree ? 'Waived' : 'Pending';
        $member = Database::one('SELECT * FROM members WHERE member_id = ?', [$memberId]);
        $emailed = PassMailer::send($event, $member, $token, $paymentStatus);

        AuditLog::record(null, 'registration.create', 'registration', $registrationId, ['event_id' => (int) $event['event_id'], 'emailed' => $emailed]);
        Response::json(['registration' => [
            'registration_id' => $registrationId,
            'event_id' => (int) $event['event_id'],
            'payment_status' => $paymentStatus,
            'amount_due' => (float) $event['registration_fee'],
            'qr_token' => $token,
            'email' => $member['email'],
            'emailed' => $emailed,
        ]], 201);
    }

    /** Re-sends an existing pass to the registered email. Always responds the same way so emails can't be probed. */
    public static function resend(Request $request): void
    {
        RateLimiter::assertUnder('registration.resend', 5, 15);
        $event = EventContext::find($request->param('id'));
        $email = strtolower((string) $request->validate(['email' => 'required'])['email']);

        $row = Database::one(
            'SELECT r.qr_token, r.payment_status, m.* FROM registrations r JOIN members m ON m.member_id = r.member_id
             WHERE r.event_id = ? AND m.email = ?',
            [$event['event_id'], $email],
        );
        if ($row !== null) {
            PassMailer::send($event, $row, $row['qr_token'], $row['payment_status']);
        }
        AuditLog::record(null, 'registration.resend', 'event', (int) $event['event_id']);

        Response::json(['message' => 'If this email is registered for the event, the pass has been sent to it.']);
    }

    public static function index(Request $request): void
    {
        Auth::require();
        $event = EventContext::find($request->param('id'));
        Response::json(['registrations' => Database::all(
            'SELECT r.registration_id, r.payment_status, r.payment_reference, r.amount_paid, r.custom_responses, r.registration_date,
                    m.member_id, m.first_name, m.last_name, m.email, m.chapter_region, m.prc_license_number, m.paa_id_number,
                    (SELECT COUNT(*) FROM attendances a WHERE a.registration_id = r.registration_id) AS sessions_attended
             FROM registrations r JOIN members m ON m.member_id = r.member_id
             WHERE r.event_id = ? ORDER BY m.last_name, m.first_name',
            [$event['event_id']],
        )]);
    }

    /** Manual payment verification, e.g. for uploaded bank deposit slips or delayed webhooks. */
    public static function updatePayment(Request $request): void
    {
        $user = Auth::require(Auth::ADMINS);
        $registration = Database::one('SELECT * FROM registrations WHERE registration_id = ?', [$request->param('id')]);
        if ($registration === null) {
            throw new HttpException(404, 'Registration not found.');
        }
        EventContext::assertEditable(EventContext::find((int) $registration['event_id']));

        $data = $request->validate(['payment_status' => 'required', 'payment_reference' => 'optional', 'amount_paid' => 'optional']);
        if (!in_array($data['payment_status'], self::PAYMENT_STATUSES, true)) {
            throw new HttpException(422, 'Validation failed.', ['payment_status' => 'Must be one of: ' . implode(', ', self::PAYMENT_STATUSES) . '.']);
        }

        Database::run(
            'UPDATE registrations SET payment_status = ?, payment_reference = COALESCE(?, payment_reference), amount_paid = COALESCE(?, amount_paid)
             WHERE registration_id = ?',
            [$data['payment_status'], $data['payment_reference'], $data['amount_paid'], $registration['registration_id']],
        );
        AuditLog::record($user['user_id'], 'registration.payment', 'registration', (int) $registration['registration_id'], [
            'from' => $registration['payment_status'],
            'to' => $data['payment_status'],
            'reference' => $data['payment_reference'],
        ]);
        Response::json(['registration' => Database::one('SELECT * FROM registrations WHERE registration_id = ?', [$registration['registration_id']])]);
    }

    private static function upsertMember(array $data): int
    {
        $existing = Database::one('SELECT member_id FROM members WHERE email = ?', [$data['email']]);
        if ($existing === null) {
            return Database::insert(
                'INSERT INTO members (paa_id_number, prc_license_number, first_name, last_name, email, contact_number, chapter_region)
                 VALUES (?, ?, ?, ?, ?, ?, ?)',
                [$data['paa_id_number'], $data['prc_license_number'], $data['first_name'], $data['last_name'], $data['email'], $data['contact_number'], $data['chapter_region']],
            );
        }

        // Public endpoint: only fill in missing profile data, never overwrite an existing member's record.
        Database::run(
            'UPDATE members SET prc_license_number = COALESCE(prc_license_number, ?), contact_number = COALESCE(contact_number, ?),
                                chapter_region = COALESCE(chapter_region, ?)
             WHERE member_id = ?',
            [$data['prc_license_number'], $data['contact_number'], $data['chapter_region'], $existing['member_id']],
        );

        return (int) $existing['member_id'];
    }

    private static function validatedResponses(int $eventId, mixed $input): array
    {
        if (!is_array($input)) {
            throw new HttpException(422, 'Validation failed.', ['custom_responses' => 'Must be an object keyed by field_id.']);
        }

        $responses = [];
        $errors = [];
        foreach (Database::all('SELECT * FROM event_custom_fields WHERE event_id = ?', [$eventId]) as $field) {
            $id = (string) $field['field_id'];
            $value = $input[$id] ?? null;
            if (is_string($value)) {
                $value = trim($value);
            }
            if ($value === null || $value === '') {
                if ($field['is_required'] && $field['field_type'] !== 'checkbox') {
                    $errors[$id] = "{$field['field_label']} is required.";
                }
                continue;
            }

            $valid = match ($field['field_type']) {
                'number' => is_numeric($value),
                'checkbox' => is_bool($value),
                'select' => in_array($value, json_decode((string) $field['field_options'], true) ?? [], true),
                default => is_string($value) && mb_strlen($value) <= 500,
            };
            if (!$valid) {
                $errors[$id] = "Invalid value for {$field['field_label']}.";
                continue;
            }
            $responses[$id] = $field['field_type'] === 'number' ? $value + 0 : $value;
        }
        if ($errors) {
            throw new HttpException(422, 'Validation failed.', ['custom_responses' => $errors]);
        }

        return $responses;
    }
}
