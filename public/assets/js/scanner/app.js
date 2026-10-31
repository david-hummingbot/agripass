import { api, ApiError } from '../lib/api.js';
import { clearFormErrors, confirmDialog, esc, formData, openModal, showFormErrors, toast, toastError, withBusy } from '../lib/ui.js';
import { renderForcedPasswordChange } from '../lib/password.js';
import * as store from './store.js';
import { CheckInEngine } from './checkin.js';
import { Camera, cameraErrorMessage } from './camera.js';
import { signal, unlockAudio } from './feedback.js';

const KIOSK_RESET_MS = 2000;
const SAME_PASS_IGNORE_MS = { staff: 4000, kiosk: 8000 };
const RECENT_LIMIT = 12;

const RESULTS = {
    valid: { tone: 'success', icon: 'check-circle-fill', title: 'Checked in', sound: 'success' },
    duplicate: { tone: 'danger', icon: 'exclamation-octagon-fill', title: 'Already checked in', sound: 'error' },
    unpaid: { tone: 'unpaid', icon: 'cash-coin', title: 'Payment pending', sound: 'warning' },
    wrong_event: { tone: 'warning', icon: 'exclamation-triangle-fill', title: 'Wrong event', sound: 'warning' },
    invalid: { tone: 'danger', icon: 'x-octagon-fill', title: 'Invalid pass', sound: 'error' },
    error: { tone: 'danger', icon: 'x-octagon-fill', title: 'Check-in failed', sound: 'error' },
};

const root = document.getElementById('root');
const app = {
    user: null,
    deviceId: null,
    engine: null,
    mode: null,
    camera: null,
    recent: [],
    kioskPin: null,
    busy: false,
    busyTimer: null,
    scanChain: Promise.resolve(),
    lastScan: { token: null, at: 0 },
    wakeLock: null,
};

const clock = (value) => (value ? new Date(String(value).replace(' ', 'T')).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' }) : '');
const sessionLabel = (s) => `${s.session_name} · ${new Date(`${s.session_date}T${s.start_time}`).toLocaleString('en-PH', { weekday: 'short', hour: 'numeric', minute: '2-digit' })}`;
const isOffline = (err) => !(err instanceof ApiError);

/* ---------- Startup & sign-in ---------- */

async function start() {
    if ('serviceWorker' in navigator && window.isSecureContext) {
        const hadController = Boolean(navigator.serviceWorker.controller);
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            if (hadController) toast('A scanner update is ready. Reload the page when there is a break in arrivals.', 'info');
        });
        navigator.serviceWorker.register('/scanner/sw.js', { scope: '/scanner/' }).catch(() => {});
    }
    app.deviceId = await store.deviceId();

    try {
        app.user = (await api('/auth/me', { timeout: 6000 })).user;
        await store.setMeta('user', app.user);
    } catch (err) {
        if (!isOffline(err)) return renderLogin();
        app.user = await store.getMeta('user');
        if (!app.user) return renderOfflineNoUser();
        toast('No connection. Working offline with the downloaded roster.', 'warning');
    }
    afterSignIn();
}

function afterSignIn() {
    if (app.user.must_change_password && navigator.onLine) {
        renderForcedPasswordChange(root, app.user, async (user) => {
            app.user = user;
            await store.setMeta('user', user);
            toast('Password updated.');
            renderSetup();
        }, { onSignOut: signOut });
        return;
    }
    renderSetup();
}

function loginFormHtml() {
    return `
        <div class="mb-3">
            <label class="form-label" for="email">Email</label>
            <input class="form-control" id="email" name="email" type="email" autocomplete="username" required>
        </div>
        <div class="mb-3">
            <label class="form-label" for="password">Password</label>
            <input class="form-control" id="password" name="password" type="password" autocomplete="current-password" required>
        </div>`;
}

async function signIn(form) {
    const { user } = await api('/auth/login', { method: 'POST', body: formData(form) });
    app.user = user;
    await store.setMeta('user', user);
    return user;
}

