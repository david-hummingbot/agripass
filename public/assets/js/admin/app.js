import { api } from '../lib/api.js';
import { confirmDialog, esc, openModal, toast, toastError } from '../lib/ui.js';
import { passwordFields, renderForcedPasswordChange, submitPasswordChange } from '../lib/password.js';
import { activeEvent, isAdmin, isSuperAdmin, loadEvents, ROLE_LABELS, state } from './state.js';
import { renderLogin } from './views/login.js';
import { renderDashboard } from './views/dashboard.js';
import { renderEventList } from './views/event-list.js';
import { renderEventForm } from './views/event-form.js';
import { renderEventDetail } from './views/event-detail.js';
import { renderUsers } from './views/users.js';
import { renderMemberDetail, renderMembers } from './views/members.js';
import { renderHelp } from './views/help.js';

const adminOnly = (render) => (...args) => (isAdmin() ? render(...args) : Promise.reject(new Error('Only administrators can view members.')));

const routes = [
    [/^\/$/, () => renderDashboard()],
    [/^\/events$/, () => renderEventList()],
    [/^\/events\/new$/, () => renderEventForm()],
    [/^\/events\/(\d+)\/edit$/, (id) => renderEventForm(Number(id))],
    [/^\/events\/(\d+)(?:\/(\w+))?$/, (id, tab) => renderEventDetail(Number(id), tab)],
    [/^\/members$/, adminOnly(() => renderMembers())],
    [/^\/members\/(\d+)$/, adminOnly((id) => renderMemberDetail(Number(id)))],
    [/^\/users$/, () => (isSuperAdmin() ? renderUsers() : Promise.reject(new Error('Only Super Admins can manage users.')))],
    [/^\/help(?:\/([\w-]+))?$/, (slug) => renderHelp(slug)],
];

const root = document.getElementById('root');

function renderShell() {
    root.innerHTML = `
        <div class="app-shell">
            <aside class="sidebar" id="sidebar">
                <div class="sidebar-brand">
                    <img src="/assets/img/paa-logo-yellow.png" alt="Philippine Association of Agriculturists">
                    <div class="brand-name">AgriPass</div>
                    <div class="brand-sub">Admin Dashboard</div>
                </div>
                <nav class="nav flex-column py-3">
                    <a class="nav-link" href="#/" data-nav="dashboard"><i class="bi bi-speedometer2"></i>Dashboard</a>
                    <a class="nav-link" href="#/events" data-nav="events"><i class="bi bi-calendar-event"></i>Events</a>
                    ${isAdmin() ? '<a class="nav-link" href="#/events/new" data-nav="new"><i class="bi bi-plus-circle"></i>New Event</a>' : ''}
                    ${isAdmin() ? '<a class="nav-link" href="#/members" data-nav="members"><i class="bi bi-person-vcard"></i>Members</a>' : ''}
                    ${isSuperAdmin() ? '<a class="nav-link" href="#/users" data-nav="users"><i class="bi bi-people"></i>Users</a>' : ''}
                    <a class="nav-link" href="/scanner/" target="_blank" rel="noopener"><i class="bi bi-qr-code-scan"></i>QR Scanner<i class="bi bi-box-arrow-up-right ms-auto small opacity-50"></i></a>
                    <a class="nav-link" href="#/help" data-nav="help"><i class="bi bi-question-circle"></i>Help</a>
                </nav>
                <div class="sidebar-footer">Philippine Association of Agriculturists, Inc.</div>
            </aside>
            <div class="main">
                <header class="topbar">
                    <button class="btn btn-light d-lg-none" id="sidebar-toggle" aria-label="Toggle navigation"><i class="bi bi-list"></i></button>
                    <div class="dropdown" id="event-switcher"></div>
                    <div class="ms-auto dropdown">
                        <button class="btn btn-light dropdown-toggle d-flex align-items-center gap-2" data-bs-toggle="dropdown">
                            <i class="bi bi-person-circle fs-5 text-success"></i>
                            <span class="d-none d-sm-inline text-start lh-sm">
                                <span class="d-block fw-semibold small" id="user-name">${esc(state.user.full_name)}</span>
                                <span class="d-block text-muted" style="font-size:.7rem">${esc(ROLE_LABELS[state.user.role] || state.user.role)}</span>
                            </span>
                        </button>
                        <ul class="dropdown-menu dropdown-menu-end">
                            <li><span class="dropdown-item-text small text-muted">${esc(state.user.email)}</span></li>
                            <li><hr class="dropdown-divider"></li>
                            <li><button class="dropdown-item" id="change-password"><i class="bi bi-key me-2"></i>Change password</button></li>
                            <li><button class="dropdown-item" id="logout"><i class="bi bi-box-arrow-right me-2"></i>Sign out</button></li>
                        </ul>
                    </div>
                </header>
                <main class="content" id="view"></main>
            </div>
        </div>`;

    document.getElementById('logout').addEventListener('click', signOut);
    document.getElementById('change-password').addEventListener('click', () => openModal({
        title: 'Change password',
        body: passwordFields(),
        submitLabel: 'Update password',
        onSubmit: async (form) => {
            state.user = await submitPasswordChange(form);
            toast('Password updated.');
        },
    }));
    document.getElementById('sidebar-toggle').addEventListener('click', () => {
        document.getElementById('sidebar').classList.toggle('show');
    });
    renderEventSwitcher();
}

