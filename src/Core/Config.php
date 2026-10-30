<?php

declare(strict_types=1);

namespace AgriPass\Core;

final class Config
{
    public static function get(string $key, ?string $default = null): ?string
    {
        $value = getenv($key);

        return $value === false || $value === '' ? $default : $value;
    }

    public static function appKey(): string
    {
        $key = self::get('APP_KEY');
        if ($key === null || $key === 'change-me') {
            throw new \RuntimeException('APP_KEY is not configured. Set it in .env.');
        }

        return $key;
    }
}
