<?php

declare(strict_types=1);

namespace AgriPass\Core;

final class AuditLog
{
    public static function record(?int $userId, string $action, ?string $entityType = null, ?int $entityId = null, array $details = []): void
    {
        Database::run(
            'INSERT INTO logs (user_id, action, entity_type, entity_id, details, ip_address) VALUES (?, ?, ?, ?, ?, ?)',
            [$userId, $action, $entityType, $entityId, $details ? json_encode($details) : null, $_SERVER['REMOTE_ADDR'] ?? null],
        );
    }
}
