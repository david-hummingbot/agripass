<?php

declare(strict_types=1);

namespace AgriPass\Controllers;

use AgriPass\Core\AuditLog;
use AgriPass\Core\Database;
use AgriPass\Core\HttpException;
use AgriPass\Core\RateLimiter;
use AgriPass\Core\Request;
use AgriPass\Core\Response;

final class MemberController
{
    /**
     * Returning-member auto-fill. Requires the email plus the PRC license or PAA ID on file,
     * so a profile can't be pulled up with an email address alone.
     */
    public static function lookup(Request $request): void
    {
        RateLimiter::assertUnder('member.lookup_failed', 10, 15);
        $data = $request->validate(['email' => 'required', 'id_number' => 'required']);

        $member = Database::one(
            'SELECT first_name, last_name, email, contact_number, chapter_region, prc_license_number, paa_id_number, membership_status
             FROM members WHERE email = ? AND (prc_license_number = ? OR paa_id_number = ?)',
            [strtolower((string) $data['email']), $data['id_number'], $data['id_number']],
        );
        if ($member === null) {
            AuditLog::record(null, 'member.lookup_failed');
            throw new HttpException(404, "We couldn't find a member with those details. Please fill in the form below.");
        }

        Response::json(['member' => $member]);
    }
}
