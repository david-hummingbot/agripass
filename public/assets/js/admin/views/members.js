import { api } from '../../lib/api.js';
import { CHAPTERS } from '../../lib/chapters.js';
import { emptyState, esc, formatDate, formatDateTime, formData, formatPeso, openModal, paymentBadge, statusBadge, toast } from '../../lib/ui.js';

export const MEMBERSHIP_LABELS = { Active: 'Active member', Inactive: 'Inactive member', NonMember: 'Non-member' };
const MEMBERSHIP_CLASSES = { Active: 'text-bg-success', Inactive: 'text-bg-secondary', NonMember: 'text-bg-light border' };

export const membershipBadge = (status) =>
    `<span class="badge ${MEMBERSHIP_CLASSES[status] || 'text-bg-light'}">${esc(MEMBERSHIP_LABELS[status] || status)}</span>`;

/** Kept across navigation so returning from a member's page restores the list. */
const filters = { q: '', status: '', chapter: '', page: 1 };
let searchTimer;

export async function renderMembers() {
    const view = document.getElementById('view');
    view.innerHTML = `
        <div class="mb-4">
            <h1 class="h3 page-title">Members</h1>
            <p class="text-muted small mb-0">Everyone who has registered for a PAA event. Members can also update their own details in My AgriPass.</p>
        </div>
        <div class="card">
            <div class="card-header bg-white py-3 d-flex flex-wrap gap-2 align-items-center">
                <input type="search" class="form-control form-control-sm" style="max-width:300px" id="member-search"
                       placeholder="Search name, email, PRC license, PAA ID…" value="${esc(filters.q)}">
                <select class="form-select form-select-sm" style="max-width:180px" id="status-filter" aria-label="Membership status">
                    <option value="">All statuses</option>
                    ${Object.entries(MEMBERSHIP_LABELS).map(([v, l]) => `<option value="${v}" ${filters.status === v ? 'selected' : ''}>${l}</option>`).join('')}
                </select>
                <select class="form-select form-select-sm" style="max-width:240px" id="chapter-filter" aria-label="Chapter"></select>
                <span class="ms-auto small text-muted" id="member-count"></span>
            </div>
            <div id="member-table"></div>
            <div class="card-footer bg-white d-flex justify-content-end gap-2 d-none" id="member-pager"></div>
        </div>`;

    document.getElementById('member-search').addEventListener('input', (e) => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => { filters.q = e.target.value.trim(); filters.page = 1; load(); }, 300);
    });
    document.getElementById('status-filter').addEventListener('change', (e) => { filters.status = e.target.value; filters.page = 1; load(); });
    document.getElementById('chapter-filter').addEventListener('change', (e) => { filters.chapter = e.target.value; filters.page = 1; load(); });
    await load();
}

async function load() {
    const params = new URLSearchParams(Object.entries(filters).filter(([, v]) => v !== '' && v !== null));
    const data = await api(`/members?${params}`);
    const table = document.getElementById('member-table');
    if (!table) return;

    const chapterSelect = document.getElementById('chapter-filter');
    chapterSelect.innerHTML = `<option value="">All chapters</option>
        ${data.chapters.map((c) => `<option ${c === filters.chapter ? 'selected' : ''}>${esc(c)}</option>`).join('')}`;

    const first = data.total ? (data.page - 1) * data.page_size + 1 : 0;
    const last = Math.min(data.total, data.page * data.page_size);
    document.getElementById('member-count').textContent = data.total ? `${first}–${last} of ${data.total}` : '';

    if (!data.members.length) {
        table.innerHTML = emptyState('person-vcard', filters.q || filters.status || filters.chapter ? 'No members match your filters' : 'No members yet',
            'Members are added automatically when they register for an event.');
    } else {
        table.innerHTML = `
            <div class="table-responsive">
                <table class="table table-hover align-middle mb-0">
                    <thead><tr><th style="min-width:220px">Member</th><th>PRC license / PAA ID</th><th>Chapter</th><th>Status</th>
                        <th>Activity</th><th>Portal sign-in</th></tr></thead>
                    <tbody>${data.members.map((m) => `
                        <tr class="clickable-row" data-member="${m.member_id}">
                            <td><a class="fw-semibold text-decoration-none" href="#/members/${m.member_id}">${esc(m.last_name)}, ${esc(m.first_name)}</a>
                                <div class="small text-muted">${esc(m.email)}</div></td>
                            <td class="small text-nowrap">${esc(m.prc_license_number) || '<span class="text-muted">—</span>'}
                                ${m.paa_id_number ? `<div class="text-muted">${esc(m.paa_id_number)}</div>` : ''}</td>
                            <td class="small">${esc(m.chapter_region) || '<span class="text-muted">—</span>'}</td>
                            <td class="text-nowrap">${membershipBadge(m.membership_status)}</td>
                            <td class="small text-nowrap">${plural(m.registrations, 'event')}
                                <div class="text-muted">${plural(m.certificates, 'certificate')}</div></td>
                            <td class="small text-nowrap">${m.last_portal_login_at ? formatDateTime(m.last_portal_login_at) : '<span class="text-muted">Never</span>'}</td>
                        </tr>`).join('')}
                    </tbody>
                </table>
            </div>`;
        table.querySelectorAll('[data-member]').forEach((row) => row.addEventListener('click', (e) => {
            if (!e.target.closest('a')) location.hash = `#/members/${row.dataset.member}`;
        }));
    }

    const pages = Math.ceil(data.total / data.page_size);
    const pager = document.getElementById('member-pager');
    pager.classList.toggle('d-none', pages <= 1);
    pager.innerHTML = `
        <button class="btn btn-sm btn-light border" id="prev-page" ${data.page <= 1 ? 'disabled' : ''}><i class="bi bi-chevron-left"></i> Previous</button>
        <span class="small text-muted align-self-center">Page ${data.page} of ${pages}</span>
        <button class="btn btn-sm btn-light border" id="next-page" ${data.page >= pages ? 'disabled' : ''}>Next <i class="bi bi-chevron-right"></i></button>`;
    document.getElementById('prev-page').addEventListener('click', () => { filters.page--; load(); });
    document.getElementById('next-page').addEventListener('click', () => { filters.page++; load(); });
}

