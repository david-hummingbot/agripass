#!/bin/sh
set -e

if [ -f composer.json ] && [ ! -f vendor/autoload.php ]; then
    echo "Installing composer dependencies..."
    su -s /bin/sh www-data -c "COMPOSER_HOME=/tmp/composer composer install --no-interaction --prefer-dist"
fi

mkdir -p storage/uploads storage/certificates storage/logs storage/certs

# Self-signed certificate for the HTTPS listener. Regenerated when APP_TLS_HOSTS changes;
# a certificate without the .hosts stamp file is treated as user-supplied and left alone.
cert=storage/certs/agripass.crt
key=storage/certs/agripass.key
stamp=storage/certs/.hosts
hosts="localhost,127.0.0.1${APP_TLS_HOSTS:+,$APP_TLS_HOSTS}"
if [ ! -f "$cert" ] || { [ -f "$stamp" ] && [ "$(cat "$stamp")" != "$hosts" ]; }; then
    san=$(echo "$hosts" | tr ',' '\n' | sed '/^$/d' | while read -r h; do
        if echo "$h" | grep -Eq '^[0-9.]+$'; then echo "IP:$h"; else echo "DNS:$h"; fi
    done | paste -sd, -)
    echo "Generating self-signed certificate for: $hosts"
    ext=$(mktemp)
    printf 'basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=%s\n' "$san" > "$ext"
    openssl genrsa -out "$key" 2048 2>/dev/null
    openssl req -new -key "$key" -subj "/CN=AgriPass local" -out "$ext.csr"
    openssl x509 -req -in "$ext.csr" -signkey "$key" -days 825 -extfile "$ext" -out "$cert" 2>/dev/null
    rm -f "$ext" "$ext.csr"
    echo "$hosts" > "$stamp"
fi

chown -R www-data:www-data storage
chmod 600 "$key"

exec docker-php-entrypoint "$@"