async function signOut() {
    await api('/auth/logout', { method: 'POST' }).catch(() => {});
    state.user = null;
    location.hash = '#/';
    renderLogin(start);
}

function renderEventSwitcher() {
    const el = document.getElementById('event-switcher');
    if (!el) return;
    const active = activeEvent();
    const candidates = state.events.filter((e) => ['Draft', 'Active'].includes(e.status) && Number(e.is_active) !== 1);

    el.innerHTML = `
        <button class="active-event-pill btn text-truncate ${isAdmin() ? 'dropdown-toggle' : ''}" ${isAdmin() ? 'data-bs-toggle="dropdown"' : ''}
                title="Active event used by registration, payments and scanners">
            ${active
                ? `<span class="dot"></span><span class="fw-semibold">Active:</span> ${esc(active.title)}`
                : '<i class="bi bi-exclamation-circle me-1"></i>No active event'}
        </button>
        ${isAdmin() ? `
        <ul class="dropdown-menu shadow">
            <li><h6 class="dropdown-header">Switch active event</h6></li>
            ${candidates.length
                ? candidates.map((e) => `<li><button class="dropdown-item" data-activate="${e.event_id}">
                    ${esc(e.title)} <span class="text-muted small">(${esc(e.status)})</span></button></li>`).join('')
                : '<li><span class="dropdown-item-text small text-muted">No other Draft or Active events</span></li>'}
        </ul>` : ''}`;

    el.querySelectorAll('[data-activate]').forEach((btn) => btn.addEventListener('click', () => activateEvent(Number(btn.dataset.activate))));
}

export async function activateEvent(eventId) {
    const event = state.events.find((e) => Number(e.event_id) === eventId);
    const ok = await confirmDialog({
        title: 'Switch active event',
        message: `Make <strong>${esc(event?.title)}</strong> the active event? Registration, payments and all scanners will switch to it.`,
        confirmLabel: 'Set as active',
    });
    if (!ok) return false;
    try {
        await api(`/events/${eventId}/activate`, { method: 'POST' });
        await loadEvents();
        toast('Active event updated.');
        route();
        return true;
    } catch (err) {
        toastError(err);
        return false;
    }
}

async function route() {
    const path = location.hash.replace(/^#/, '') || '/';
    const view = document.getElementById('view');
    if (!view) return;

    document.querySelectorAll('[data-nav]').forEach((a) => {
        const nav = a.dataset.nav;
        const on = (nav === 'dashboard' && path === '/')
            || (nav === 'new' && path === '/events/new')
            || (nav === 'events' && path.startsWith('/events') && path !== '/events/new')
            || (nav === 'members' && path.startsWith('/members'))
            || (nav === 'users' && path === '/users')
            || (nav === 'help' && path.startsWith('/help'));
        a.classList.toggle('active', on);
    });
    document.getElementById('sidebar')?.classList.remove('show');

    for (const [pattern, render] of routes) {
        const match = path.match(pattern);
        if (!match) continue;
        view.innerHTML = '<div class="text-center py-5"><div class="spinner-border text-success"></div></div>';
        try {
            await render(...match.slice(1));
        } catch (err) {
            if (err.status === 401) return;
            view.innerHTML = `<div class="alert alert-danger">${esc(err.message)}</div>`;
        }
        window.scrollTo(0, 0);
        return;
    }
    view.innerHTML = '<div class="alert alert-warning">Page not found. <a href="#/">Go to dashboard</a></div>';
}

async function start() {
    document.getElementById('app-loading')?.remove();
    try {
        state.user = (await api('/auth/me')).user;
    } catch {
        renderLogin(start);
        return;
    }
    if (state.user.must_change_password) {
        renderForcedPasswordChange(root, state.user, (user) => {
            state.user = user;
            toast('Password updated. Welcome to AgriPass!');
            start();
        }, { onSignOut: signOut });
        return;
    }
    await loadEvents();
    renderShell();
    route();
}

window.addEventListener('hashchange', route);
window.addEventListener('agripass:events-changed', renderEventSwitcher);
window.addEventListener('agripass:user-changed', () => {
    const name = document.getElementById('user-name');
    if (name) name.textContent = state.user.full_name;
});
window.addEventListener('agripass:unauthorized', () => {
    if (!state.user) return;
    state.user = null;
    toast('Your session has expired. Please sign in again.', 'warning');
    renderLogin(start);
});

start();
