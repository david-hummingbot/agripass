<?php

declare(strict_types=1);

namespace AgriPass\Controllers;

use AgriPass\Core\AuditLog;
use AgriPass\Core\Auth;
use AgriPass\Core\Database;
use AgriPass\Core\HttpException;
use AgriPass\Core\Request;
use AgriPass\Core\Response;

/** Staff account management. Super Admin only. */
final class UserController
{
    private const COLUMNS = 'user_id, full_name, email, role, is_active, must_change_password, last_login_at, created_at';

    public static function index(Request $request): void
    {
        Auth::require([Auth::SUPER_ADMIN]);
        $users = Database::all('SELECT ' . self::COLUMNS . " FROM users ORDER BY is_active DESC, FIELD(role, 'SuperAdmin', 'RegionalOfficer', 'Staff'), full_name");

        Response::json(['users' => array_map([Auth::class, 'publicUser'], $users)]);
    }

    public static function store(Request $request): void
    {
        $admin = Auth::require([Auth::SUPER_ADMIN]);
        $data = self::validated($request);

        $temporary = Auth::temporaryPassword();
        $id = Database::insert(
            'INSERT INTO users (full_name, email, password_hash, role, must_change_password) VALUES (?, ?, ?, ?, 1)',
            [$data['full_name'], $data['email'], Auth::hashPassword($temporary), $data['role']],
        );
        AuditLog::record($admin['user_id'], 'user.create', 'user', $id, ['role' => $data['role']]);

        Response::json(['user' => self::find($id), 'temporary_password' => $temporary], 201);
    }

    public static function update(Request $request): void
    {
        $admin = Auth::require([Auth::SUPER_ADMIN]);
        $user = self::find($request->param('id'));
        $data = self::validated($request, $user['user_id']);
        $isActive = $request->input('is_active', $user['is_active']);
        if (!is_bool($isActive)) {
            throw new HttpException(422, 'Validation failed.', ['is_active' => 'Must be true or false.']);
        }

        if ($user['user_id'] === $admin['user_id'] && ($data['role'] !== $user['role'] || !$isActive)) {
            throw new HttpException(409, 'You cannot change your own role or deactivate your own account.');
        }
        $losesSuperAdmin = $user['role'] === Auth::SUPER_ADMIN && $user['is_active'] && ($data['role'] !== Auth::SUPER_ADMIN || !$isActive);
        if ($losesSuperAdmin && self::activeSuperAdminCount() <= 1) {
            throw new HttpException(409, 'At least one active Super Admin is required.');
        }

        Database::run(
            'UPDATE users SET full_name = ?, email = ?, role = ?, is_active = ? WHERE user_id = ?',
            [$data['full_name'], $data['email'], $data['role'], $isActive ? 1 : 0, $user['user_id']],
        );

        $changes = [];
        foreach (['full_name', 'email', 'role'] as $field) {
            if ($data[$field] !== $user[$field]) {
                $changes[$field] = ['from' => $user[$field], 'to' => $data[$field]];
            }
        }
        if ($isActive !== $user['is_active']) {
            $changes['is_active'] = ['from' => $user['is_active'], 'to' => $isActive];
        }
        AuditLog::record($admin['user_id'], 'user.update', 'user', $user['user_id'], $changes);

        Response::json(['user' => self::find($user['user_id'])]);
    }

    public static function resetPassword(Request $request): void
    {
        $admin = Auth::require([Auth::SUPER_ADMIN]);
        $user = self::find($request->param('id'));

        $temporary = Auth::temporaryPassword();
        Database::run(
            'UPDATE users SET password_hash = ?, must_change_password = 1 WHERE user_id = ?',
            [Auth::hashPassword($temporary), $user['user_id']],
        );
        AuditLog::record($admin['user_id'], 'user.password_reset', 'user', $user['user_id']);

        Response::json(['user' => self::find($user['user_id']), 'temporary_password' => $temporary]);
    }

    private static function validated(Request $request, ?int $userId = null): array
    {
        $data = $request->validate(['full_name' => 'required', 'email' => 'required', 'role' => 'required']);
        $data['email'] = strtolower((string) $data['email']);

        $errors = [];
        if (mb_strlen((string) $data['full_name']) > 100) {
            $errors['full_name'] = 'Use 100 characters or fewer.';
        }
        if (!filter_var($data['email'], FILTER_VALIDATE_EMAIL) || strlen($data['email']) > 100) {
            $errors['email'] = 'Enter a valid email address.';
        } elseif (Database::one('SELECT 1 FROM users WHERE email = ? AND user_id <> ?', [$data['email'], $userId ?? 0])) {
            $errors['email'] = 'Another account already uses this email.';
        }
        if (!in_array($data['role'], Auth::ROLES, true)) {
            $errors['role'] = 'Choose a valid role.';
        }
        if ($errors) {
            throw new HttpException(422, 'Validation failed.', $errors);
        }

        return $data;
    }

    private static function find(int $id): array
    {
        $user = Database::one('SELECT ' . self::COLUMNS . ' FROM users WHERE user_id = ?', [$id]);
        if ($user === null) {
            throw new HttpException(404, 'User not found.');
        }

        return Auth::publicUser($user);
    }

    private static function activeSuperAdminCount(): int
    {
        return (int) Database::one("SELECT COUNT(*) AS total FROM users WHERE role = 'SuperAdmin' AND is_active = 1")['total'];
    }
}
