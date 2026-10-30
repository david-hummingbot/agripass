import { activateEvent } from '../app.js';
import { isAdmin, loadEvents, state } from '../state.js';
import { emptyState, esc, formatDateRange, statusBadge } from '../../lib/ui.js';

const FILTERS = ['All', 'Draft', 'Active', 'Completed', 'Archived'];

export async function renderEventList() {
    await loadEvents();
    const view = document.getElementById('view');
    let filter = 'All';
    let search = '';

    view.innerHTML = `
        <div class="d-flex flex-wrap gap-2 align-items-center justify-content-between mb-4">
            <h1 class="h3 page-title">Events</h1>
            ${isAdmin() ? '<a class="btn btn-primary" href="#/events/new"><i class="bi bi-plus-lg me-1"></i>New Event</a>' : ''}
        </div>
        <div class="card">
            <div class="card-header bg-white py-3 d-flex flex-wrap gap-2 align-items-center">
                <div class="btn-group btn-group-sm" role="group" id="filters">
                    ${FILTERS.map((f) => `<button type="button" class="btn btn-outline-primary ${f === filter ? 'active' : ''}" data-filter="${f}">${f}</button>`).join('')}
                </div>
                <input type="search" class="form-control form-control-sm ms-auto" style="max-width:260px" placeholder="Search events…" id="event-search">
            </div>
            <div id="event-table"></div>
        </div>`;

    const draw = () => {
        const rows = state.events.filter((e) => (filter === 'All' || e.status === filter)
            && `${e.title} ${e.venue}`.toLowerCase().includes(search));
        const table = document.getElementById('event-table');

        if (!rows.length) {
            table.innerHTML = emptyState('calendar-x', state.events.length ? 'No events match your filters' : 'No events yet',
                state.events.length ? '' : 'Create your first event to get started.',
                !state.events.length && isAdmin() ? '<a class="btn btn-primary" href="#/events/new">Create event</a>' : '');
            return;
        }

        table.innerHTML = `
            <div class="table-responsive">
                <table class="table table-hover align-middle mb-0">
                    <thead><tr><th style="min-width:280px">Event</th><th>Type</th><th>Dates</th><th class="text-center">Sessions</th>
                        <th class="text-center">Registered</th><th>Status</th><th></th></tr></thead>
                    <tbody>
                        ${rows.map((e) => `
                        <tr>
                            <td>
                                <a class="fw-semibold text-decoration-none" href="#/events/${e.event_id}">${esc(e.title)}</a>
                                ${Number(e.is_active) === 1 ? '<span class="badge text-bg-warning ms-1"><i class="bi bi-broadcast"></i> Active event</span>' : ''}
                                <div class="small text-muted">${esc(e.venue)}</div>
                            </td>
                            <td class="small">${esc(e.event_type)}</td>
                            <td class="small text-nowrap">${formatDateRange(e.start_date, e.end_date)}</td>
                            <td class="text-center">${e.session_count}</td>
                            <td class="text-center">${e.registration_count}</td>
                            <td>${statusBadge(e.status)}</td>
                            <td class="text-end text-nowrap">
                                ${isAdmin() && ['Draft', 'Active'].includes(e.status) && Number(e.is_active) !== 1
                                    ? `<button class="btn btn-sm btn-outline-primary" data-activate="${e.event_id}" title="Set as active event"><i class="bi bi-broadcast"></i></button>` : ''}
                                <a class="btn btn-sm btn-light" href="#/events/${e.event_id}">Open</a>
                            </td>
                        </tr>`).join('')}
                    </tbody>
                </table>
            </div>`;

        table.querySelectorAll('[data-activate]').forEach((btn) => btn.addEventListener('click', () => activateEvent(Number(btn.dataset.activate))));
    };

    document.getElementById('filters').addEventListener('click', (e) => {
        const btn = e.target.closest('[data-filter]');
        if (!btn) return;
        filter = btn.dataset.filter;
        document.querySelectorAll('#filters .btn').forEach((b) => b.classList.toggle('active', b === btn));
        draw();
    });
    document.getElementById('event-search').addEventListener('input', (e) => {
        search = e.target.value.trim().toLowerCase();
        draw();
    });

    draw();
}
