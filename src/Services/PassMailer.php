<?php

declare(strict_types=1);

namespace AgriPass\Services;

use PHPMailer\PHPMailer\PHPMailer;

final class PassMailer
{
    /**
     * Emails the attendee their QR pass. Failures are logged rather than thrown so a mail outage
     * never blocks registration; the pass is always shown on screen as well.
     */
    public static function send(array $event, array $member, string $token, string $paymentStatus): bool
    {
        try {
            $mail = Mailer::create();
            $mail->addAddress($member['email'], "{$member['first_name']} {$member['last_name']}");
            $mail->Subject = "Your AgriPass for {$event['title']}";
            $mail->addStringEmbeddedImage(QrImage::png($token, 8), 'qr-pass', 'agripass-qr.png', PHPMailer::ENCODING_BASE64, 'image/png');
            $mail->isHTML();
            $mail->Body = self::html($event, $member, $token, $paymentStatus);
            $mail->AltBody = self::text($event, $member, $token, $paymentStatus);
            $mail->send();

            return true;
        } catch (\Throwable $e) {
            error_log('Pass email failed: ' . $e->getMessage());

            return false;
        }
    }

    public static function passUrl(string $token): string
    {
        return Mailer::appUrl('/pass/?token=' . rawurlencode($token));
    }

    private static function html(array $event, array $member, string $token, string $paymentStatus): string
    {
        $e = static fn (?string $v) => htmlspecialchars((string) $v, ENT_QUOTES, 'UTF-8');
        $dates = Mailer::eventDates($event);
        $url = $e(self::passUrl($token));
        $payment = self::paymentNote($event, $paymentStatus);

        return <<<HTML
            <div style="font-family:Segoe UI,Arial,sans-serif;max-width:560px;margin:0 auto;color:#1f2a24">
              <div style="background:#1c5739;color:#fff;padding:20px 24px;border-bottom:4px solid #ffd230">
                <div style="font-size:22px;font-weight:700;color:#ffd230">AgriPass</div>
                <div style="font-size:13px;opacity:.85">Philippine Association of Agriculturists, Inc.</div>
              </div>
              <div style="padding:24px;background:#ffffff">
                <p>Hi {$e($member['first_name'])},</p>
                <p>You're registered for <strong>{$e($event['title'])}</strong>.</p>
                <p style="margin:0 0 16px;color:#555">{$e($event['venue'])}<br>{$e($dates)}</p>
                <div style="text-align:center;padding:16px;border:1px solid #e3ebdc;border-radius:8px">
                  <img src="cid:qr-pass" alt="Your QR pass" width="240" height="240" style="display:block;margin:0 auto">
                  <div style="font-size:12px;color:#777;margin-top:8px">Show this QR code at the entrance of every session.</div>
                </div>
                <p style="background:#fff8dc;border-left:4px solid #ffd230;padding:12px;margin:16px 0">{$e($payment)}</p>
                <p><a href="{$url}" style="display:inline-block;background:#1c5739;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">View my pass online</a></p>
                <p style="font-size:12px;color:#777">Keep this email. Anyone with this QR code can check in as you, so please don't share it.</p>
                <p style="font-size:12px;color:#777">See all your registrations and CPD certificates at
                  <a href="{$e(PortalMailer::portalUrl())}" style="color:#1c5739">My AgriPass</a>.</p>
              </div>
            </div>
            HTML;
    }

    private static function text(array $event, array $member, string $token, string $paymentStatus): string
    {
        return "Hi {$member['first_name']},\n\nYou're registered for {$event['title']}.\n{$event['venue']}\n" . Mailer::eventDates($event)
            . "\n\n" . self::paymentNote($event, $paymentStatus)
            . "\n\nView your QR pass: " . self::passUrl($token) . "\n";
    }

    private static function paymentNote(array $event, string $paymentStatus): string
    {
        return match ($paymentStatus) {
            'Paid' => 'Your payment has been received. See you at the event!',
            'Waived' => 'No payment is required for this event. See you there!',
            default => 'Payment of PHP ' . number_format((float) $event['registration_fee'], 2)
                . ' is pending. Your pass will be accepted at the entrance once your payment is verified.',
        };
    }
}
