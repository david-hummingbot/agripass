<?php

declare(strict_types=1);

namespace AgriPass\Services;

use Dompdf\Dompdf;
use Dompdf\Options;

/**
 * Staff guide content shared by the in-app help pages and the printable PDF handouts.
 * Topics live in resources/help/{slug}.html; `{{APP_URL}}` is replaced with this installation's address.
 */
final class HelpGuide
{
    public const STAFF = 'staff';
    public const ADMIN = 'admin';

    /** slug => [title, Bootstrap icon, summary, audience]. Staff topics are in both handouts; admin topics only in the admin guide. */
    private const TOPICS = [
        'getting-started' => ['Getting started', 'signpost', 'Signing in, roles and the active event.', self::STAFF],
        'scanning' => ['Checking in attendees', 'qr-code-scan', 'Using the QR scanner and what each result means.', self::STAFF],
        'offline-kiosk' => ['Offline scanning and kiosk mode', 'wifi-off', 'Scanning without internet and self-service check-in.', self::STAFF],
        'helping-attendees' => ['Helping attendees', 'person-raised-hand', 'Lost passes, pending payments, walk-ins and My AgriPass.', self::STAFF],
        'events' => ['Setting up an event', 'calendar-event', 'Creating events, sessions and registration questions.', self::ADMIN],
        'registrations' => ['Registrations and payments', 'cash-coin', 'Payment statuses and verifying payments.', self::ADMIN],
        'certificates' => ['CPD certificates', 'award', 'Eligibility, issuing, revoking and verification.', self::ADMIN],
        'reports' => ['Reports and exports', 'bar-chart', 'Event figures, the summary PDF and PRC exports.', self::ADMIN],
        'members' => ['Members', 'person-vcard', 'Finding members and correcting their details.', self::ADMIN],
        'users' => ['Staff accounts', 'people', 'Adding staff, resetting passwords and roles (Super Admin).', self::ADMIN],
        'troubleshooting' => ['Troubleshooting', 'tools', 'Camera, offline, payment and email problems.', self::STAFF],
    ];

    /** @return list<array{slug: string, title: string, icon: string, summary: string, audience: string, html: string}> */
    public static function topics(string $audience): array
    {
        $topics = [];
        foreach (self::TOPICS as $slug => [$title, $icon, $summary, $topicAudience]) {
            if ($audience === self::STAFF && $topicAudience !== self::STAFF) {
                continue;
            }
            $topics[] = ['slug' => $slug, 'title' => $title, 'icon' => $icon, 'summary' => $summary, 'audience' => $topicAudience, 'html' => self::content($slug)];
        }

        return $topics;
    }

    public static function pdf(string $audience): string
    {
        $options = new Options();
        $options->setIsRemoteEnabled(false);
        $options->setDefaultFont('DejaVu Sans');
        $options->setTempDir(sys_get_temp_dir());

        $dompdf = new Dompdf($options);
        $dompdf->setPaper('A4', 'portrait');
        $dompdf->loadHtml(self::html($audience), 'UTF-8');
        $dompdf->render();

        $canvas = $dompdf->getCanvas();
        $font = $dompdf->getFontMetrics()->getFont('DejaVu Sans');
        $label = $audience === self::ADMIN ? 'AgriPass Staff Guide' : 'AgriPass Gate Staff Guide';
        $canvas->page_script(static function (int $page, int $total, $canvas) use ($font, $label): void {
            if ($page === 1) {
                return;
            }
            $canvas->text(42, 810, "{$label} · Philippine Association of Agriculturists, Inc.", $font, 7, [0.5, 0.5, 0.5]);
            $canvas->text(520, 810, "Page {$page} of {$total}", $font, 7, [0.5, 0.5, 0.5]);
        });

        return (string) $dompdf->output();
    }

    private static function content(string $slug): string
    {
        $html = (string) file_get_contents(dirname(__DIR__, 2) . "/resources/help/{$slug}.html");

        return str_replace('{{APP_URL}}', htmlspecialchars(Mailer::appUrl(''), ENT_QUOTES, 'UTF-8'), $html);
    }