function renderLogin() {
    root.innerHTML = `
        <div class="login-screen">
            <div class="card login-card">
                <div class="card-body p-4 p-md-5">
                    <div class="text-center mb-4">
                        <img class="logo mb-3" src="/assets/img/paa-logo.png" alt="Philippine Association of Agriculturists">
                        <h1 class="h4 fw-bold mb-1" style="color: var(--paa-green-dark)">AgriPass Scanner</h1>
                        <p class="text-muted small mb-0">Sign in with your staff account to start checking in attendees.</p>
                    </div>
                    <form id="login-form" novalidate>
                        ${loginFormHtml()}
                        <button class="btn btn-primary w-100 py-2 mt-2" type="submit">Sign in</button>
                    </form>
                </div>
            </div>
        </div>`;
    const form = document.getElementById('login-form');
    form.querySelector('input').focus();
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        clearFormErrors(form);
        await withBusy(form.querySelector('[type=submit]'), async () => {
            try {
                await signIn(form);
                afterSignIn();
            } catch (err) {
                showFormErrors(form, isOffline(err) ? new Error('No connection. You need internet access to sign in the first time.') : err);
            }
        });
    });
}

function renderOfflineNoUser() {
    root.innerHTML = `
        <div class="login-screen">
            <div class="card login-card"><div class="card-body p-4 text-center">
                <i class="bi bi-wifi-off display-5 text-secondary"></i>
                <h1 class="h5 mt-3">You're offline</h1>
                <p class="text-muted small">Connect to the internet once to sign in and download the event roster. After that the scanner works offline.</p>
                <button class="btn btn-primary" id="retry">Try again</button>
            </div></div>
        </div>`;
    document.getElementById('retry').addEventListener('click', start);
}

/** Re-authenticates in place, without leaving the scan screen, when the server session expired. */
function promptReLogin() {
    openModal({
        title: 'Sign in to sync',
        body: `<p class="small text-muted">Your session expired. Scans are saved on this device and will upload once you sign in again.</p>${loginFormHtml()}`,
        submitLabel: 'Sign in',
        onSubmit: async (form) => {
            await signIn(form);
            app.engine?.setNeedsLogin(false);
            toast('Signed in. Syncing scans…');
        },
    });
}

async function signOut() {
    const pending = app.engine?.pending || (await store.allQueued()).filter((r) => r.status === 'pending').length;
    if (pending) {
        const ok = await confirmDialog({
            title: 'Sign out?',
            message: `<strong>${pending}</strong> scan${pending === 1 ? ' has' : 's have'} not synced yet. They stay on this device and upload after the next sign-in.`,
            confirmLabel: 'Sign out',
            confirmClass: 'btn-danger',
        });
        if (!ok) return;
    }
    await stopScanning();
    app.engine?.destroy();
    app.engine = null;
    await api('/auth/logout', { method: 'POST', timeout: 5000 }).catch(() => {});
    await store.deleteMeta('user');
    app.user = null;
    renderLogin();
}

/* ---------- Setup: event, session, roster ---------- */

async function scannerEvents() {
    try {
        const { events } = await api('/events', { timeout: 6000 });
        const usable = events.filter((e) => Number(e.is_active) === 1 || e.status === 'Active');
        await store.setMeta('events', usable);
        return usable;
    } catch (err) {
        if (!isOffline(err)) throw err;
        const rosters = await store.allRosters();
        return rosters.map((r) => ({ ...r.event, is_active: 0 }));
    }
}

function defaultSession(sessions) {
    const now = new Date();
    const at = (s, t) => new Date(`${s.session_date}T${t}`);
    return sessions.find((s) => at(s, s.start_time) <= now && now <= at(s, s.end_time))
        || sessions.find((s) => at(s, s.start_time) > now)
        || sessions[0];
}

