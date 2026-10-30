<?php

declare(strict_types=1);

namespace AgriPass\Services;

use chillerlan\QRCode\Common\EccLevel;
use chillerlan\QRCode\Output\QROutputInterface;
use chillerlan\QRCode\QRCode;
use chillerlan\QRCode\QROptions;

final class QrImage
{
    public static function svg(string $data): string
    {
        return self::render($data, ['outputType' => QROutputInterface::MARKUP_SVG]);
    }

    public static function png(string $data, int $scale = 10): string
    {
        return self::render($data, ['outputType' => QROutputInterface::GDIMAGE_PNG, 'scale' => $scale]);
    }

    private static function render(string $data, array $options): string
    {
        return (new QRCode(new QROptions([
            'eccLevel' => EccLevel::M,
            'addQuietzone' => true,
            'outputBase64' => false,
            ...$options,
        ])))->render($data);
    }
}
