<?php

declare(strict_types=1);

namespace AgriPass\Core;

final class Request
{
    private ?array $json = null;

    public function __construct(
        public readonly string $method,
        public readonly string $path,
        public array $params = [],
    ) {
    }

    public static function capture(): self
    {
        $path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';

        return new self(strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET'), rtrim($path, '/') ?: '/');
    }

    public function body(): array
    {
        if ($this->json === null) {
            $raw = file_get_contents('php://input') ?: '';
            $decoded = $raw === '' ? [] : json_decode($raw, true);
            if (!is_array($decoded)) {
                throw new HttpException(400, 'Request body must be a JSON object.');
            }
            $this->json = $decoded;
        }

        return $this->json;
    }

    public function input(string $key, mixed $default = null): mixed
    {
        return $this->body()[$key] ?? $default;
    }

    public function query(string $key, mixed $default = null): mixed
    {
        return $_GET[$key] ?? $default;
    }

    public function header(string $name): ?string
    {
        $key = 'HTTP_' . strtoupper(str_replace('-', '_', $name));

        return $_SERVER[$key] ?? null;
    }

    public function param(string $name): int
    {
        return (int) ($this->params[$name] ?? 0);
    }

    /** @param array<string, string> $rules field => 'required' | 'optional' */
    public function validate(array $rules): array
    {
        $data = [];
        $errors = [];
        foreach ($rules as $field => $rule) {
            $value = $this->input($field);
            if (is_string($value)) {
                $value = trim($value);
            }
            if ($rule === 'required' && ($value === null || $value === '')) {
                $errors[$field] = 'This field is required.';
                continue;
            }
            $data[$field] = $value === '' ? null : $value;
        }
        if ($errors) {
            throw new HttpException(422, 'Validation failed.', $errors);
        }

        return $data;
    }
}