export async function renderMemberDetail(memberId) {
    const { member, registrations, cpd_units_earned: cpdEarned } = await api(`/members/${memberId}`);
    const view = document.getElementById('view');
    const row = (label, value) => `<dt class="col-sm-5 text-muted fw-normal">${label}</dt><dd class="col-sm-7">${value || '<span class="text-muted">—</span>'}</dd>`;
    const certificates = registrations.filter((r) => r.certificate_id && !r.revoked_at).length;

    view.innerHTML = `
        <nav aria-label="breadcrumb"><ol class="breadcrumb small mb-2">
            <li class="breadcrumb-item"><a href="#/members">Members</a></li>
            <li class="breadcrumb-item active">${esc(member.first_name)} ${esc(member.last_name)}</li>
        </ol></nav>
        <div class="d-flex flex-wrap gap-3 align-items-start justify-content-between mb-4">
            <div>
                <h1 class="h3 page-title d-flex flex-wrap align-items-center gap-2">${esc(member.first_name)} ${esc(member.last_name)} ${membershipBadge(member.membership_status)}</h1>
                <div class="text-muted small"><i class="bi bi-envelope me-1"></i>${esc(member.email)}</div>
            </div>
            <button class="btn btn-outline-primary" id="edit-member"><i class="bi bi-pencil me-1"></i>Edit member</button>
        </div>
        <div class="row g-4">
            <div class="col-lg-5">
                <div class="card mb-4">
                    <div class="card-header bg-white py-3"><h2 class="h6 mb-0 fw-semibold">Profile</h2></div>
                    <div class="card-body"><dl class="row mb-0 small">
                        ${row('Mobile number', esc(member.contact_number))}
                        ${row('PRC license', esc(member.prc_license_number))}
                        ${row('PAA ID', esc(member.paa_id_number))}
                        ${row('Chapter / region', esc(member.chapter_region))}
                        ${row('First registered', formatDate(member.created_at))}
                        ${row('Last portal sign-in', member.last_portal_login_at ? formatDateTime(member.last_portal_login_at) : 'Never')}
                    </dl></div>
                </div>
            </div>
            <div class="col-lg-7">
                <div class="row g-3 mb-4">
                    ${stat('Events registered', registrations.length, 'calendar-check')}
                    ${stat('Certificates', certificates, 'award')}
                    ${stat('CPD units earned', Number(cpdEarned), 'mortarboard')}
                </div>
            </div>
        </div>
        <div class="card">
            <div class="card-header bg-white py-3"><h2 class="h6 mb-0 fw-semibold">Event history</h2></div>
            ${registrations.length ? `
            <div class="table-responsive">
                <table class="table align-middle mb-0">
                    <thead><tr><th>Event</th><th>Payment</th><th class="text-center">Sessions</th><th>CPD certificate</th><th>Registered</th></tr></thead>
                    <tbody>${registrations.map((r) => `
                        <tr>
                            <td><a class="fw-semibold text-decoration-none" href="#/events/${r.event_id}/registrations">${esc(r.title)}</a>
                                <div class="small text-muted">${formatDate(r.start_date)} ${statusBadge(r.event_status)}</div></td>
                            <td>${paymentBadge(r.payment_status)}
                                ${Number(r.amount_paid) > 0 ? `<div class="small text-muted">${formatPeso(r.amount_paid)}</div>` : ''}
                                ${r.payment_reference ? `<div class="small text-muted">${esc(r.payment_reference)}</div>` : ''}</td>
                            <td class="text-center">${r.sessions_attended} / ${r.sessions_total}</td>
                            <td class="small">${certificateCell(r)}</td>
                            <td class="small text-nowrap">${formatDateTime(r.registration_date)}</td>
                        </tr>`).join('')}
                    </tbody>
                </table>
            </div>` : `<div class="card-body">${emptyState('calendar2', 'No registrations')}</div>`}
        </div>`;

    document.getElementById('edit-member').addEventListener('click', () => editMember(member, () => renderMemberDetail(memberId)));
}

