<?php

declare(strict_types=1);

use AgriPass\Core\Auth;
use AgriPass\Core\Config;
use AgriPass\Core\HttpException;
use AgriPass\Core\Request;
use AgriPass\Core\Response;
use AgriPass\Core\Router;

require __DIR__ . '/../vendor/autoload.php';

$request = Request::capture();

if (!str_starts_with($request->path, '/api/')) {
    if (in_array($request->path, ['/', '/register'], true)) {
        readfile(__DIR__ . '/register.html');
    } else {
        http_response_code(404);
        echo 'Page not found. <a href="/">Go to AgriPass</a>';
    }
    return;
}

try {
    Auth::start();
    $router = new Router();
    (require __DIR__ . '/../src/routes.php')($router);
    $router->dispatch($request);
} catch (HttpException $e) {
    Response::error($e->status, $e->getMessage(), $e->errors);
} catch (\Throwable $e) {
    error_log((string) $e);
    $message = Config::get('APP_ENV') === 'local' ? $e->getMessage() : 'Internal server error.';
    Response::error(500, $message);
}
