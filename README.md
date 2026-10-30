# AgriPass

Event registration and QR check-in system for the Philippine Association of Agriculturists (PAA).
See [`docs/agripass_system_implementation_plan.md`](../docs/agripass_system_implementation_plan.md) for the full plan.

Everything runs in Docker; nothing needs to be installed on the host besides Docker with Compose.

## Getting started

```bash
cp .env.example .env
sed -i "s/^APP_KEY=.*/APP_KEY=$(openssl rand -hex 32)/" .env
docker compose up -d --build
docker compose exec -u www-data app php bin/seed.php --demo
```

On first start the app container runs `composer install` and MySQL loads `database/schema/*.sql`.

| Service | URL |
| :--- | :--- |
| Public registration | http://localhost:8080 |
| Attendee pass page | http://localhost:8080/pass/?token=... (linked from the confirmation email) |
| Admin dashboard | http://localhost:8080/admin/ |
| QR scanner / kiosk | http://localhost:8080/scanner/ (on this PC) or https://&lt;LAN-IP&gt;:8443/scanner/ (phones and tablets) |
| Mailpit (captured emails) | http://localhost:8025 |
| phpMyAdmin (optional) | `docker compose --profile tools up -d`, then http://localhost:8081 |
| MySQL from host | `127.0.0.1:3307` |

Default admin login comes from `ADMIN_EMAIL` / `ADMIN_PASSWORD` in `.env`. Other staff accounts are created by a
Super Admin under **Users** in the dashboard; new accounts get a one-time temporary password and must set their own
password at first sign-in.

| Role | Can do |
| :--- | :--- |
| Super Admin | Everything, including user accounts |
| Regional Officer | Events, sessions, registration forms, payments |
| Gate Staff | QR scanner and read-only dashboard |

Upgrading a database created before user management was added: run
`docker compose exec -T db sh -c 'mysql -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE"' < database/schema/002_user_accounts.sql`.

## Scanning on phones and tablets

Browsers only allow camera access on HTTPS (or `localhost`), so the app container also listens on port 8443 with a
self-signed certificate it generates in `storage/certs/`.

1. Put this machine's LAN IP in `APP_TLS_HOSTS` in `.env` (comma-separated for several), then `docker compose up -d app`.
   The certificate is regenerated whenever that list changes.
2. On the phone (same Wi-Fi), open `https://<LAN-IP>:8443/scanner/` and accept the certificate warning.
   On Windows, allow Docker Desktop through the firewall for private networks if the page does not load.
3. Sign in, pick the event and session, and tap **Start scanning** or **Self-service kiosk mode**.

Offline use: the scanner caches its own files (service worker) and the event roster (IndexedDB). Open it once online
to download the roster; after that it keeps checking attendees in without a connection and uploads queued scans
automatically when the server is reachable again. Service workers refuse untrusted certificates, so for full offline
support on phones install a trusted certificate (for example from [mkcert](https://github.com/FiloSottile/mkcert)):
replace `storage/certs/agripass.crt` / `agripass.key` and delete `storage/certs/.hosts` so it is not regenerated.

Kiosk mode is a full-screen self check-in view for a tablet at the entrance: it uses the front camera, shows each
result for 2 seconds, and needs the PIN set when it started to exit. A USB or Bluetooth barcode scanner that types
the pass code works in the staff view's pass code box.

Reset the database (destroys all data): `docker compose down -v && docker compose up -d`, then re-run the seed.

Moving machines: copy or clone the repo, then follow the steps above. Database data lives in the `agripass_db-data` volume and is not part of the repo.

## API overview

All endpoints are JSON under `/api`. Staff endpoints use a session cookie from `POST /api/auth/login`.
Scanner endpoints use the `X-Event-ID` header for event context, falling back to the globally active event.

| Method | Path | Access |
| :--- | :--- | :--- |
| GET | `/api/health` | public |
| POST | `/api/auth/login` (rate limited), `/api/auth/logout` · GET `/api/auth/me` | — |
| POST | `/api/auth/password` (change own password) | staff |
| GET, POST | `/api/users` · PUT `/api/users/{id}` · POST `/api/users/{id}/reset-password` | super admin |
| GET | `/api/active-event` | public |
| GET, POST | `/api/events` | staff / admin |
| GET, PUT | `/api/events/{id}` | staff / admin |
| POST | `/api/events/{id}/activate` | admin |
| POST | `/api/events/{id}/status` (`Draft → Active → Completed → Archived`) | admin |
| GET, POST | `/api/events/{id}/sessions` · DELETE `/api/events/{id}/sessions/{sessionId}` | staff / admin |
| POST | `/api/events/{id}/fields` · DELETE `/api/events/{id}/fields/{fieldId}` | admin |
| POST | `/api/events/{id}/registrations` (requires `privacy_consent: true`) | public |
| POST | `/api/events/{id}/registrations/resend` | public, rate limited |
| POST | `/api/members/lookup` (email + PRC license or PAA ID) | public, rate limited |
| GET | `/api/events/{id}/registrations` | staff |
| PUT | `/api/registrations/{id}/payment` | admin |
| GET | `/api/passes?token=...` | public, signed token only |
| GET | `/api/passes/qr?token=...` (SVG, or `&format=png`) | public, signed token only |
| POST | `/api/checkin` (optional `client_uuid` makes retries idempotent) | staff |
| GET | `/api/events/{id}/roster` (offline cache) | staff |
| POST | `/api/sync-attendance` (alias `/api/sync-attendance.php`) | staff |