const plural = (count, noun) => `${Number(count)} ${noun}${Number(count) === 1 ? '' : 's'}`;

function certificateCell(r) {
    if (r.revoked_at) return `<span class="badge text-bg-danger">Revoked</span> <span class="text-muted text-nowrap">${esc(r.certificate_no)}</span>`;
    if (r.certificate_id) {
        return `<a class="text-nowrap" href="/api/certificates/${r.certificate_id}/pdf" target="_blank" rel="noopener">
            <i class="bi bi-file-earmark-pdf me-1"></i>${esc(r.certificate_no)}</a>
            <div class="text-muted">${esc(Number(r.certificate_cpd_units))} CPD units</div>`;
    }
    return '<span class="text-muted">—</span>';
}

function stat(label, value, icon) {
    return `<div class="col-sm-4"><div class="card h-100"><div class="card-body d-flex align-items-center gap-3">
        <i class="bi bi-${icon} fs-3 text-primary"></i><div><div class="h4 mb-0 fw-bold">${esc(value)}</div><div class="small text-muted">${label}</div></div>
    </div></div></div>`;
}

function editMember(member, onSaved) {
    const input = (name, label, attrs = '') => `
        <div class="col-md-6"><label class="form-label" for="m-${name}">${label}</label>
            <input class="form-control" id="m-${name}" name="${name}" value="${esc(member[name])}" ${attrs}></div>`;
    const chapters = !member.chapter_region || CHAPTERS.includes(member.chapter_region) ? CHAPTERS : [member.chapter_region, ...CHAPTERS];

    openModal({
        title: 'Edit member',
        submitLabel: 'Save changes',
        size: 'modal-lg',
        body: `
            <div class="row g-3">
                ${input('first_name', 'First name', 'maxlength="50" required')}
                ${input('last_name', 'Last name', 'maxlength="50" required')}
                <div class="col-12"><label class="form-label" for="m-email">Email</label>
                    <input class="form-control" type="email" id="m-email" name="email" value="${esc(member.email)}" maxlength="100" required>
                    <div class="form-text">The member signs in to My AgriPass with this address. Changing it cancels any sign-in links already sent.</div></div>
                ${input('contact_number', 'Mobile number', 'type="tel" maxlength="20"')}
                <div class="col-md-6"><label class="form-label" for="m-chapter_region">Chapter / region</label>
                    <select class="form-select" id="m-chapter_region" name="chapter_region">
                        <option value="">Not set</option>
                        ${chapters.map((c) => `<option ${c === member.chapter_region ? 'selected' : ''}>${esc(c)}</option>`).join('')}
                    </select></div>
                ${input('prc_license_number', 'PRC license number', 'maxlength="50"')}
                ${input('paa_id_number', 'PAA ID number', 'maxlength="50"')}
                <div class="col-md-6"><label class="form-label" for="m-membership_status">PAA membership</label>
                    <select class="form-select" id="m-membership_status" name="membership_status">
                        ${Object.entries(MEMBERSHIP_LABELS).map(([v, l]) => `<option value="${v}" ${member.membership_status === v ? 'selected' : ''}>${l}</option>`).join('')}
                    </select></div>
            </div>
            <p class="small text-muted mt-3 mb-0">Certificates already issued keep the name and PRC license printed on them.</p>`,
        onSubmit: async (form) => {
            await api(`/members/${member.member_id}`, { method: 'PUT', body: formData(form) });
            toast('Member updated.');
            onSaved();
        },
    });
}
