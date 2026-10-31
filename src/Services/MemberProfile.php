<?php

declare(strict_types=1);

namespace AgriPass\Services;

use AgriPass\Core\HttpException;
use AgriPass\Core\Request;

/** Validation for member profile edits, shared by the member portal and the admin member directory. */
final class MemberProfile
{
    public const STATUSES = ['Active', 'Inactive', 'NonMember'];

    private const LIMITS = [
        'first_name' => 50, 'last_name' => 50, 'email' => 100, 'contact_number' => 20,
        'chapter_region' => 100, 'prc_license_number' => 50, 'paa_id_number' => 50,
    ];

    /** @param bool $staff Staff may also change the email address and membership status. */
    public static function validate(Request $request, bool $staff = false): array
    {
        $rules = [
            'first_name' => 'required',
            'last_name' => 'required',
            'contact_number' => 'optional',
            'chapter_region' => 'optional',
            'prc_license_number' => 'optional',
            'paa_id_number' => 'optional',
        ];
        if ($staff) {
            $rules += ['email' => 'required', 'membership_status' => 'required'];
        }
        $data = $request->validate($rules);

        $errors = [];
        foreach (self::LIMITS as $field => $max) {
            if (isset($data[$field]) && mb_strlen((string) $data[$field]) > $max) {
                $errors[$field] = "Use {$max} characters or fewer.";
            }
        }
        if ($data['contact_number'] !== null && !preg_match('/^[0-9+()\-\s]{7,20}$/', (string) $data['contact_number'])) {
            $errors['contact_number'] = 'Enter a valid phone number.';
        }
        if ($staff) {
            $data['email'] = strtolower((string) $data['email']);
            if (!filter_var($data['email'], FILTER_VALIDATE_EMAIL)) {
                $errors['email'] = 'Enter a valid email address.';
            }
            if (!in_array($data['membership_status'], self::STATUSES, true)) {
                $errors['membership_status'] = 'Must be one of: ' . implode(', ', self::STATUSES) . '.';
            }
        }
        if ($errors) {
            throw new HttpException(422, 'Validation failed.', $errors);
        }

        return $data;
    }

    /** Maps a unique-key violation on members to a field error. */
    public static function duplicateError(\PDOException $e): HttpException
    {
        $field = str_contains($e->getMessage(), 'email') ? 'email' : 'paa_id_number';

        return new HttpException(422, 'Validation failed.', [$field => $field === 'email'
            ? 'Another member already uses this email address.'
            : 'This PAA ID is linked to another member.']);
    }

    /** Names of fields whose value differs from the stored record. */
    public static function changedFields(array $before, array $after): array
    {
        return array_keys(array_filter($after, static fn ($v, $k) => (string) $v !== (string) ($before[$k] ?? ''), ARRAY_FILTER_USE_BOTH));
    }
}
