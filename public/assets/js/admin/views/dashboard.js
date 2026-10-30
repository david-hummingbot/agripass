import { api } from '../../lib/api.js';
import { emptyState, esc, formatDate, formatDateRange, formatPeso, formatTime, statusBadge } from '../../lib/ui.js';
import { activeEvent, isAdmin, state } from '../state.js';

export async function renderDashboard() {
    const view = document.getElementById('view');
    const active = activeEvent();
    const upcoming = state.events.filter((e) => e.status !== 'Archived' && Number(e.is_active) !== 1).slice(0, 5);

    let activeHtml;
    if (active) {
        const { event } = await api(`/events/${active.event_id}`);
        activeHtml = activeEventPanel(event);
    } else {
        activeHtml = `<div class="card mb-4"><div class="card-body">${emptyState(
            'broadcast',
            'No active event',
            'Set an event as active to open registration and enable scanners.',
            isAdmin() ? '<a class="btn btn-primary" href="#/events">Choose an event</a>' : '',
        )}</div></div>`;
    }

    view.innerHTML = `
        <div class="d-flex align-items-center justify-content-between mb-4">
            <div>
                <h1 class="h3 page-title">Dashboard</h1>
                <p class="text-muted mb-0 small">Welcome back, ${esc(state.user.full_name)}.</p>
            </div>
            ${isAdmin() ? '<a class="btn btn-primary" href="#/events/new"><i class="bi bi-plus-lg me-1"></i>New Event</a>' : ''}
        </div>
        ${activeHtml}
        <div class="card">
            <div class="card-header bg-white d-flex justify-content-between align-items-center py-3">
                <h2 class="h6 mb-0 fw-semibold">Other events</h2>
                <a href="#/events" class="small">View all</a>
            </div>
            ${upcoming.length ? `
            <div class="list-group list-group-flush">
                ${upcoming.map((e) => `
                <a class="list-group-item list-group-item-action d-flex align-items-center gap-3 py-3" href="#/events/${e.event_id}">
                    <div class="flex-grow-1">
                        <div class="fw-semibold">${esc(e.title)}</div>
                        <div class="small text-muted">${esc(e.venue)} &middot; ${formatDateRange(e.start_date, e.end_date)}</div>
                    </div>
                    <span class="small text-muted">${e.registration_count} registered</span>
                    ${statusBadge(e.status)}
                </a>`).join('')}
            </div>` : `<div class="card-body">${emptyState('calendar', 'No other events yet')}</div>`}
        </div>`;
}

function activeEventPanel(event) {
    const { stats } = event;
    const cleared = stats.payments.Paid + stats.payments.Waived;
    const turnout = stats.registrations ? Math.round((stats.checked_in / stats.registrations) * 100) : 0;

    const kpi = (icon, label, value, sub = '', accent = false) => `
        <div class="col-sm-6 col-xl-3">
            <div class="card kpi-card h-100 ${accent ? 'accent' : ''}">
                <div class="card-body d-flex gap-3 align-items-start">
                    <div class="kpi-icon"><i class="bi bi-${icon}"></i></div>
                    <div>
                        <div class="kpi-label">${label}</div>
                        <div class="kpi-value">${value}</div>
                        <div class="small text-muted">${sub}</div>
                    </div>
                </div>
            </div>
        </div>`;

    return `
        <div class="card mb-4" style="border-left: 5px solid var(--paa-yellow)">
            <div class="card-body d-flex flex-wrap gap-3 align-items-center">
                <div class="flex-grow-1">
                    <div class="small text-uppercase text-muted fw-semibold mb-1"><span class="active-event-pill py-0 px-2 me-2 small"><span class="dot"></span>Live</span>Active event</div>
                    <h2 class="h4 fw-bold mb-1">${esc(event.title)}</h2>
                    <div class="text-muted"><i class="bi bi-geo-alt me-1"></i>${esc(event.venue)}
                        <span class="mx-2">&middot;</span><i class="bi bi-calendar3 me-1"></i>${formatDateRange(event.start_date, event.end_date)}</div>
                </div>
                <a class="btn btn-outline-primary" href="#/events/${event.event_id}">Manage event</a>
            </div>
        </div>
        <div class="row g-3 mb-4">
            ${kpi('people', 'Registrations', stats.registrations, `${cleared} cleared for entry`)}
            ${kpi('qr-code-scan', 'Checked in', stats.checked_in, `${turnout}% turnout`)}
            ${kpi('hourglass-split', 'Pending payment', stats.payments.Pending, 'Awaiting verification', true)}
            ${kpi('cash-coin', 'Revenue', formatPeso(stats.revenue), `${stats.payments.Paid} paid registrations`)}
        </div>
        <div class="card mb-4">
            <div class="card-header bg-white py-3"><h2 class="h6 mb-0 fw-semibold">Session attendance</h2></div>
            ${event.sessions.length ? `
            <div class="table-responsive">
                <table class="table align-middle mb-0">
                    <thead><tr><th>Session</th><th>Schedule</th><th style="width:35%">Attendance</th></tr></thead>
                    <tbody>
                        ${event.sessions.map((s) => {
                            const count = stats.session_attendance[s.session_id] || 0;
                            const pct = cleared ? Math.round((count / cleared) * 100) : 0;
                            return `<tr>
                                <td class="fw-semibold">${esc(s.session_name)}</td>
                                <td class="text-muted small">${formatDate(s.session_date, { weekday: 'short', month: 'short', day: 'numeric' })}, ${formatTime(s.start_time)} – ${formatTime(s.end_time)}</td>
                                <td><div class="d-flex align-items-center gap-2">
                                    <div class="progress flex-grow-1" style="height:.5rem"><div class="progress-bar" style="width:${pct}%"></div></div>
                                    <span class="small text-muted text-nowrap">${count} / ${cleared}</span></div></td>
                            </tr>`;
                        }).join('')}
                    </tbody>
                </table>
            </div>` : `<div class="card-body">${emptyState('clock', 'No sessions configured', 'Add sessions so scanners can record attendance.')}</div>`}
        </div>`;
}