async function renderSetup() {
    await stopScanning();
    app.mode = 'setup';
    root.innerHTML = `
        <div class="scanner-app">
            ${topbarHtml()}
            <main class="scanner-setup">
                <div class="card">
                    <div class="card-body p-4">
                        <h1 class="h5 fw-bold mb-1" style="color: var(--paa-green-dark)">Scanner setup</h1>
                        <p class="small text-muted mb-4">Choose the event and session you're checking attendees into.</p>
                        <div class="mb-3">
                            <label class="form-label" for="event-select">Event</label>
                            <select class="form-select" id="event-select"><option>Loading…</option></select>
                        </div>
                        <div id="roster-status" class="roster-status mb-3"></div>
                        <div class="mb-4">
                            <label class="form-label" for="session-select">Session</label>
                            <select class="form-select" id="session-select" disabled></select>
                        </div>
                        <div class="d-grid gap-2">
                            <button class="btn btn-primary btn-lg" id="start-staff" disabled><i class="bi bi-qr-code-scan me-2"></i>Start scanning</button>
                            <button class="btn btn-accent btn-lg" id="start-kiosk" disabled><i class="bi bi-tablet-landscape me-2"></i>Self-service kiosk mode</button>
                        </div>
                    </div>
                </div>
                <div class="card mt-3">
                    <div class="card-body small d-flex flex-wrap gap-3 align-items-center">
                        <span><i class="bi bi-phone me-1"></i>Device <code>${esc(app.deviceId)}</code></span>
                        <span id="setup-sync"></span>
                        <a class="ms-auto" href="/admin/">Admin dashboard</a>
                    </div>
                </div>
            </main>
        </div>`;
    bindTopbar();

    const eventSelect = document.getElementById('event-select');
    const sessionSelect = document.getElementById('session-select');
    let events;
    try {
        events = await scannerEvents();
    } catch (err) {
        toastError(err);
        events = [];
    }
    if (!events.length) {
        eventSelect.innerHTML = '<option value="">No active event</option>';
        eventSelect.disabled = true;
        document.getElementById('roster-status').innerHTML = `<div class="alert alert-warning small mb-0">No event is open for check-in.
            An admin needs to set an Active event first${navigator.onLine ? '' : ', or connect to download its roster'}.</div>`;
        return;
    }

    const saved = await store.getMeta('selection');
    const initial = events.find((e) => Number(e.event_id) === saved?.event_id)
        || events.find((e) => Number(e.is_active) === 1) || events[0];
    eventSelect.innerHTML = events.map((e) => `<option value="${e.event_id}" ${e === initial ? 'selected' : ''}>
        ${esc(e.title)}${Number(e.is_active) === 1 ? ' (active event)' : ''}</option>`).join('');

    const loadEvent = async () => {
        const eventId = Number(eventSelect.value);
        document.getElementById('start-staff').disabled = true;
        document.getElementById('start-kiosk').disabled = true;
        sessionSelect.disabled = true;
        document.getElementById('roster-status').innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Downloading roster…';

        if (app.engine?.eventId !== eventId) {
            app.engine?.destroy();
            app.engine = new CheckInEngine(eventId, app.deviceId);
            app.engine.addEventListener('change', updateStatus);
            try {
                await app.engine.load();
            } catch (err) {
                app.engine.destroy();
                app.engine = null;
                document.getElementById('roster-status').innerHTML = `<div class="alert alert-danger small mb-0">${esc(err.message)}</div>`;
                return;
            }
        }

        const sessions = app.engine.sessions;
        if (!sessions.length) {
            document.getElementById('roster-status').innerHTML = '<div class="alert alert-warning small mb-0">This event has no sessions. Add sessions in the admin dashboard first.</div>';
            return;
        }
        const pick = sessions.find((s) => Number(s.session_id) === saved?.session_id) || defaultSession(sessions);
        sessionSelect.innerHTML = sessions.map((s) => `<option value="${s.session_id}" ${s === pick ? 'selected' : ''}>${esc(sessionLabel(s))}</option>`).join('');
        sessionSelect.disabled = false;
        document.getElementById('start-staff').disabled = false;
        document.getElementById('start-kiosk').disabled = false;
        updateStatus();
    };

    eventSelect.addEventListener('change', loadEvent);
    document.getElementById('start-staff').addEventListener('click', () => beginScanning('staff'));
    document.getElementById('start-kiosk').addEventListener('click', () => beginScanning('kiosk'));
    await loadEvent();
}

async function beginScanning(mode) {
    unlockAudio();
    const sessionId = Number(document.getElementById('session-select').value);
    app.engine.sessionId = sessionId;
    await store.setMeta('selection', { event_id: app.engine.eventId, session_id: sessionId });

    if (mode === 'kiosk') {
        const pin = await askKioskPin();
        if (!pin) return;
        app.kioskPin = pin;
        renderKiosk();
    } else {
        renderStaff();
    }
}

/* ---------- Shared chrome & status ---------- */

