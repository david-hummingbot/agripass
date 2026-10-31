<?php

declare(strict_types=1);

namespace AgriPass\Services;

use AgriPass\Core\Database;

/**
 * Post-event analytics: KPI scorecard, session turnout and arrival times, chapter and license breakdowns,
 * and custom-field tallies. Shared by the Reports tab, the PDF summary and the CSV exports.
 */
final class EventReport
{
    private const NOT_SPECIFIED = 'Not specified';

    public static function build(array $event): array
    {
        $eventId = (int) $event['event_id'];
        $registrants = Database::all(
            "SELECT r.registration_id, r.payment_status, r.amount_paid, r.custom_responses,
                    m.chapter_region, m.prc_license_number, m.membership_status,
                    (SELECT COUNT(*) FROM attendances a JOIN event_sessions s ON s.session_id = a.session_id
                     WHERE a.registration_id = r.registration_id AND s.event_id = r.event_id) AS sessions_attended
             FROM registrations r JOIN members m ON m.member_id = r.member_id
             WHERE r.event_id = ?",
            [$eventId],
        );
        $sessions = Database::all(
            'SELECT s.session_id, s.session_name, s.session_date, s.start_time, s.end_time,
                    COUNT(a.attendance_id) AS attended, COALESCE(SUM(a.is_offline_sync), 0) AS offline
             FROM event_sessions s LEFT JOIN attendances a ON a.session_id = s.session_id
             WHERE s.event_id = ? GROUP BY s.session_id ORDER BY s.session_date, s.start_time',
            [$eventId],
        );

        return [
            'generated_at' => date('Y-m-d H:i:s'),
            'kpis' => self::kpis($event, $registrants, $sessions),
            'sessions' => self::sessions($registrants, $sessions),
            'arrivals' => self::arrivals($eventId, $sessions),
            'chapters' => self::groupBy($registrants, static fn ($r) => $r['chapter_region'] ?: self::NOT_SPECIFIED),
            'licensed' => self::groupBy($registrants, static fn ($r) => trim((string) $r['prc_license_number']) !== '' ? 'PRC licensed' : 'No PRC license on file'),
            'membership' => self::groupBy($registrants, static fn ($r) => match ($r['membership_status']) {
                'Active' => 'Active member', 'Inactive' => 'Inactive member', default => 'Non-member',
            }),
            'custom_fields' => self::customFields($eventId, $registrants),
        ];
    }

    private static function kpis(array $event, array $registrants, array $sessions): array
    {
        $payments = ['Pending' => 0, 'Paid' => 0, 'Waived' => 0, 'Refunded' => 0];
        $revenue = 0.0;
        foreach ($registrants as $r) {
            $payments[$r['payment_status']]++;
            if ($r['payment_status'] === 'Paid') {
                $revenue += (float) $r['amount_paid'];
            }
        }
        $registered = count($registrants);
        $attended = count(array_filter($registrants, static fn ($r) => (int) $r['sessions_attended'] > 0));
        $eligibility = CertificateService::eligibility($event);
        $scans = array_sum(array_map(static fn ($s) => (int) $s['attended'], $sessions));

        return [
            'registered' => $registered,
            'attended' => $attended,
            'turnout_pct' => self::pct($attended, $registered),
            'cleared' => $payments['Paid'] + $payments['Waived'],
            'payments' => $payments,
            'revenue' => $revenue,
            'outstanding' => $payments['Pending'] * (float) $event['registration_fee'],
            'cpd_eligible' => count(array_filter($eligibility, static fn ($r) => $r['eligible'])),
            'certificates_issued' => count(array_filter($eligibility, static fn ($r) => $r['certificate_id'] !== null && $r['revoked_at'] === null)),
            'total_scans' => $scans,
            'offline_scans' => array_sum(array_map(static fn ($s) => (int) $s['offline'], $sessions)),
        ];
    }

    private static function sessions(array $registrants, array $sessions): array
    {
        $cleared = count(array_filter($registrants, static fn ($r) => in_array($r['payment_status'], ['Paid', 'Waived'], true)));

        return array_map(static fn (array $s) => [
            'session_id' => (int) $s['session_id'],
            'session_name' => $s['session_name'],
            'session_date' => $s['session_date'],
            'start_time' => $s['start_time'],
            'end_time' => $s['end_time'],
            'attended' => (int) $s['attended'],
            'offline' => (int) $s['offline'],
            'turnout_pct' => self::pct((int) $s['attended'], $cleared),
        ], $sessions);
    }

