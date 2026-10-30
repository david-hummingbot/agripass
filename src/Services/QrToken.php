<?php

declare(strict_types=1);

namespace AgriPass\Services;

use AgriPass\Core\Config;

/**
 * Pass format: AGRIPASS|{EVENT_ID}|{REGISTRATION_ID}|{HASH_TOKEN}
 */
final class QrToken
{
    private const PREFIX = 'AGRIPASS';

    public static function make(int $eventId, int $registrationId): string
    {
        return implode('|', [self::PREFIX, $eventId, $registrationId, self::sign($eventId, $registrationId)]);
    }

    /** @return array{event_id: int, registration_id: int}|null */
    public static function parse(string $token): ?array
    {
        $parts = explode('|', trim($token));
        if (count($parts) !== 4 || $parts[0] !== self::PREFIX || !ctype_digit($parts[1]) || !ctype_digit($parts[2])) {
            return null;
        }
        [$_, $eventId, $registrationId, $hash] = $parts;
        if (!hash_equals(self::sign((int) $eventId, (int) $registrationId), $hash)) {
            return null;
        }

        return ['event_id' => (int) $eventId, 'registration_id' => (int) $registrationId];
    }

    private static function sign(int $eventId, int $registrationId): string
    {
        return substr(hash_hmac('sha256', "{$eventId}|{$registrationId}", Config::appKey()), 0, 32);
    }
}
