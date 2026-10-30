<?php

declare(strict_types=1);

namespace AgriPass\Controllers;

use AgriPass\Core\Database;
use AgriPass\Core\HttpException;
use AgriPass\Core\Request;
use AgriPass\Core\Response;
use AgriPass\Services\QrImage;
use AgriPass\Services\QrToken;

/** Attendee-facing pass endpoints. Possession of the signed QR token is the credential. */
final class PassController
{
    public static function show(Request $request): void
    {
        $token = self::token($request);
        $pass = Database::one(
            "SELECT r.registration_id, r.payment_status, r.registration_date,
                    m.first_name, m.last_name, m.chapter_region, m.prc_license_number,
                    e.event_id, e.title, e.venue, e.start_date, e.end_date, e.status AS event_status, e.cpd_units, e.registration_fee
             FROM registrations r
             JOIN members m ON m.member_id = r.member_id
             JOIN events e ON e.event_id = r.event_id
             WHERE r.qr_token = ?",
            [$token],
        );
        if ($pass === null) {
            throw new HttpException(404, 'Pass not found.');
        }

        $pass['sessions'] = Database::all(
            'SELECT s.session_id, s.session_name, s.session_date, s.start_time, s.end_time, a.check_in_time
             FROM event_sessions s
             LEFT JOIN attendances a ON a.session_id = s.session_id AND a.registration_id = ?
             WHERE s.event_id = ? ORDER BY s.session_date, s.start_time',
            [$pass['registration_id'], $pass['event_id']],
        );
        unset($pass['registration_id']);

        Response::json(['pass' => $pass]);
    }

    public static function qr(Request $request): void
    {
        $token = self::token($request);
        $png = $request->query('format') === 'png';

        header('Cache-Control: private, max-age=86400');
        if ($png) {
            header('Content-Type: image/png');
            if ($request->query('download')) {
                header('Content-Disposition: attachment; filename="agripass-qr.png"');
            }
            echo QrImage::png($token);
            return;
        }
        header('Content-Type: image/svg+xml');
        echo QrImage::svg($token);
    }

    private static function token(Request $request): string
    {
        $token = (string) $request->query('token', '');
        if (QrToken::parse($token) === null) {
            throw new HttpException(404, 'Pass not found.');
        }

        return $token;
    }
}
