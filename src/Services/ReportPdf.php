<?php

declare(strict_types=1);

namespace AgriPass\Services;

use Dompdf\Dompdf;
use Dompdf\Options;

/** A4 portrait executive summary of an event, built from EventReport data. */
final class ReportPdf
{
    public static function render(array $event, array $report): string
    {
        $options = new Options();
        $options->setIsRemoteEnabled(false);
        $options->setDefaultFont('DejaVu Sans');
        $options->setTempDir(sys_get_temp_dir());

        $dompdf = new Dompdf($options);
        $dompdf->setPaper('A4', 'portrait');
        $dompdf->loadHtml(self::html($event, $report), 'UTF-8');
        $dompdf->render();

        return (string) $dompdf->output();
    }

    private static function html(array $event, array $report): string
    {
        $e = static fn ($v) => htmlspecialchars((string) $v, ENT_QUOTES, 'UTF-8');
        $peso = static fn ($v) => 'PHP ' . number_format((float) $v, 2);
        $logo = 'data:image/png;base64,' . base64_encode((string) file_get_contents(dirname(__DIR__, 2) . '/public/assets/img/paa-logo.png'));
        $k = $report['kpis'];
        $generated = (new \DateTimeImmutable($report['generated_at']))->format('F j, Y g:i A');

        $kpi = static fn (string $label, string $value, string $sub = '') => "<td class=\"kpi\"><div class=\"kpi-label\">{$label}</div>
            <div class=\"kpi-value\">{$value}</div><div class=\"kpi-sub\">{$sub}</div></td>";
        $bar = static fn (float $pct) => '<div class="bar"><div class="fill" style="width:' . max(0, min(100, $pct)) . '%"></div></div>';

        $sessionRows = implode('', array_map(static fn ($s) => '<tr><td style="width:38%">' . $e($s['session_name']) . '<div class="muted">'
            . $e((new \DateTimeImmutable($s['session_date']))->format('M j')) . ', ' . $e(substr($s['start_time'], 0, 5)) . '–' . $e(substr($s['end_time'], 0, 5)) . '</div></td>'
            . '<td class="num">' . $s['attended'] . '</td><td class="num">' . $s['offline'] . '</td><td style="width:30%">' . $bar($s['turnout_pct'])
            . '</td><td class="num">' . $s['turnout_pct'] . '%</td></tr>', $report['sessions'])) ?: '<tr><td colspan="5" class="muted">No sessions.</td></tr>';

        $arrivals = implode('', array_map(static function ($a) use ($e, $bar) {
            $max = max(array_column($a['hours'], 'count')) ?: 1;
            $rows = implode('', array_map(static fn ($h) => '<tr><td class="hour">' . $e($h['hour']) . '</td><td>' . $bar($h['count'] / $max * 100)
                . '</td><td class="count">' . $h['count'] . '</td></tr>', $a['hours']));

            return '<div class="arrival"><div class="arrival-title">' . $e($a['session_name']) . ' <span class="muted">· peak ' . $e($a['peak']['hour'])
                . ' (' . $a['peak']['count'] . ')</span></div><table class="compact">' . $rows . '</table></div>';
        }, $report['arrivals'])) ?: '<p class="muted">No check-ins recorded yet.</p>';

        $groupTable = static function (array $groups, string $heading, bool $withBar = true) use ($e, $bar) {
            $rows = implode('', array_map(static fn ($g) => '<tr><td>' . $e($g['label']) . '</td><td class="num">' . $g['registered'] . '</td><td class="num">'
                . $g['attended'] . '</td>' . ($withBar ? '<td style="width:30%">' . $bar($g['turnout_pct']) . '</td>' : '')
                . '<td class="num">' . $g['turnout_pct'] . '%</td></tr>', $groups));
            $cols = $withBar ? 5 : 4;

            return "<table><thead><tr><th>{$heading}</th><th class=\"num\">Registered</th><th class=\"num\">Attended</th><th class=\"num\" colspan=\""
                . ($cols - 3) . '">Turnout</th></tr></thead><tbody>'
                . ($rows ?: "<tr><td colspan=\"{$cols}\" class=\"muted\">No registrations.</td></tr>") . '</tbody></table>';
        };

        $customFields = implode('', array_map(static function ($f) use ($e, $bar) {
            $total = max(1, array_sum(array_column($f['options'], 'count')));
            $rows = implode('', array_map(static fn ($o) => '<tr><td class="label">' . $e($o['value']) . '</td><td>' . $bar($o['count'] / $total * 100)
                . '</td><td class="count">' . $o['count'] . '</td></tr>', $f['options']));
            $note = $f['type'] === 'text' ? ' <span class="muted">· most common answers</span>' : '';
            $avg = isset($f['average']) ? ' <span class="muted">· average ' . $e($f['average']) . '</span>' : '';

            return '<div class="field"><div class="arrival-title">' . $e($f['label']) . $note . $avg . ' <span class="muted">· ' . $f['answered'] . ' answered</span></div>'
                . '<table class="compact">' . ($rows ?: '<tr><td class="muted">No answers.</td></tr>') . '</table></div>';
        }, $report['custom_fields'])) ?: '<p class="muted">This event has no custom registration questions.</p>';

        $title = $e($event['title']);
        $venue = $e($event['venue']);
        $dates = $e(Mailer::eventDates($event));
        $status = $e($event['status']);
        $accreditation = $event['prc_accreditation_no'] ? ' · PRC accreditation ' . $e($event['prc_accreditation_no']) : '';
        $kpiRow1 = $kpi('Registered', (string) $k['registered'], $k['cleared'] . ' paid or waived')
            . $kpi('Attended', (string) $k['attended'], $k['turnout_pct'] . '% turnout')
            . $kpi('CPD eligible', (string) $k['cpd_eligible'], $k['certificates_issued'] . ' certificates issued')
            . $kpi('Check-ins', (string) $k['total_scans'], $k['offline_scans'] . ' synced from offline');
        $kpiRow2 = $kpi('Revenue collected', $peso($k['revenue']), $k['payments']['Paid'] . ' paid registrations')
            . $kpi('Pending payment', (string) $k['payments']['Pending'], $peso($k['outstanding']) . ' outstanding')
            . $kpi('Waived', (string) $k['payments']['Waived'], 'No fee due')
            . $kpi('Refunded', (string) $k['payments']['Refunded'], 'Passes invalid');

        return <<<HTML
            <!doctype html>
            <html><head><meta charset="utf-8"><style>
                @page { margin: 16mm 14mm; }
                body { font-family: 'DejaVu Sans', sans-serif; font-size: 9pt; color: #1f2a24; }
                .header { border-bottom: 3px solid #ffd230; padding-bottom: 8px; margin-bottom: 12px; }
                .header img { height: 46px; float: left; margin-right: 12px; }
                .doc-title { font-size: 8pt; letter-spacing: 2px; text-transform: uppercase; color: #1c5739; }
                h1 { font-size: 15pt; margin: 2px 0; color: #12402a; }
                .meta { color: #666; font-size: 8pt; }
                h2 { font-size: 10.5pt; color: #1c5739; margin: 16px 0 6px; border-bottom: 1px solid #e3ebdc; padding-bottom: 3px; }
                table { width: 100%; border-collapse: collapse; }
                th { text-align: left; font-size: 7.5pt; text-transform: uppercase; color: #666; border-bottom: 1px solid #ccd8c6; padding: 4px; }
                td { padding: 4px; border-bottom: 1px solid #eef2ea; vertical-align: middle; }
                .num { text-align: right; white-space: nowrap; }
                .muted { color: #888; font-size: 7.5pt; }
                .kpis td.kpi { width: 25%; border: 1px solid #e3ebdc; background: #f6f9f3; padding: 7px; vertical-align: top; }
                .kpi-label { font-size: 7pt; text-transform: uppercase; color: #666; }
                .kpi-value { font-size: 14pt; font-weight: bold; color: #12402a; }
                .kpi-sub { font-size: 7pt; color: #777; }
                .bar { background: #eef2ea; height: 7px; border-radius: 3px; }
                .fill { background: #1c5739; height: 7px; border-radius: 3px; }
                .compact { width: 75%; table-layout: fixed; }
                .compact td { border: none; padding: 1px 4px; }
                .compact td.label { width: 30%; }
                .compact td.count { width: 8%; text-align: right; }
                .hour { width: 12%; color: #666; }
                .arrival, .field { margin-bottom: 10px; page-break-inside: avoid; }
                .arrival-title { font-weight: bold; margin-bottom: 2px; }
                .two-col td.col { width: 50%; vertical-align: top; border: none; padding: 0 6px 0 0; }
                .footer { position: fixed; bottom: -8mm; left: 0; right: 0; font-size: 7pt; color: #999; text-align: center; }
            </style></head><body>
                <div class="footer">AgriPass · Philippine Association of Agriculturists, Inc. · Generated {$generated}</div>
                <div class="header">
                    <img src="{$logo}">
                    <div class="doc-title">Event executive summary</div>
                    <h1>{$title}</h1>
                    <div class="meta">{$venue} · {$dates} · Status: {$status}{$accreditation}</div>
                    <div style="clear:both"></div>
                </div>

                <table class="kpis" style="border-collapse: separate; border-spacing: 4px; margin: 0 -4px;">
                    <tr>{$kpiRow1}</tr>
                    <tr>{$kpiRow2}</tr>
                </table>

                <h2>Session attendance</h2>
                <table><thead><tr><th>Session</th><th class="num">Checked in</th><th class="num">Offline</th><th colspan="2">Turnout of paid / waived</th></tr></thead>
                    <tbody>{$sessionRows}</tbody></table>

                <h2>Arrivals by hour</h2>
                {$arrivals}

                <h2>Chapter participation</h2>
                {$groupTable($report['chapters'], 'Chapter / region')}

                <table class="two-col" style="margin-top: 6px"><tr>
                    <td class="col"><h2>PRC license status</h2>{$groupTable($report['licensed'], 'License', false)}</td>
                    <td class="col"><h2>PAA membership</h2>{$groupTable($report['membership'], 'Membership', false)}</td>
                </tr></table>

                <h2>Registration form answers</h2>
                {$customFields}
            </body></html>
            HTML;
    }
}
