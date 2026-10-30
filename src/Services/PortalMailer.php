<?php

declare(strict_types=1);

namespace AgriPass\Services;

use AgriPass\Core\MemberAuth;

final class PortalMailer
{
    public static function portalUrl(): string
    {
        return Mailer::appUrl('/portal/');
    }

    /** The token goes in the URL fragment so it never reaches server logs or Referer headers. */
    public static function sendLoginLink(array $member, string $token): bool
    {
        $e = static fn (?string $v) => htmlspecialchars((string) $v, ENT_QUOTES, 'UTF-8');
        $url = self::portalUrl() . '#login=' . $token;
        $minutes = MemberAuth::LINK_TTL_MINUTES;

        try {
            $mail = Mailer::create();
            $mail->addAddress($member['email'], "{$member['first_name']} {$member['last_name']}");
            $mail->Subject = 'Your My AgriPass sign-in link';
            $mail->isHTML();
            $mail->Body = <<<HTML
                <div style="font-family:Segoe UI,Arial,sans-serif;max-width:560px;margin:0 auto;color:#1f2a24">
                  <div style="background:#1c5739;color:#fff;padding:20px 24px;border-bottom:4px solid #ffd230">
                    <div style="font-size:22px;font-weight:700;color:#ffd230">My AgriPass</div>
                    <div style="font-size:13px;opacity:.85">Philippine Association of Agriculturists, Inc.</div>
                  </div>
                  <div style="padding:24px;background:#ffffff">
                    <p>Hi {$e($member['first_name'])},</p>
                    <p>Use the button below to sign in to My AgriPass, where you can see your event registrations,
                       open your QR passes, download CPD certificates and update your profile.</p>
                    <p><a href="{$e($url)}" style="display:inline-block;background:#1c5739;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">Sign in to My AgriPass</a></p>
                    <p style="font-size:12px;color:#777">This link works once and expires in {$minutes} minutes.
                       If you didn't ask to sign in, you can ignore this email.</p>
                  </div>
                </div>
                HTML;
            $mail->AltBody = "Hi {$member['first_name']},\n\nSign in to My AgriPass: {$url}\n\n"
                . "This link works once and expires in {$minutes} minutes. If you didn't ask to sign in, ignore this email.\n";
            $mail->send();

            return true;
        } catch (\Throwable $ex) {
            error_log('Portal sign-in email failed: ' . $ex->getMessage());

            return false;
        }
    }
}
