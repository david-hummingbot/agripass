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
| Member portal (My AgriPass) | http://localhost:8080/portal/ |
| Certificate verification | http://localhost:8080/verify/ (linked from the QR code on each certificate) |
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

Upgrading an existing database: schema files only run when the database is first created, so apply any newer
`database/schema/*.sql` files by hand (`002_user_accounts.sql` for user management, `003_certificates.sql` for CPD
certificates, `004_member_portal.sql` for the member portal), for example
`docker compose exec -T db sh -c 'mysql -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE"' < database/schema/003_certificates.sql`.

## CPD certificates

After an event is marked **Completed**, admins issue certificates from the event's **Certificates** tab:

1. Set the signatory's name and position when editing the event, and optionally upload a signature image (PNG or JPEG)
   on the Certificates tab. Use **Preview sample certificate** to check the layout.
2. An attendee qualifies when their payment is Paid or Waived and they attended at least the event's minimum
   percentage of sessions.
3. **Issue & email** generates an A4 PDF for every qualifying attendee and emails it to them. Issued certificates can be
   emailed again or revoked (with a reason), but not edited.

Attendees can also download their certificate from their pass page. Each PDF carries a certificate number and a
verification QR code. Scanning it, or entering the code at `/verify/`, shows whether the certificate is valid or revoked.
The `--demo` seed includes a completed seminar with recorded attendance for trying this out.

## Member portal

Members sign in at `/portal/` without a password: they enter the email they registered with and receive a one-time
link (valid 30 minutes; in development it lands in Mailpit). The portal lists their registrations with payment status,
attendance, QR pass links and CPD certificate downloads (or why no certificate was issued). It shows the total CPD
units earned and lets members update their name, contact number, PRC license, PAA ID and chapter. Email changes go
through PAA staff. While signed in, the public registration form fills in their details automatically.

## Member directory

Admins can browse everyone who has registered under **Members**: search by name, email, PRC license or PAA ID,
filter by membership status or chapter, and open a member to see their event history, attendance and certificates.
Admins can correct a member's details there, including email and PAA membership status. Changing the email cancels
any unused portal sign-in links. Edits are recorded in the audit log, and certificates that were already issued keep
the name and license printed on them.

## Reports and exports

Each event's **Reports** tab (admins only) shows registration, turnout, payment and CPD figures, attendance per
session, arrivals per hour, a breakdown by chapter, PRC license and PAA membership, and tallies of the custom
registration questions. From there you can download:

- **Summary PDF**: the same figures as a printable A4 executive summary.
- **Attendance & CPD**: one row per registrant with check-in times per session, CPD eligibility (and why not),
  certificate number and units credited, plus their registration answers. This is the file for PRC CPD submissions.
- **Check-in log**: every scan with who recorded it and whether it was synced from offline.

The **Members** page also exports the whole directory. Every export comes as Excel or CSV. Use Excel for PRC
submissions: Excel removes the leading zeros from license numbers like `0071234` when it opens a CSV, while the
`.xlsx` file stores them as text. CSV files are UTF-8 with a byte-order mark, and in both formats values that start
with `=`, `+`, `-` or `@` cannot run as spreadsheet formulas. Every download is recorded in the audit log.

## Staff guide

The admin dashboard has a **Help** section with searchable how-to pages. Gate Staff see the topics for event day;
admins see everything. The same content is available as printable PDF handouts from the Help page: the full **Staff
guide**, and a short **Gate staff handout** for event-day volunteers. Edit the topics in `resources/help/*.html`; the list
of topics and who sees each one is in `src/Services/HelpGuide.php`. Addresses in the guide come from `APP_URL`, so print
handouts from the production installation.

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
| GET | `/api/events/{id}/certificates` (eligibility and issued certificates) · `/api/events/{id}/certificates/preview` (sample PDF) | admin |
| POST | `/api/events/{id}/certificates/issue` (batches of 20; repeat until `remaining` is 0) · `/api/events/{id}/signature` (multipart) | admin |
| GET | `/api/certificates/{id}/pdf` · POST `/api/certificates/{id}/resend`, `/api/certificates/{id}/revoke` | admin |
| GET | `/api/certificates/download?token=...` (attendee's own PDF) | public, signed token only |
| GET | `/api/certificates/verify?code=...` | public |
| POST | `/api/portal/login-link` (emails a sign-in link) · `/api/portal/session` (redeems it) | public, rate limited |
| GET | `/api/portal/me`, `/api/portal/registrations` · PUT `/api/portal/profile` · POST `/api/portal/logout` | member |
| GET | `/api/help` (topics for the user's role) · `/api/help/guide.pdf` (`?audience=staff` for the gate handout) | staff |
| GET | `/api/members` (`q`, `status`, `chapter`, `page`) · GET, PUT `/api/members/{id}` | admin |
| GET | `/api/members/export.xlsx` · `/api/members/export.csv` | admin |
| GET | `/api/events/{id}/report` (JSON) · `/api/events/{id}/report.pdf` | admin |
| GET | `/api/events/{id}/exports/attendance.xlsx` / `.csv` · `/api/events/{id}/exports/checkins.xlsx` / `.csv` | admin |
