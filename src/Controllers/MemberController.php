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
use AgriPass\Services\MemberProfile;
use PDOException;

final class MemberController
{
    private const PAGE_SIZE = 50;
    private const PROFILE_COLUMNS = 'm.member_id, m.paa_id_number, m.prc_license_number, m.first_name, m.last_name, m.email,
        m.contact_number, m.chapter_region, m.membership_status, m.created_at, m.last_portal_login_at';

    /** Admin member directory: search by name, email, PRC license or PAA ID, filter by status and chapter. */
    public static function index(Request $request): void
    {
        Auth::require(Auth::ADMINS);
        [$where, $params] = self::filters($request);
        $page = max(1, (int) $request->query('page', 1));
        $offset = ($page - 1) * self::PAGE_SIZE;

        $total = (int) Database::one("SELECT COUNT(*) AS total FROM members m {$where}", $params)['total'];
        $members = Database::all(
            'SELECT ' . self::PROFILE_COLUMNS . ",
                    (SELECT COUNT(*) FROM registrations r WHERE r.member_id = m.member_id) AS registrations,
                    (SELECT COUNT(*) FROM certificates c JOIN registrations r ON r.registration_id = c.registration_id
                     WHERE r.member_id = m.member_id AND c.revoked_at IS NULL) AS certificates,
                    (SELECT MAX(r.registration_date) FROM registrations r WHERE r.member_id = m.member_id) AS last_registered_at
             FROM members m {$where}
             ORDER BY m.last_name, m.first_name, m.member_id
             LIMIT " . self::PAGE_SIZE . " OFFSET {$offset}",
            $params,
        );

        Response::json([
            'members' => $members,
            'total' => $total,
            'page' => $page,
            'page_size' => self::PAGE_SIZE,
            'chapters' => array_column(Database::all(
                'SELECT DISTINCT chapter_region FROM members WHERE chapter_region IS NOT NULL ORDER BY chapter_region',
            ), 'chapter_region'),
        ]);
    }

    public static function show(Request $request): void
    {
        Auth::require(Auth::ADMINS);
        $member = self::find($request->param('id'));
        $registrations = Database::all(
            "SELECT r.registration_id, r.registration_date, r.payment_status, r.amount_paid, r.payment_reference,
                    e.event_id, e.title, e.start_date, e.end_date, e.status AS event_status, e.cpd_units,
                    (SELECT COUNT(*) FROM event_sessions s WHERE s.event_id = e.event_id) AS sessions_total,
                    (SELECT COUNT(*) FROM attendances a JOIN event_sessions s ON s.session_id = a.session_id
                     WHERE a.registration_id = r.registration_id AND s.event_id = e.event_id) AS sessions_attended,
                    c.certificate_id, c.certificate_no, c.cpd_units AS certificate_cpd_units, c.issued_at, c.revoked_at
             FROM registrations r
             JOIN events e ON e.event_id = r.event_id
             LEFT JOIN certificates c ON c.registration_id = r.registration_id
             WHERE r.member_id = ?
             ORDER BY e.start_date DESC, e.event_id DESC",
            [$member['member_id']],
        );
        $cpdEarned = array_sum(array_map(
            static fn ($r) => $r['certificate_id'] !== null && $r['revoked_at'] === null ? (float) $r['certificate_cpd_units'] : 0,
            $registrations,
        ));

        Response::json(['member' => $member, 'registrations' => $registrations, 'cpd_units_earned' => $cpdEarned]);
    }

    /** Changing the email cancels unused portal sign-in links, which were sent to the old address. */
    public static function update(Request $request): void
    {
        $user = Auth::require(Auth::ADMINS);
        $member = self::find($request->param('id'));
        $data = MemberProfile::validate($request, staff: true);

        try {
            Database::run(
                'UPDATE members SET first_name = ?, last_name = ?, email = ?, contact_number = ?, chapter_region = ?,
                                    prc_license_number = ?, paa_id_number = ?, membership_status = ?
                 WHERE member_id = ?',
                [$data['first_name'], $data['last_name'], $data['email'], $data['contact_number'], $data['chapter_region'],
                 $data['prc_license_number'], $data['paa_id_number'], $data['membership_status'], $member['member_id']],
            );
        } catch (PDOException $e) {
            if ($e->getCode() !== '23000') {
                throw $e;
            }
            throw MemberProfile::duplicateError($e);
        }

        $changed = MemberProfile::changedFields($member, $data);
        $details = ['changed' => $changed];
        if (in_array('email', $changed, true)) {
            Database::run('UPDATE member_login_tokens SET used_at = NOW() WHERE member_id = ? AND used_at IS NULL', [$member['member_id']]);
            $details['email'] = ['from' => $member['email'], 'to' => $data['email']];
        }
        if (in_array('membership_status', $changed, true)) {
            $details['membership_status'] = ['from' => $member['membership_status'], 'to' => $data['membership_status']];
        }
        if ($changed) {
            AuditLog::record($user['user_id'], 'member.update', 'member', (int) $member['member_id'], $details);
        }

        Response::json(['member' => self::find((int) $member['member_id'])]);
    }

    private static function find(int $id): array
    {
        return Database::one('SELECT ' . self::PROFILE_COLUMNS . ' FROM members m WHERE m.member_id = ?', [$id])
            ?? throw new HttpException(404, 'Member not found.');
    }

    /** @return array{0: string, 1: array} */
    private static function filters(Request $request): array
    {
        $clauses = [];
        $params = [];
        $q = trim((string) $request->query('q', ''));
        if ($q !== '') {
            $like = '%' . addcslashes($q, '%_\\') . '%';
            $clauses[] = "(CONCAT(m.first_name, ' ', m.last_name) LIKE ? OR CONCAT(m.last_name, ', ', m.first_name) LIKE ?
                           OR m.email LIKE ? OR m.prc_license_number LIKE ? OR m.paa_id_number LIKE ?)";
            array_push($params, $like, $like, $like, $like, $like);
        }
        $status = (string) $request->query('status', '');
        if (in_array($status, MemberProfile::STATUSES, true)) {
            $clauses[] = 'm.membership_status = ?';
            $params[] = $status;
        }
        $chapter = trim((string) $request->query('chapter', ''));
        if ($chapter !== '') {
            $clauses[] = 'm.chapter_region = ?';
            $params[] = $chapter;
        }

        return [$clauses ? 'WHERE ' . implode(' AND ', $clauses) : '', $params];
    }

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