function topbarHtml({ scanning = false } = {}) {
    const event = app.engine?.roster?.event;
    return `
        <header class="scanner-topbar">
            <img src="/assets/img/paa-logo-yellow.png" alt="PAA" class="brand-logo">
            <div class="min-w-0 me-auto">
                <div class="brand-title">AgriPass Scanner</div>
                ${scanning ? `<button class="session-switch text-truncate" id="change-session" title="Change session">
                    ${esc(event?.title)} · <strong>${esc(app.engine.session?.session_name)}</strong> <i class="bi bi-chevron-down"></i></button>` : ''}
            </div>
            <span class="status-chip" id="conn-chip"></span>
            <button class="status-chip sync-chip d-none" id="sync-chip" title="Upload offline scans now"></button>
            <div class="dropdown">
                <button class="btn btn-sm btn-link text-white" data-bs-toggle="dropdown" aria-label="Menu"><i class="bi bi-three-dots-vertical fs-5"></i></button>
                <ul class="dropdown-menu dropdown-menu-end">
                    <li><span class="dropdown-item-text small"><i class="bi bi-person-circle me-1"></i>${esc(app.user.full_name)}</span></li>
                    <li><hr class="dropdown-divider"></li>
                    ${scanning ? `
                    <li><button class="dropdown-item" id="menu-session"><i class="bi bi-arrow-left-right me-2"></i>Change event or session</button></li>
                    <li><button class="dropdown-item" id="menu-roster"><i class="bi bi-cloud-download me-2"></i>Refresh roster</button></li>
                    <li><button class="dropdown-item" id="menu-kiosk"><i class="bi bi-tablet-landscape me-2"></i>Switch to kiosk mode</button></li>
                    <li><hr class="dropdown-divider"></li>` : ''}
                    <li><a class="dropdown-item" href="/admin/#/help/scanning" target="_blank" rel="noopener"><i class="bi bi-question-circle me-2"></i>Help</a></li>
                    <li><button class="dropdown-item" id="menu-signout"><i class="bi bi-box-arrow-right me-2"></i>Sign out</button></li>
                </ul>
            </div>
        </header>`;
}

function bindTopbar() {
    const on = (id, fn) => document.getElementById(id)?.addEventListener('click', fn);
    on('menu-signout', signOut);
    on('change-session', renderSetup);
    on('menu-session', renderSetup);
    on('sync-chip', () => syncNow());
    on('menu-roster', async () => {
        try {
            await app.engine.refreshRoster();
            toast(`Roster updated: ${app.engine.roster.registrations.length} attendees.`);
        } catch (err) {
            toast(isOffline(err) ? 'No connection. Using the roster already on this device.' : err.message, 'warning');
        }
    });
    on('menu-kiosk', async () => {
        const pin = await askKioskPin();
        if (!pin) return;
        app.kioskPin = pin;
        renderKiosk();
    });
}

async function syncNow() {
    const engine = app.engine;
    if (!engine) return;
    if (engine.needsLogin) return promptReLogin();
    if (!engine.reachable) return toast('Still offline. Scans will upload automatically when the connection returns.', 'warning');
    await engine.sync();
    if (engine.problems.length) showProblems();
    else if (!engine.pending) toast('All scans are synced.');
}

