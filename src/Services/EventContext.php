<?php

declare(strict_types=1);

namespace AgriPass\Services;

use AgriPass\Core\Database;
use AgriPass\Core\HttpException;
use AgriPass\Core\Request;

final class EventContext
{
    /** Resolves the event from the X-Event-ID header, falling back to the globally active event. */
    public static function resolve(Request $request): array
    {
        $header = $request->header('X-Event-ID');
        if ($header !== null && $header !== '') {
            if (!ctype_digit($header)) {
                throw new HttpException(400, 'X-Event-ID must be a numeric event ID.');
            }

            return self::find((int) $header);
        }

        $event = Database::one('SELECT * FROM events WHERE is_active = 1 LIMIT 1');
        if ($event === null) {
            throw new HttpException(404, 'No active event is set.');
        }

        return $event;
    }

    public static function find(int $eventId): array
    {
        $event = Database::one('SELECT * FROM events WHERE event_id = ?', [$eventId]);
        if ($event === null) {
            throw new HttpException(404, 'Event not found.');
        }

        return $event;
    }

    public static function assertEditable(array $event): void
    {
        if ($event['status'] === 'Archived') {
            throw new HttpException(409, 'Archived events are locked and cannot be modified.');
        }
    }
}
