FROM php:8.3-apache

ARG UID=1000
ARG GID=1000

RUN apt-get update \
    && apt-get install -y --no-install-recommends libpng-dev libjpeg-dev libfreetype6-dev libzip-dev unzip git \
    && docker-php-ext-configure gd --with-freetype --with-jpeg \
    && docker-php-ext-install -j"$(nproc)" pdo_mysql gd zip bcmath \
    && rm -rf /var/lib/apt/lists/*

COPY --from=composer:2 /usr/bin/composer /usr/bin/composer

RUN groupmod -o -g "${GID}" www-data \
    && usermod -o -u "${UID}" -g "${GID}" www-data \
    && a2enmod rewrite headers ssl

COPY docker/php/vhost.conf /etc/apache2/sites-available/000-default.conf
COPY docker/php/php.ini /usr/local/etc/php/conf.d/agripass.ini
COPY docker/php/entrypoint.sh /usr/local/bin/agripass-entrypoint

ENV COMPOSER_HOME=/tmp/composer
WORKDIR /var/www/agripass

ENTRYPOINT ["agripass-entrypoint"]
CMD ["apache2-foreground"]