function updateStatus() {
    const engine = app.engine;
    if (!engine) return;
    const s = engine.stats();

    const conn = document.getElementById('conn-chip');
    if (conn) {
        conn.className = `status-chip ${engine.reachable ? 'online' : 'offline'}`;
        conn.innerHTML = engine.reachable ? '<i class="bi bi-wifi"></i><span>Online</span>' : '<i class="bi bi-wifi-off"></i><span>Offline</span>';
    }
    const sync = document.getElementById('sync-chip');
    if (sync) {
        const show = s.pending || s.problems || engine.needsLogin;
        sync.classList.toggle('d-none', !show);
        sync.classList.toggle('attention', Boolean(s.problems || engine.needsLogin));
        sync.innerHTML = engine.syncing
            ? '<span class="spinner-border spinner-border-sm"></span><span>Syncing</span>'
            : `<i class="bi bi-${engine.needsLogin ? 'person-lock' : 'cloud-upload'}"></i><span>${s.pending ? `${s.pending} to sync` : ''}${s.problems ? ` ${s.problems} issue${s.problems === 1 ? '' : 's'}` : ''}</span>`;
    }

    const roster = document.getElementById('roster-status');
    if (roster && engine.roster) {
        roster.innerHTML = `<i class="bi bi-people me-1"></i><strong>${s.registered}</strong> attendees in roster
            (${s.cleared} paid or waived) · downloaded ${esc(clock(engine.roster.downloaded_at))}
            ${engine.reachable ? '' : '<span class="badge text-bg-secondary ms-1">offline copy</span>'}`;
    }
    const setupSync = document.getElementById('setup-sync');
    if (setupSync) {
        setupSync.innerHTML = s.pending
            ? `<i class="bi bi-cloud-upload me-1"></i>${s.pending} scan${s.pending === 1 ? '' : 's'} waiting to sync`
            : '<i class="bi bi-cloud-check me-1"></i>All scans synced';
    }

    const count = document.getElementById('session-count');
    if (count) {
        count.innerHTML = `<strong>${s.checkedIn}</strong> <span>of ${s.registered} checked in</span>`;
    }
    const banner = document.getElementById('sync-banner');
    if (banner) {
        banner.innerHTML = engine.needsLogin
            ? `<div class="alert alert-warning d-flex align-items-center gap-2 py-2 mb-3"><i class="bi bi-person-lock"></i>
                <span class="me-auto small">Session expired. ${s.pending} scan${s.pending === 1 ? '' : 's'} saved on this device.</span>
                <button class="btn btn-sm btn-warning" data-relogin>Sign in to sync</button></div>`
            : s.problems
                ? `<div class="alert alert-danger d-flex align-items-center gap-2 py-2 mb-3"><i class="bi bi-exclamation-triangle"></i>
                    <span class="me-auto small">${s.problems} offline scan${s.problems === 1 ? ' was' : 's were'} rejected by the server.</span>
                    <button class="btn btn-sm btn-outline-danger" data-problems>Review</button></div>`
                : '';
        banner.querySelector('[data-relogin]')?.addEventListener('click', promptReLogin);
        banner.querySelector('[data-problems]')?.addEventListener('click', showProblems);
    }
}

function showProblems() {
    const rows = app.engine.problems.map((r) => `
        <li class="list-group-item px-0">
            <div class="fw-semibold">${esc(r.name || 'Unknown attendee')}</div>
            <div class="small text-muted">${esc(clock(r.check_in_time))} · ${esc(r.message || r.result)}</div>
        </li>`).join('');
    openModal({
        title: 'Rejected offline scans',
        body: `<p class="small text-muted">These scans were accepted offline but the server refused them, usually because the
            payment status changed or the pass was replaced. Send these attendees to the registration desk.</p>
            <ul class="list-group list-group-flush">${rows}</ul>`,
        submitLabel: 'Dismiss all',
        submitClass: 'btn-outline-danger',
        onSubmit: () => app.engine.dismissProblems(),
    });
}

/* ---------- Scanning ---------- */

async function startCamera(facingMode) {
    const box = document.getElementById('camera-message');
    box?.classList.add('d-none');
    app.camera ??= new Camera('reader', (text) => handleScan(text, 'camera'));
    try {
        await app.camera.start(facingMode);
        await store.setMeta(`camera_${app.mode}`, app.camera.facingMode);
        document.getElementById('torch-btn')?.classList.toggle('d-none', !app.camera.torch());
    } catch (err) {
        if (box) {
            box.classList.remove('d-none');
            box.innerHTML = `<i class="bi bi-camera-video-off fs-2"></i><p class="mb-2">${esc(cameraErrorMessage(err))}</p>
                <button class="btn btn-sm btn-light" id="camera-retry">Try again</button>`;
            document.getElementById('camera-retry').addEventListener('click', () => startCamera(facingMode));
        }
    }
}

async function stopScanning() {
    clearTimeout(app.kioskTimer);
    await app.camera?.stop();
    app.camera = null;
    app.wakeLock?.release().catch(() => {});
    app.wakeLock = null;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
}

/**
 * Camera reads repeat many times per second, so they are dropped while a scan is in progress.
 * Typed or searched check-ins are deliberate and are queued behind the current one instead.
 */
function handleScan(text, source) {
    const now = Date.now();
    if (source === 'camera') {
        if (app.busy) return Promise.resolve();
        if (text === app.lastScan.token && now - app.lastScan.at < SAME_PASS_IGNORE_MS[app.mode]) return Promise.resolve();
    }
    app.lastScan = { token: text, at: now };
    app.busy = true;
    const run = app.scanChain.then(() => processScan(text));
    app.scanChain = run.catch(() => {});
    return run;
}

