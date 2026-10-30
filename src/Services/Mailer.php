<?php

declare(strict_types=1);

namespace AgriPass\Services;

use AgriPass\Core\Config;
use PHPMailer\PHPMailer\PHPMailer;

final class Mailer
{
    /** A PHPMailer configured from the MAIL_* environment, with the sender set. */
    public static function create(): PHPMailer
    {
        $mail = new PHPMailer(true);
        $mail->isSMTP();
        $mail->Host = Config::get('MAIL_HOST', 'mailpit');
        $mail->Port = (int) Config::get('MAIL_PORT', '1025');
        $mail->SMTPAuth = Config::get('MAIL_USERNAME') !== null;
        $mail->Username = Config::get('MAIL_USERNAME', '');
        $mail->Password = Config::get('MAIL_PASSWORD', '');
        $mail->SMTPAutoTLS = Config::get('MAIL_ENCRYPTION') !== null;
        $mail->SMTPSecure = Config::get('MAIL_ENCRYPTION', '');
        $mail->CharSet = PHPMailer::CHARSET_UTF8;
        $mail->setFrom(Config::get('MAIL_FROM', 'noreply@agripass.local'), Config::get('MAIL_FROM_NAME', 'PAA AgriPass'));

        return $mail;
    }

    public static function appUrl(string $path = ''): string
    {
        return rtrim(Config::get('APP_URL', 'http://localhost:8080'), '/') . $path;
    }

    public static function eventDates(array $event): string
    {
        $start = new \DateTimeImmutable($event['start_date']);
        $end = new \DateTimeImmutable($event['end_date']);

        return $start == $end ? $start->format('F j, Y') : $start->format('F j') . ' - ' . $end->format('F j, Y');
    }
}
