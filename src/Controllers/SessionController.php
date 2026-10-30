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

final class SessionController
{
    public static function index(Request $request): void
    {
        Auth::require();
        $event = EventContext::find($request->param('id'));
        Response::json(['sessions' => Database::all(
            'SELECT * FROM event_sessions WHERE event_id = ? ORDER BY session_date, start_time',
            [$event['event_id']],
        )]);
    }

    public static function store(Request $request): void
    {
        $user = Auth::require(Auth::ADMINS);
        $event = EventContext::find($request->param('id'));
        EventContext::assertEditable($event);

        $data = $request->validate([
            'session_name' => 'required',
            'session_date' => 'required',
            'start_time' => 'required',
            'end_time' => 'required',
        ]);

        $errors = [];
        if ($data['session_date'] < $event['start_date'] || $data['session_date'] > $event['end_date']) {
            $errors['session_date'] = "Must fall within the event dates ({$event['start_date']} to {$event['end_date']}).";
        }
        foreach (['start_time', 'end_time'] as $field) {
            if (!preg_match('/^\d{2}:\d{2}(:\d{2})?$/', (string) $data[$field])) {
                $errors[$field] = 'Must be a time in HH:MM format.';
            }
        }
        if (!$errors && $data['end_time'] <= $data['start_time']) {
            $errors['end_time'] = 'End time must be after the start time.';
        }
        if ($errors) {
            throw new HttpException(422, 'Validation failed.', $errors);
        }

        $id = Database::insert(
            'INSERT INTO event_sessions (event_id, session_name, session_date, start_time, end_time) VALUES (?, ?, ?, ?, ?)',
            [$event['event_id'], $data['session_name'], $data['session_date'], $data['start_time'], $data['end_time']],
        );
        AuditLog::record($user['user_id'], 'session.create', 'event_session', $id);
        Response::json(['session' => Database::one('SELECT * FROM event_sessions WHERE session_id = ?', [$id])], 201);
    }

    public static function destroy(Request $request): void
    {
        $user = Auth::require(Auth::ADMINS);
        $event = EventContext::find($request->param('id'));
        EventContext::assertEditable($event);

        $deleted = Database::run(
            'DELETE FROM event_sessions WHERE session_id = ? AND event_id = ?',
            [$request->param('sessionId'), $event['event_id']],
        );
        if ($deleted === 0) {
            throw new HttpException(404, 'Session not found.');
        }
        AuditLog::record($user['user_id'], 'session.delete', 'event_session', $request->param('sessionId'));
        Response::json(['ok' => true]);
    }
}
