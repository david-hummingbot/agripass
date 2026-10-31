<?php

declare(strict_types=1);

namespace AgriPass\Controllers;

use AgriPass\Core\Auth;
use AgriPass\Core\Request;
use AgriPass\Core\Response;
use AgriPass\Services\HelpGuide;

final class HelpController
{
    public static function index(Request $request): void
    {
        $user = Auth::require();
        Response::json(['topics' => HelpGuide::topics(self::audienceFor($user))]);
    }

    /** Admins can print either handout (e.g. the gate guide for event-day volunteers); gate staff get theirs. */
    public static function pdf(Request $request): void
    {
        $user = Auth::require();
        $audience = $request->query('audience') === HelpGuide::STAFF ? HelpGuide::STAFF : self::audienceFor($user);
        $pdf = HelpGuide::pdf($audience);
        $filename = $audience === HelpGuide::ADMIN ? 'agripass-staff-guide.pdf' : 'agripass-gate-staff-guide.pdf';

        header('Content-Type: application/pdf');
        header('Content-Disposition: inline; filename="' . $filename . '"');
        header('Content-Length: ' . strlen($pdf));
        header('Cache-Control: private, no-store');
        echo $pdf;
    }

    private static function audienceFor(array $user): string
    {
        return in_array($user['role'], Auth::ADMINS, true) ? HelpGuide::ADMIN : HelpGuide::STAFF;
    }
}