async function processScan(text) {
    app.busy = true;
    clearTimeout(app.busyTimer);

    let result;
    try {
        result = await app.engine.checkIn(text);
    } catch (err) {
        result = { result: 'error', message: err.message };
    }
    signal((RESULTS[result.result] || RESULTS.error).sound);
    app.recent.unshift({ ...result, at: new Date().toISOString() });
    app.recent.length = Math.min(app.recent.length, RECENT_LIMIT);

    if (app.mode === 'kiosk') {
        showKioskResult(result);
        app.busyTimer = setTimeout(() => { app.busy = false; }, KIOSK_RESET_MS);
    } else {
        showStaffResult(result);
        app.busyTimer = setTimeout(() => { app.busy = false; }, 800);
    }
}

function resultDetails(result) {
    const a = result.attendee;
    const lines = [];
    if (result.result === 'duplicate' && result.check_in_time) lines.push(`First checked in at ${clock(result.check_in_time)}`);
    if (result.result === 'valid' && result.offline) lines.push('Saved offline · will sync automatically');
    return { a, lines };
}

function showStaffResult(result) {
    const style = RESULTS[result.result] || RESULTS.error;
    const { a, lines } = resultDetails(result);
    const card = document.getElementById('scan-result');
    card.className = 'scan-result';
    void card.offsetWidth;
    card.className = `scan-result tone-${style.tone} flash`;
    card.innerHTML = `
        <div class="result-icon"><i class="bi bi-${style.icon}"></i></div>
        <div class="min-w-0">
            <div class="result-title">${style.title}</div>
            ${a ? `<div class="result-name text-truncate">${esc(a.name)}</div>
                <div class="result-meta">${esc([a.chapter_region, a.prc_license_number && `PRC ${a.prc_license_number}`].filter(Boolean).join(' · '))}</div>` : ''}
            <div class="result-message">${esc(result.message || '')}</div>
            ${lines.map((l) => `<div class="result-meta">${esc(l)}</div>`).join('')}
        </div>`;
    const frame = document.getElementById('camera-frame');
    frame.dataset.tone = style.tone;
    clearTimeout(app.frameTimer);
    app.frameTimer = setTimeout(() => { delete frame.dataset.tone; }, 1200);
    renderRecent();
}

function renderRecent() {
    const list = document.getElementById('recent-list');
    if (!list) return;
    list.innerHTML = app.recent.length
        ? app.recent.map((r) => {
            const style = RESULTS[r.result] || RESULTS.error;
            return `<li class="recent-item tone-${style.tone}"><i class="bi bi-${style.icon}"></i>
                <span class="text-truncate">${esc(r.attendee?.name || 'Unknown pass')}</span>
                <span class="ms-auto text-muted small text-nowrap">${style.title} · ${esc(clock(r.at))}${r.offline ? ' <i class="bi bi-wifi-off" title="Offline"></i>' : ''}</span></li>`;
        }).join('')
        : '<li class="text-muted small py-2">Scans from this device will appear here.</li>';
}