    private static function html(string $audience): string
    {
        $topics = self::topics($audience);
        $e = static fn ($v) => htmlspecialchars((string) $v, ENT_QUOTES, 'UTF-8');
        $logo = 'data:image/png;base64,' . base64_encode((string) file_get_contents(dirname(__DIR__, 2) . '/public/assets/img/paa-logo.png'));
        [$title, $subtitle] = $audience === self::ADMIN
            ? ['Staff Guide', 'For Super Admins, Regional Officers and Gate Staff']
            : ['Gate Staff Guide', 'Checking in attendees at PAA events'];
        $date = date('F Y');

        $contents = implode('', array_map(static fn ($t, $i) => '<tr><td class="toc-num">' . ($i + 1) . '</td><td><strong>' . $e($t['title'])
            . '</strong><div class="muted">' . $e($t['summary']) . '</div></td></tr>', $topics, array_keys($topics)));
        $sections = implode('', array_map(static fn ($t, $i) => '<div class="topic"><div class="topic-num">Section ' . ($i + 1) . '</div><h2>'
            . $e($t['title']) . '</h2>' . $t['html'] . '</div>', $topics, array_keys($topics)));

        return <<<HTML
<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
    @page { margin: 48px 42px 54px; }
    body { font-family: 'DejaVu Sans', sans-serif; font-size: 9.5pt; color: #1f2a24; line-height: 1.45; }
    .cover { text-align: center; padding-top: 30px; }
    .cover img { width: 100px; }
    .cover .kicker { margin-top: 28px; font-size: 9pt; letter-spacing: 3px; text-transform: uppercase; color: #24704a; }
    .cover h1 { font-size: 30pt; color: #123b26; margin: 8px 0 4px; }
    .cover .sub { font-size: 12pt; color: #555; }
    .cover .rule { width: 80px; height: 4px; background: #ffd230; margin: 18px auto; }
    .cover .meta { font-size: 9pt; color: #777; }
    .cover .toc { width: 78%; margin: 28px auto 0; text-align: left; border-collapse: collapse; }
    .toc td { padding: 4px 6px; border-bottom: 1px solid #e3ebe0; vertical-align: top; font-size: 9pt; }
    .toc-num { width: 22px; color: #24704a; font-weight: bold; }
    .muted { color: #6b7570; font-size: 8pt; }
    .topic { page-break-before: always; }
    h3 { page-break-after: avoid; }
    .topic-num { font-size: 8pt; letter-spacing: 2px; text-transform: uppercase; color: #24704a; }
    h2 { font-size: 17pt; color: #123b26; margin: 2px 0 12px; padding-bottom: 6px; border-bottom: 3px solid #ffd230; }
    h3 { font-size: 11pt; color: #1c5739; margin: 16px 0 6px; }
    p { margin: 0 0 8px; }
    ul, ol { margin: 0 0 8px; padding-left: 18px; }
    li { margin-bottom: 3px; }
    code { font-family: 'DejaVu Sans Mono', monospace; font-size: 8.5pt; background: #f0f6ea; padding: 0 3px; }
    .ui { font-weight: bold; color: #123b26; background: #eef3ea; border: 1px solid #cfdcc8; padding: 0 4px; border-radius: 3px; white-space: nowrap; }
    .tip, .warn { padding: 7px 10px; border-left: 4px solid #24704a; background: #f0f6ea; }
    .warn { border-left-color: #c0392b; background: #fbeeed; }
    .help-table { width: 100%; border-collapse: collapse; margin: 4px 0 10px; }
    .help-table th { text-align: left; font-size: 8pt; text-transform: uppercase; color: #555; background: #f0f6ea; padding: 5px 6px; }
    .help-table td { padding: 5px 6px; border-bottom: 1px solid #e3ebe0; vertical-align: top; }
    .help-table tr { page-break-inside: avoid; }
    .result { font-weight: bold; padding: 1px 5px; border-radius: 3px; white-space: nowrap; }
    .result.valid { background: #d8f0e0; color: #146c43; }
    .result.duplicate, .result.invalid { background: #f8d7da; color: #a52834; }
    .result.unpaid { background: #ffe8b3; color: #7a5300; }
    .result.wrong { background: #fff3cd; color: #7a5300; }
</style></head><body>
<div class="cover">
    <img src="{$logo}" alt="">
    <div class="kicker">AgriPass</div>
    <h1>{$title}</h1>
    <div class="sub">{$subtitle}</div>
    <div class="rule"></div>
    <div class="meta">Philippine Association of Agriculturists, Inc. · {$date}</div>
    <table class="toc">{$contents}</table>
</div>
{$sections}
</body></html>
HTML;
    }
}
