<?php

declare(strict_types=1);

use AgriPass\Controllers\AuthController;
use AgriPass\Controllers\CertificateController;
use AgriPass\Controllers\CheckInController;
use AgriPass\Controllers\CustomFieldController;
use AgriPass\Controllers\EventController;
use AgriPass\Controllers\MemberController;
use AgriPass\Controllers\PassController;
use AgriPass\Controllers\RegistrationController;
use AgriPass\Controllers\SessionController;
use AgriPass\Controllers\UserController;
use AgriPass\Core\Database;
use AgriPass\Core\Response;
use AgriPass\Core\Router;

return static function (Router $r): void {
    $r->get('/api/health', static function (): void {
        Database::one('SELECT 1');
        Response::json(['status' => 'ok', 'time' => date('c')]);
    });

    $r->post('/api/auth/login', [AuthController::class, 'login']);
    $r->post('/api/auth/logout', [AuthController::class, 'logout']);
    $r->get('/api/auth/me', [AuthController::class, 'me']);
    $r->post('/api/auth/password', [AuthController::class, 'changePassword']);

    $r->get('/api/users', [UserController::class, 'index']);
    $r->post('/api/users', [UserController::class, 'store']);
    $r->put('/api/users/{id}', [UserController::class, 'update']);
    $r->post('/api/users/{id}/reset-password', [UserController::class, 'resetPassword']);

    $r->get('/api/active-event', [EventController::class, 'active']);
    $r->get('/api/events', [EventController::class, 'index']);
    $r->post('/api/events', [EventController::class, 'store']);
    $r->get('/api/events/{id}', [EventController::class, 'show']);
    $r->put('/api/events/{id}', [EventController::class, 'update']);
    $r->post('/api/events/{id}/activate', [EventController::class, 'activate']);
    $r->post('/api/events/{id}/status', [EventController::class, 'transition']);

    $r->get('/api/events/{id}/sessions', [SessionController::class, 'index']);
    $r->post('/api/events/{id}/sessions', [SessionController::class, 'store']);
    $r->delete('/api/events/{id}/sessions/{sessionId}', [SessionController::class, 'destroy']);

    $r->post('/api/events/{id}/fields', [CustomFieldController::class, 'store']);
    $r->delete('/api/events/{id}/fields/{fieldId}', [CustomFieldController::class, 'destroy']);

    $r->post('/api/events/{id}/registrations', [RegistrationController::class, 'store']);
    $r->post('/api/events/{id}/registrations/resend', [RegistrationController::class, 'resend']);
    $r->get('/api/events/{id}/registrations', [RegistrationController::class, 'index']);
    $r->put('/api/registrations/{id}/payment', [RegistrationController::class, 'updatePayment']);
    $r->post('/api/members/lookup', [MemberController::class, 'lookup']);

    $r->get('/api/passes', [PassController::class, 'show']);
    $r->get('/api/passes/qr', [PassController::class, 'qr']);

    $r->get('/api/events/{id}/certificates', [CertificateController::class, 'index']);
    $r->post('/api/events/{id}/certificates/issue', [CertificateController::class, 'issue']);
    $r->get('/api/events/{id}/certificates/preview', [CertificateController::class, 'preview']);
    $r->post('/api/events/{id}/signature', [CertificateController::class, 'uploadSignature']);
    $r->get('/api/certificates/{id}/pdf', [CertificateController::class, 'show']);
    $r->post('/api/certificates/{id}/resend', [CertificateController::class, 'resend']);
    $r->post('/api/certificates/{id}/revoke', [CertificateController::class, 'revoke']);
    $r->get('/api/certificates/download', [CertificateController::class, 'download']);
    $r->get('/api/certificates/verify', [CertificateController::class, 'verify']);

    $r->post('/api/checkin', [CheckInController::class, 'scan']);
    $r->get('/api/events/{id}/roster', [CheckInController::class, 'roster']);
    $r->post('/api/sync-attendance', [CheckInController::class, 'sync']);
    $r->post('/api/sync-attendance.php', [CheckInController::class, 'sync']);
};
