<?php

declare(strict_types=1);

use AgriPass\Core\Config;
use AgriPass\Core\Database;

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