    /** Check-ins per hour for each session, with empty hours filled in so the chart has no gaps. */
    private static function arrivals(int $eventId, array $sessions): array
    {
        $rows = Database::all(
            'SELECT a.session_id, HOUR(a.check_in_time) AS hour, COUNT(*) AS total
             FROM attendances a JOIN event_sessions s ON s.session_id = a.session_id
             WHERE s.event_id = ? GROUP BY a.session_id, DATE(a.check_in_time), HOUR(a.check_in_time)',
            [$eventId],
        );
        $bySession = [];
        foreach ($rows as $row) {
            $bySession[(int) $row['session_id']][(int) $row['hour']] = ($bySession[(int) $row['session_id']][(int) $row['hour']] ?? 0) + (int) $row['total'];
        }

        $result = [];
        foreach ($sessions as $s) {
            $counts = $bySession[(int) $s['session_id']] ?? [];
            if (!$counts) {
                continue;
            }
            $hours = [];
            for ($h = min(array_keys($counts)); $h <= max(array_keys($counts)); $h++) {
                $hours[] = ['hour' => sprintf('%02d:00', $h), 'count' => $counts[$h] ?? 0];
            }
            $peak = array_reduce($hours, static fn ($best, $h) => $best === null || $h['count'] > $best['count'] ? $h : $best);
            $result[] = ['session_id' => (int) $s['session_id'], 'session_name' => $s['session_name'], 'hours' => $hours, 'peak' => $peak];
        }

        return $result;
    }

    /** Registered vs attended counts per group, largest group first. */
    private static function groupBy(array $registrants, callable $key): array
    {
        $groups = [];
        foreach ($registrants as $r) {
            $name = $key($r);
            $groups[$name] ??= ['label' => $name, 'registered' => 0, 'attended' => 0];
            $groups[$name]['registered']++;
            if ((int) $r['sessions_attended'] > 0) {
                $groups[$name]['attended']++;
            }
        }
        usort($groups, static fn ($a, $b) => [$b['registered'], $a['label']] <=> [$a['registered'], $b['label']]);

        return array_map(static fn ($g) => [...$g, 'turnout_pct' => self::pct($g['attended'], $g['registered'])], $groups);
    }

    private static function customFields(int $eventId, array $registrants): array
    {
        $fields = Database::all('SELECT * FROM event_custom_fields WHERE event_id = ? ORDER BY field_id', [$eventId]);
        $answers = array_map(static fn ($r) => json_decode((string) $r['custom_responses'], true) ?: [], $registrants);

        return array_map(static function (array $field) use ($answers): array {
            $id = (string) $field['field_id'];
            $values = array_values(array_filter(array_map(static fn ($a) => $a[$id] ?? null, $answers), static fn ($v) => $v !== null && $v !== ''));
            $tally = [];
            switch ($field['field_type']) {
                case 'select':
                    foreach (json_decode((string) $field['field_options'], true) ?? [] as $option) {
                        $tally[$option] = 0;
                    }
                    foreach ($values as $v) {
                        $tally[(string) $v] = ($tally[(string) $v] ?? 0) + 1;
                    }
                    break;
                case 'checkbox':
                    $yes = count(array_filter($values, static fn ($v) => $v === true));
                    $tally = ['Yes' => $yes, 'No' => count($answers) - $yes];
                    break;
                default:
                    $display = [];
                    foreach ($values as $v) {
                        $key = mb_strtolower(trim((string) $v));
                        $display[$key] ??= trim((string) $v);
                        $tally[$display[$key]] = ($tally[$display[$key]] ?? 0) + 1;
                    }
                    arsort($tally);
                    $tally = array_slice($tally, 0, 10, true);
            }

            $result = [
                'field_id' => (int) $field['field_id'],
                'label' => $field['field_label'],
                'type' => $field['field_type'],
                'answered' => $field['field_type'] === 'checkbox' ? count($answers) : count($values),
                'options' => array_map(static fn ($k, $n) => ['value' => (string) $k, 'count' => $n], array_keys($tally), $tally),
            ];
            if ($field['field_type'] === 'number' && $values) {
                $numbers = array_map('floatval', $values);
                $result['average'] = round(array_sum($numbers) / count($numbers), 2);
            }

            return $result;
        }, $fields);
    }

    private static function pct(int $part, int $whole): float
    {
        return $whole > 0 ? round($part / $whole * 100, 1) : 0.0;
    }
}
