<?php

declare(strict_types=1);

use AgriPass\Core\Config;
use AgriPass\Core\Database;
use AgriPass\Services\QrToken;

require __DIR__ . '/../vendor/autoload.php';

$email = Config::get('ADMIN_EMAIL', 'admin@paa.local');
$password = Config::get('ADMIN_PASSWORD');
if ($password === null) {
    fwrite(STDERR, "ADMIN_PASSWORD is not set.\n");
    exit(1);
}

$admin = Database::one('SELECT user_id FROM users WHERE email = ?', [$email]);
if ($admin === null) {
    $adminId = Database::insert(
        "INSERT INTO users (full_name, email, password_hash, role) VALUES ('PAA Super Admin', ?, ?, 'SuperAdmin')",
        [$email, password_hash($password, PASSWORD_DEFAULT)],
    );
    echo "Created super admin {$email}\n";
} else {
    $adminId = (int) $admin['user_id'];
    echo "Super admin {$email} already exists\n";
}

if (!in_array('--demo', $argv, true)) {
    exit(0);
}

seedCompletedSeminar($adminId);

if (Database::one("SELECT 1 FROM events WHERE title = 'PAA National Convention 2026'")) {
    echo "Demo event already exists\n";
    exit(0);
}

$eventId = Database::insert(
    "INSERT INTO events (title, event_type, description, venue, start_date, end_date, registration_fee, cpd_units,
                         prc_accreditation_no, status, is_active, created_by)
     VALUES ('PAA National Convention 2026', 'Convention', 'Annual national convention of agriculturists.',
             'Central Luzon State University, Science City of Muñoz, Nueva Ecija', '2026-11-18', '2026-11-19',
             1500.00, 12.00, 'PRC-AIPO-2026-0001', 'Active', 1, ?)",
    [$adminId],
);
Database::run('UPDATE events SET is_active = 0 WHERE event_id <> ?', [$eventId]);

$sessions = [
    ['Day 1 Morning Plenary', '2026-11-18', '08:00', '12:00'],
    ['Day 1 Afternoon Technical Track', '2026-11-18', '13:00', '17:00'],
    ['Day 2 Breakout Sessions', '2026-11-19', '08:00', '12:00'],
    ['Day 2 Field Demonstration', '2026-11-19', '13:00', '16:00'],
];
foreach ($sessions as [$name, $date, $start, $end]) {
    Database::run(
        'INSERT INTO event_sessions (event_id, session_name, session_date, start_time, end_time) VALUES (?, ?, ?, ?, ?)',
        [$eventId, $name, $date, $start, $end],
    );
}

Database::run(
    "INSERT INTO event_custom_fields (event_id, field_label, field_type, field_options, is_required) VALUES
        (?, 'T-Shirt Size', 'select', '[\"XS\",\"S\",\"M\",\"L\",\"XL\",\"2XL\"]', 1),
        (?, 'Dietary Restrictions', 'text', NULL, 0)",
    [$eventId, $eventId],
);

echo "Created demo event #{$eventId} with " . count($sessions) . " sessions\n";

/** A finished event with recorded attendance, for trying out CPD certificates. */
function seedCompletedSeminar(int $adminId): void
{
    $title = 'PAA Luzon Agri-Innovation Seminar 2026';
    if (Database::one('SELECT 1 FROM events WHERE title = ?', [$title])) {
        echo "Completed demo event already exists\n";
        return;
    }

    $eventId = Database::insert(
        "INSERT INTO events (title, event_type, description, venue, start_date, end_date, registration_fee, cpd_units,
                             cpd_min_attendance_pct, prc_accreditation_no, cert_signatory_name, cert_signatory_title, status, created_by)
         VALUES (?, 'Seminar', 'Two-day seminar on climate-smart farming and agri-technology.',
                 'University of the Philippines Los Baños, Laguna', '2026-09-15', '2026-09-16', 800.00, 8.00, 75,
                 'PRC-AIPO-2026-0412', 'Dr. Ramon C. Bautista', 'National President, Philippine Association of Agriculturists, Inc.',
                 'Completed', ?)",
        [$title, $adminId],
    );

    $sessionIds = [];
    foreach ([
        ['Day 1 Opening Plenary', '2026-09-15', '08:00', '12:00'],
        ['Day 1 Climate-Smart Farming Track', '2026-09-15', '13:00', '17:00'],
        ['Day 2 Precision Agriculture Workshop', '2026-09-16', '08:00', '12:00'],
        ['Day 2 Field Visit', '2026-09-16', '13:00', '16:00'],
    ] as [$name, $date, $start, $end]) {
        $sessionIds[] = [Database::insert(
            'INSERT INTO event_sessions (event_id, session_name, session_date, start_time, end_time) VALUES (?, ?, ?, ?, ?)',
            [$eventId, $name, $date, $start, $end],
        ), "{$date} {$start}"];
    }

    // [first, last, email, PRC license, chapter, payment status, sessions attended]
    $attendees = [
        ['Carmela', 'Villanueva', 'carmela.villanueva@example.com', '0071234', 'Region IV-A - CALABARZON', 'Paid', 4],
        ['Rafael', 'Mendoza', 'rafael.mendoza@example.com', '0068842', 'Region III - Central Luzon', 'Paid', 3],
        ['Teresa', 'Aquino', 'teresa.aquino@example.com', '0059310', 'NCR - National Capital Region', 'Paid', 2],
        ['Benjamin', 'Ocampo', 'benjamin.ocampo@example.com', '0080127', 'Region I - Ilocos Region', 'Pending', 4],
    ];
    foreach ($attendees as [$first, $last, $email, $prc, $chapter, $payment, $attended]) {
        $member = Database::one('SELECT member_id FROM members WHERE email = ?', [$email]);
        $memberId = $member ? (int) $member['member_id'] : Database::insert(
            'INSERT INTO members (prc_license_number, first_name, last_name, email, chapter_region) VALUES (?, ?, ?, ?, ?)',
            [$prc, $first, $last, $email, $chapter],
        );
        $registrationId = Database::insert(
            "INSERT INTO registrations (event_id, member_id, qr_token, payment_status, amount_paid) VALUES (?, ?, UUID(), ?, ?)",
            [$eventId, $memberId, $payment, $payment === 'Paid' ? 800 : 0],
        );
        Database::run('UPDATE registrations SET qr_token = ? WHERE registration_id = ?', [QrToken::make($eventId, $registrationId), $registrationId]);
        foreach (array_slice($sessionIds, 0, $attended) as [$sessionId, $startsAt]) {
            Database::run(
                'INSERT INTO attendances (registration_id, session_id, scanned_by, check_in_time) VALUES (?, ?, ?, ? + INTERVAL 12 MINUTE)',
                [$registrationId, $sessionId, $adminId, $startsAt],
            );
        }
    }

    echo "Created completed demo event #{$eventId} with " . count($attendees) . " attendees for certificate testing\n";
}
