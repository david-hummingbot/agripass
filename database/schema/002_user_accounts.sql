-- Account status for user management. Applied automatically on a fresh database;
-- for an existing one run: docker compose exec -T db sh -c 'mysql -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE"' < database/schema/002_user_accounts.sql

ALTER TABLE users
    ADD COLUMN is_active TINYINT(1) NOT NULL DEFAULT 1 AFTER role,
    ADD COLUMN must_change_password TINYINT(1) NOT NULL DEFAULT 0 AFTER is_active,
    ADD COLUMN last_login_at DATETIME NULL AFTER must_change_password;
