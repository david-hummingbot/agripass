<?php

declare(strict_types=1);

namespace AgriPass\Core;

final class Auth
{
    public const SUPER_ADMIN = 'SuperAdmin';
    public const REGIONAL_OFFICER = 'RegionalOfficer';
    public const STAFF = 'Staff';

    public const ROLES = [self::SUPER_ADMIN, self::REGIONAL_OFFICER, self::STAFF];
    public const ADMINS = [self::SUPER_ADMIN, self::REGIONAL_OFFICER];
    public const ANY_STAFF = self::ROLES;

    public const MIN_PASSWORD_LENGTH = 8;

    public static function start(): void
    {
        if (session_status() === PHP_SESSION_NONE) {
            session_name('agripass_session');
            session_start();
        }
    }

    /** Deactivated accounts fail exactly like a wrong password so the response does not reveal account status. */
    public static function attempt(string $email, string $password): ?array
    {
        $user = Database::one('SELECT * FROM users WHERE email = ?', [$email]);
        if ($user === null || !(int) $user['is_active'] || !password_verify($password, $user['password_hash'])) {
            return null;
        }
        session_regenerate_id(true);
        $_SESSION['user_id'] = (int) $user['user_id'];
        Database::run('UPDATE users SET last_login_at = NOW() WHERE user_id = ?', [$user['user_id']]);
        $user['last_login_at'] = date('Y-m-d H:i:s');

        return self::publicUser($user);
    }

    public static function logout(): void
    {
        $_SESSION = [];
        session_destroy();
    }

    /** Re-read on every request so deactivation and role changes take effect on existing sessions. */
    public static function user(): ?array
    {
        $id = $_SESSION['user_id'] ?? null;
        if ($id === null) {
            return null;
        }
        $user = Database::one('SELECT * FROM users WHERE user_id = ? AND is_active = 1', [$id]);

        return $user === null ? null : self::publicUser($user);
    }

    public static function require(array $roles = self::ANY_STAFF): array
    {
        $user = self::user();
        if ($user === null) {
            throw new HttpException(401, 'Authentication required.');
        }
        if (!in_array($user['role'], $roles, true)) {
            throw new HttpException(403, 'You do not have permission to perform this action.');
        }

        return $user;
    }

    public static function hashPassword(string $password): string
    {
        return password_hash($password, PASSWORD_DEFAULT);
    }

    /** Readable one-time password without look-alike characters, for admin-issued accounts. */
    public static function temporaryPassword(): string
    {
        $alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
        $password = '';
        for ($i = 0; $i < 12; $i++) {
            $password .= $alphabet[random_int(0, strlen($alphabet) - 1)];
            if ($i === 3 || $i === 7) {
                $password .= '-';
            }
        }

        return $password;
    }

    public static function publicUser(array $user): array
    {
        unset($user['password_hash']);
        $user['user_id'] = (int) $user['user_id'];
        $user['is_active'] = (bool) $user['is_active'];
        $user['must_change_password'] = (bool) $user['must_change_password'];

        return $user;
    }
}
