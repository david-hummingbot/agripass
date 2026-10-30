<?php

declare(strict_types=1);

namespace AgriPass\Controllers;

use AgriPass\Core\AuditLog;
use AgriPass\Core\Auth;
use AgriPass\Core\Database;
use AgriPass\Core\HttpException;
use AgriPass\Core\RateLimiter;
use AgriPass\Core\Request;
use AgriPass\Core\Response;

final class AuthController
{
    public static function login(Request $request): void
    {
        $data = $request->validate(['email' => 'required', 'password' => 'required']);
        RateLimiter::assertUnder('auth.login_failed', 10, 15);

        $user = Auth::attempt((string) $data['email'], (string) $data['password']);
        if ($user === null) {
            AuditLog::record(null, 'auth.login_failed', details: ['email' => mb_substr((string) $data['email'], 0, 100)]);
            throw new HttpException(401, 'Invalid email or password.');
        }
        AuditLog::record($user['user_id'], 'auth.login');
        Response::json(['user' => $user]);
    }

    public static function logout(Request $request): void
    {
        Auth::logout();
        Response::json(['ok' => true]);
    }

    public static function me(Request $request): void
    {
        Response::json(['user' => Auth::require()]);
    }

    public static function changePassword(Request $request): void
    {
        $user = Auth::require();
        $data = $request->validate(['current_password' => 'required', 'new_password' => 'required']);

        $hash = Database::one('SELECT password_hash FROM users WHERE user_id = ?', [$user['user_id']])['password_hash'];
        if (!password_verify((string) $data['current_password'], $hash)) {
            throw new HttpException(422, 'Validation failed.', ['current_password' => 'Current password is incorrect.']);
        }
        $new = (string) $data['new_password'];
        if (mb_strlen($new) < Auth::MIN_PASSWORD_LENGTH) {
            throw new HttpException(422, 'Validation failed.', ['new_password' => 'Use at least ' . Auth::MIN_PASSWORD_LENGTH . ' characters.']);
        }
        if ($new === $data['current_password']) {
            throw new HttpException(422, 'Validation failed.', ['new_password' => 'Choose a password different from the current one.']);
        }

        Database::run(
            'UPDATE users SET password_hash = ?, must_change_password = 0 WHERE user_id = ?',
            [Auth::hashPassword($new), $user['user_id']],
        );
        session_regenerate_id(true);
        AuditLog::record($user['user_id'], 'auth.password_changed', 'user', $user['user_id']);
        Response::json(['user' => Auth::require()]);
    }
}
