<?php

declare(strict_types=1);

namespace AgriPass\Services;

use PHPMailer\PHPMailer\PHPMailer;

final class CertificateMailer
{
    /** Emails the PDF certificate. Returns false (and logs) on failure so a batch can continue. */
    public static function send(array $certificate, array $event, string $pdf): bool
    {
        $e = static fn (?string $v) => htmlspecialchars((string) $v, ENT_QUOTES, 'UTF-8');
        $passUrl = PassMailer::passUrl($certificate['qr_token']);
        $verifyUrl = CertificateService::verifyUrl($certificate['verification_code']);
        $units = (float) $certificate['cpd_units'];
        $unitsLine = $units > 0 ? ' and earned ' . rtrim(rtrim(number_format($units, 2), '0'), '.') . ' CPD unit' . ($units == 1.0 ? '' : 's') : '';

        try {
            $mail = Mailer::create();
            $mail->addAddress($certificate['email'], $certificate['attendee_name']);
            $mail->Subject = "Your Certificate of Attendance - {$event['title']}";
            $mail->addStringAttachment($pdf, "{$certificate['certificate_no']}.pdf", PHPMailer::ENCODING_BASE64, 'application/pdf');
            $mail->isHTML();
            $mail->Body = <<<HTML
                <div style="font-family:Segoe UI,Arial,sans-serif;max-width:560px;margin:0 auto;color:#1f2a24">
                  <div style="background:#1c5739;color:#fff;padding:20px 24px;border-bottom:4px solid #ffd230">
                    <div style="font-size:22px;font-weight:700;color:#ffd230">AgriPass</div>
                    <div style="font-size:13px;opacity:.85">Philippine Association of Agriculturists, Inc.</div>
                  </div>
                  <div style="padding:24px;background:#ffffff">
                    <p>Hi {$e($certificate['first_name'])},</p>
                    <p>Thank you for attending <strong>{$e($event['title'])}</strong>. You completed
                       {$e((string) $certificate['sessions_attended'])} of {$e((string) $certificate['sessions_total'])} sessions{$e($unitsLine)}.</p>
                    <p>Your Certificate of Attendance is attached as a PDF. You can also download it any time from your pass page.</p>
                    <p><a href="{$e($passUrl)}" style="display:inline-block;background:#1c5739;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">Open my pass page</a></p>
                    <p style="font-size:12px;color:#777">Certificate No. {$e($certificate['certificate_no'])}.
                       Anyone can confirm it is genuine at <a href="{$e($verifyUrl)}">{$e($verifyUrl)}</a>.</p>
                  </div>
                </div>
                HTML;
            $mail->AltBody = "Hi {$certificate['first_name']},\n\nThank you for attending {$event['title']}. Your Certificate of Attendance"
                . " ({$certificate['certificate_no']}) is attached.\n\nDownload it again from your pass page: {$passUrl}\nVerify: {$verifyUrl}\n";
            $mail->send();

            return true;
        } catch (\Throwable $e) {
            error_log('Certificate email failed: ' . $e->getMessage());

            return false;
        }
    }
}
