<?php

declare(strict_types=1);

namespace AgriPass\Core;

/** Counts recent audit log entries for an action from the caller's IP. */
final class RateLimiter
{
    public static function assertUnder(string $action, int $maxAttempts, int $windowMinutes): void
    {
        $count = (int) Database::one(
            'SELECT COUNT(*) AS total FROM logs WHERE action = ? AND ip_address = ? AND created_at > NOW() - INTERVAL ? MINUTE',
            [$action, $_SERVER['REMOTE_ADDR'] ?? null, $windowMinutes],
        )['total'];

        if ($count >= $maxAttempts) {
            throw new HttpException(429, 'Too many attempts. Please wait a few minutes and try again.');
        }
    }
}