async function renderStaff() {
    await stopScanning();
    app.mode = 'staff';
    root.innerHTML = `
        <div class="scanner-app">
            ${topbarHtml({ scanning: true })}
            <main class="scanner-main">
                <div id="sync-banner"></div>
                <div class="scanner-grid">
                    <section>
                        <div class="camera-frame" id="camera-frame">
                            <div id="reader"></div>
                            <div class="camera-message d-none" id="camera-message"></div>
                            <div class="camera-controls">
                                <button class="btn btn-dark btn-sm d-none" id="torch-btn" title="Flashlight"><i class="bi bi-lightbulb"></i></button>
                                <button class="btn btn-dark btn-sm" id="flip-btn" title="Switch camera"><i class="bi bi-camera-reels"></i></button>
                            </div>
                        </div>
                        <div class="session-count mt-2" id="session-count"></div>
                    </section>
                    <section>
                        <div class="scan-result tone-idle" id="scan-result">
                            <div class="result-icon"><i class="bi bi-qr-code-scan"></i></div>
                            <div><div class="result-title">Ready to scan</div>
                            <div class="result-message">Point the camera at an attendee's AgriPass QR code.</div></div>
                        </div>

                        <div class="card mt-3">
                            <div class="card-body">
                                <label class="form-label small fw-semibold" for="search">Can't scan? Find the attendee</label>
                                <input class="form-control" id="search" type="search" placeholder="Name, PRC license or chapter" autocomplete="off">
                                <ul class="search-results list-unstyled mb-0" id="search-results"></ul>
                                <form class="input-group input-group-sm mt-3" id="code-form">
                                    <input class="form-control" name="code" placeholder="Or type / paste the pass code (AGRIPASS|…)" autocomplete="off" aria-label="Pass code">
                                    <button class="btn btn-outline-primary" type="submit">Check in</button>
                                </form>
                            </div>
                        </div>

                        <div class="card mt-3">
                            <div class="card-body">
                                <h2 class="h6 fw-semibold mb-2">Recent scans</h2>
                                <ul class="list-unstyled mb-0" id="recent-list"></ul>
                            </div>
                        </div>
                    </section>
                </div>
            </main>
        </div>`;
    bindTopbar();
    updateStatus();
    renderRecent();

    const search = document.getElementById('search');
    const results = document.getElementById('search-results');
    search.addEventListener('input', () => {
        const matches = app.engine.search(search.value);
        results.innerHTML = matches.map((r) => `
            <li class="search-item">
                <div class="min-w-0 me-auto">
                    <div class="fw-semibold text-truncate">${esc(r.name)}</div>
                    <div class="small text-muted text-truncate">${esc([r.chapter_region, r.prc_license_number && `PRC ${r.prc_license_number}`].filter(Boolean).join(' · '))}</div>
                </div>
                ${r.checked_in_at
                    ? `<span class="badge text-bg-light text-nowrap"><i class="bi bi-check2"></i> ${esc(clock(r.checked_in_at))}</span>`
                    : ['Paid', 'Waived'].includes(r.payment_status)
                        ? `<button class="btn btn-sm btn-primary" data-token="${esc(r.qr_token)}">Check in</button>`
                        : `<span class="badge badge-status pay-${esc(r.payment_status)}">${esc(r.payment_status)}</span>`}
            </li>`).join('') || (search.value.trim().length >= 2 ? '<li class="small text-muted py-2">No attendee matches.</li>' : '');
    });
    results.addEventListener('click', async (e) => {
        const btn = e.target.closest('[data-token]');
        if (!btn) return;
        await handleScan(btn.dataset.token, 'manual');
        search.dispatchEvent(new Event('input'));
    });
    document.getElementById('code-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const input = e.target.elements.code;
        const code = input.value.trim();
        input.value = '';
        input.focus();
        if (code) await handleScan(code, 'manual');
    });

    document.getElementById('flip-btn').addEventListener('click', async () => {
        await app.camera?.stop();
        await startCamera(app.camera?.facingMode === 'user' ? 'environment' : 'user');
    });
    document.getElementById('torch-btn').addEventListener('click', async (e) => {
        const on = await app.camera.toggleTorch();
        e.currentTarget.classList.toggle('btn-warning', on);
        e.currentTarget.classList.toggle('btn-dark', !on);
    });

    await requestWakeLock();
    await startCamera((await store.getMeta('camera_staff')) || 'environment');
}

/* ---------- Kiosk ---------- */

function askKioskPin() {
    return new Promise((resolve) => {
        let pin = null;
        openModal({
            title: 'Start kiosk mode',
            body: `<p class="small text-muted">Kiosk mode locks this screen to self check-in. Set a PIN that staff will need to exit.</p>
                <label class="form-label" for="kiosk-pin">Exit PIN (4–8 digits)</label>
                <input class="form-control form-control-lg text-center" id="kiosk-pin" name="pin" inputmode="numeric" pattern="[0-9]*" maxlength="8" autocomplete="off" required>`,
            submitLabel: 'Start kiosk',
            submitClass: 'btn-accent',
            onSubmit: (form) => {
                const value = form.elements.pin.value.trim();
                if (!/^\d{4,8}$/.test(value)) {
                    throw Object.assign(new Error('Validation failed.'), { errors: { pin: 'Enter 4 to 8 digits.' } });
                }
                pin = value;
            },
        });
        document.getElementById('app-modal').addEventListener('shown.bs.modal', () => document.getElementById('kiosk-pin')?.focus(), { once: true });
        document.getElementById('app-modal').addEventListener('hidden.bs.modal', () => resolve(pin), { once: true });
    });
}

