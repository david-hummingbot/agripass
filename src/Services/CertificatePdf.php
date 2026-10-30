<?php

declare(strict_types=1);

namespace AgriPass\Services;

use Dompdf\Dompdf;
use Dompdf\Options;

/** A4 landscape Certificate of Attendance. Images are inlined as data URIs so dompdf never fetches remote files. */
final class CertificatePdf
{
    public static function render(array $certificate, array $event, bool $sample = false): string
    {
        $options = new Options();
        $options->setIsRemoteEnabled(false);
        $options->setDefaultFont('DejaVu Sans');
        $options->setTempDir(sys_get_temp_dir());

        $dompdf = new Dompdf($options);
        $dompdf->setPaper('A4', 'landscape');
        $dompdf->loadHtml(self::html($certificate, $event, $sample), 'UTF-8');
        $dompdf->render();

        return (string) $dompdf->output();
    }

    public static function signatureFile(?string $relativePath): ?string
    {
        if ($relativePath === null) {
            return null;
        }
        $path = dirname(__DIR__, 2) . '/' . $relativePath;

        return is_file($path) ? $path : null;
    }

    private static function html(array $c, array $event, bool $sample): string
    {
        $e = static fn (?string $v) => htmlspecialchars((string) $v, ENT_QUOTES, 'UTF-8');
        $dataUri = static fn (string $bytes) => 'data:image/png;base64,' . base64_encode($bytes);

        $logo = $dataUri((string) file_get_contents(dirname(__DIR__, 2) . '/public/assets/img/paa-logo.png'));
        $verifyUrl = CertificateService::verifyUrl($c['verification_code']);
        $qr = $dataUri(QrImage::png($verifyUrl, 6));
        $signatureFile = self::signatureFile($event['cert_signature_path'] ?? null);
        $signature = $signatureFile ? '<img class="sig-img" src="' . $dataUri((string) file_get_contents($signatureFile)) . '">' : '<div class="sig-space"></div>';

        $units = (float) $c['cpd_units'];
        $unitsText = $units > 0
            ? ', and is hereby credited with <span class="units">' . $e(rtrim(rtrim(number_format($units, 2), '0'), '.')) . ' CPD unit' . ($units == 1.0 ? '' : 's') . '</span>'
            : '';
        $license = $c['prc_license_number'] ? '<div class="license">PRC License No. ' . $e($c['prc_license_number']) . '</div>' : '';
        $accreditation = $event['prc_accreditation_no'] ? 'PRC Accreditation No. <strong>' . $e($event['prc_accreditation_no']) . '</strong><br>' : '';
        $issued = (new \DateTimeImmutable($c['issued_at'] ?? 'now'))->format('F j, Y');
        $watermark = $sample ? '<div class="watermark">SAMPLE</div>' : '';

        return <<<HTML
            <!doctype html>
            <html><head><meta charset="utf-8"><style>
                @page { margin: 0; }
                body { margin: 0; font-family: 'DejaVu Sans', sans-serif; color: #1f2a24; }
                .page { position: relative; width: 297mm; height: 209mm; overflow: hidden; }
                .band { position: absolute; left: 0; right: 0; height: 6mm; background: #1c5739; }
                .band.top { top: 0; } .band.bottom { bottom: 0; }
                .frame { position: absolute; top: 11mm; left: 11mm; right: 11mm; bottom: 11mm; border: 1.6mm solid #1c5739; }
                .frame-inner { position: absolute; top: 14mm; left: 14mm; right: 14mm; bottom: 14mm; border: .5mm solid #ffd230; }
                .content { position: absolute; top: 19mm; left: 28mm; right: 28mm; text-align: center; }
                .logo { height: 24mm; }
                .org { margin-top: 2mm; font-size: 9.5pt; letter-spacing: 2.5pt; text-transform: uppercase; color: #4a5a50; }
                h1 { margin: 4mm 0 0; font-family: 'DejaVu Serif', serif; font-size: 27pt; letter-spacing: 1.5pt; color: #1c5739; font-weight: bold; }
                .certifies { margin-top: 5mm; font-size: 11pt; color: #4a5a50; }
                .name { display: inline-block; margin-top: 3mm; padding: 0 12mm 1.5mm; border-bottom: .5mm solid #ffd230;
                        font-family: 'DejaVu Serif', serif; font-size: 25pt; font-weight: bold; color: #123b26; }
                .license { margin-top: 1.5mm; font-size: 9.5pt; color: #4a5a50; }
                .body { margin: 4.5mm auto 0; width: 200mm; font-size: 11.5pt; line-height: 1.55; }
                .event { font-weight: bold; color: #123b26; }
                .units { font-weight: bold; color: #1c5739; font-size: 13pt; }
                .footer { position: absolute; left: 28mm; right: 28mm; bottom: 21mm; }
                .footer table { width: 100%; border-collapse: collapse; }
                .footer td { vertical-align: bottom; }
                .meta { width: 34%; font-size: 8pt; line-height: 1.5; color: #4a5a50; }
                .sig { width: 36%; text-align: center; }
                .sig-img { max-height: 15mm; max-width: 60mm; }
                .sig-space { height: 15mm; }
                .sig-name { border-top: .3mm solid #1f2a24; margin: 0 6mm; padding-top: 1.2mm; font-size: 10pt; font-weight: bold; }
                .sig-title { font-size: 8.5pt; color: #4a5a50; }
                .qr { width: 30%; text-align: right; font-size: 7pt; color: #4a5a50; }
                .qr img { width: 24mm; height: 24mm; }
                .watermark { position: absolute; top: 80mm; left: 0; right: 0; text-align: center; font-size: 90pt; font-weight: bold;
                             color: #d63a3a; opacity: .15; transform: rotate(-18deg); }
            </style></head><body><div class="page">
                <div class="band top"></div><div class="band bottom"></div>
                <div class="frame"></div><div class="frame-inner"></div>
                {$watermark}
                <div class="content">
                    <img class="logo" src="{$logo}">
                    <div class="org">Philippine Association of Agriculturists, Inc.</div>
                    <h1>CERTIFICATE OF ATTENDANCE</h1>
                    <div class="certifies">This is to certify that</div>
                    <div class="name">{$e($c['attendee_name'])}</div>
                    {$license}
                    <div class="body">
                        has attended <span class="event">{$e($event['title'])}</span>
                        held at {$e($event['venue'])} on {$e(Mailer::eventDates($event))},
                        completing {$e((string) $c['sessions_attended'])} of {$e((string) $c['sessions_total'])} sessions{$unitsText}.
                    </div>
                </div>
                <div class="footer"><table><tr>
                    <td class="meta">
                        {$accreditation}
                        Certificate No. <strong>{$e($c['certificate_no'])}</strong><br>
                        Issued {$e($issued)}
                    </td>
                    <td class="sig">
                        {$signature}
                        <div class="sig-name">{$e($event['cert_signatory_name'] ?: 'Authorized Signatory')}</div>
                        <div class="sig-title">{$e($event['cert_signatory_title'] ?: 'Philippine Association of Agriculturists, Inc.')}</div>
                    </td>
                    <td class="qr">
                        <img src="{$qr}"><br>
                        Scan to verify or visit<br>{$e(Mailer::appUrl('/verify/'))}<br>Code {$e($c['verification_code'])}
                    </td>
                </tr></table></div>
            </div></body></html>
            HTML;
    }
}
