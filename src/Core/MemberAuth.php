<?php

declare(strict_types=1);

namespace AgriPass\Core;

/**
 * Member portal sessions. Members sign in with single-use emailed links, never passwords,
 * and share the PHP session with staff logins under a separate key.
 */
final class MemberAuth
{
    public const LINK_TTL_MINUTES = 30;

    /** Returns the raw token to email; only its hash is stored. */
    public static function createLoginToken(int $memberId): string
    {
        $token = bin2hex(random_bytes(32));
        Database::run(
            'INSERT INTO member_login_tokens (member_id, token_hash, expires_at, ip_address) VALUES (?, ?, NOW() + INTERVAL ? MINUTE, ?)',
            [$memberId, hash('sha256', $token), self::LINK_TTL_MINUTES, $_SERVER['REMOTE_ADDR'] ?? null],
        );

        return $token;
    }

    /** Consumes the token and signs the member in. Using one link invalidates the member's other outstanding links. */
    public static function redeem(string $token): ?array
    {
        if (!preg_match('/^[0-9a-f]{64}$/', $token)) {
            return null;
        }
        $row = Database::one(
            'SELECT token_id, member_id FROM member_login_tokens WHERE token_hash = ? AND used_at IS NULL AND expires_at > NOW()',
            [hash('sha256', $token)],
        );
        if ($row === null) {
            return null;
        }
        if (Database::run('UPDATE member_login_tokens SET used_at = NOW() WHERE token_id = ? AND used_at IS NULL', [$row['token_id']]) !== 1) {
            return null;
        }
        Database::run('UPDATE member_login_tokens SET used_at = NOW() WHERE member_id = ? AND used_at IS NULL', [$row['member_id']]);
        Database::run('UPDATE members SET last_portal_login_at = NOW() WHERE member_id = ?', [$row['member_id']]);

        session_regenerate_id(true);
        $_SESSION['member_id'] = (int) $row['member_id'];

        return self::member();
    }

    public static function member(): ?array
    {
        $id = $_SESSION['member_id'] ?? null;

        return $id === null ? null : Database::one(
            'SELECT member_id, first_name, last_name, email, contact_number, chapter_region, prc_license_number, paa_id_number,
                    membership_status, created_at
             FROM members WHERE member_id = ?',
            [$id],
        );
    }

    public static function require(): array
    {
        return self::member() ?? throw new HttpException(401, 'Please sign in to continue.');
    }

    /** Leaves any staff login in the same browser untouched. */
    public static function logout(): void
    {
        unset($_SESSION['member_id']);
    }
}