async function renderKiosk() {
    await stopScanning();
    app.mode = 'kiosk';
    const event = app.engine.roster.event;
    root.innerHTML = `
        <div class="kiosk">
            <header class="kiosk-header">
                <img src="/assets/img/paa-logo-yellow.png" alt="PAA">
                <div class="min-w-0">
                    <div class="kiosk-event text-truncate">${esc(event.title)}</div>
                    <div class="kiosk-session text-truncate">${esc(app.engine.session?.session_name)}</div>
                </div>
                <span class="ms-auto"><span class="status-chip" id="conn-chip"></span></span>
            </header>
            <main class="kiosk-body">
                <h1 class="kiosk-prompt">Hold your AgriPass QR code up to the camera</h1>
                <div class="camera-frame kiosk-camera" id="camera-frame">
                    <div id="reader"></div>
                    <div class="camera-message d-none" id="camera-message"></div>
                </div>
                <p class="kiosk-help">Your QR pass is in your confirmation email. Need help? Please approach the registration desk.</p>
            </main>
            <div class="kiosk-overlay d-none" id="kiosk-overlay" aria-live="assertive"></div>
            <button class="kiosk-exit" id="kiosk-exit" aria-label="Exit kiosk mode"><i class="bi bi-lock-fill"></i></button>
        </div>`;
    updateStatus();
    document.getElementById('kiosk-exit').addEventListener('click', exitKiosk);

    document.documentElement.requestFullscreen?.().catch(() => {});
    await requestWakeLock();
    await startCamera((await store.getMeta('camera_kiosk')) || 'user');
}

function showKioskResult(result) {
    const style = RESULTS[result.result] || RESULTS.error;
    const { a, lines } = resultDetails(result);
    const overlay = document.getElementById('kiosk-overlay');
    const first = a?.name?.split(' ')[0];
    const headline = result.result === 'valid' && first ? `Welcome, ${first}!` : style.title;
    const message = result.result === 'valid'
        ? `You're checked in to ${app.engine.session?.session_name}.`
        : result.message;

    overlay.className = `kiosk-overlay tone-${style.tone}`;
    overlay.innerHTML = `
        <i class="bi bi-${style.icon} kiosk-overlay-icon"></i>
        <div class="kiosk-overlay-title">${esc(headline)}</div>
        ${a ? `<div class="kiosk-overlay-name">${esc(a.name)}</div>` : ''}
        <div class="kiosk-overlay-message">${esc(message || '')}</div>
        ${lines.filter((l) => !l.startsWith('Saved offline')).map((l) => `<div class="kiosk-overlay-meta">${esc(l)}</div>`).join('')}`;
    clearTimeout(app.kioskTimer);
    app.kioskTimer = setTimeout(() => overlay.classList.add('d-none'), KIOSK_RESET_MS);
}

function exitKiosk() {
    openModal({
        title: 'Exit kiosk mode',
        body: `<label class="form-label" for="exit-pin">Enter the exit PIN</label>
            <input class="form-control form-control-lg text-center" id="exit-pin" name="pin" type="password" inputmode="numeric" maxlength="8" autocomplete="off" required>`,
        submitLabel: 'Exit kiosk',
        onSubmit: (form) => {
            if (form.elements.pin.value.trim() !== app.kioskPin) {
                throw Object.assign(new Error('Validation failed.'), { errors: { pin: 'Incorrect PIN.' } });
            }
            app.kioskPin = null;
            setTimeout(renderStaff, 300);
        },
    });
    document.getElementById('app-modal').addEventListener('shown.bs.modal', () => document.getElementById('exit-pin')?.focus(), { once: true });
}

async function requestWakeLock() {
    try {
        app.wakeLock = await navigator.wakeLock?.request('screen');
    } catch {
        // Not supported or denied; the screen may dim on its own.
    }
}

document.addEventListener('visibilitychange', async () => {
    if (!['staff', 'kiosk'].includes(app.mode)) return;
    if (document.hidden) {
        await app.camera?.stop();
    } else {
        await requestWakeLock();
        await startCamera(app.camera?.facingMode || (await store.getMeta(`camera_${app.mode}`)));
    }
});

window.addEventListener('agripass:unauthorized', () => app.engine?.setNeedsLogin(true));

start();
