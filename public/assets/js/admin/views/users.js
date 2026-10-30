import { api } from '../../lib/api.js';
import { confirmDialog, emptyState, esc, formatDateTime, formData, openModal, toast, toastError } from '../../lib/ui.js';
import { ROLE_LABELS, state } from '../state.js';

const ROLE_HELP = {
    SuperAdmin: 'Full access, including user accounts and every event.',
    RegionalOfficer: 'Manages events, sessions, registration forms and payments.',
    Staff: 'Gate staff: QR scanner and read-only dashboard.',
};

let users = [];

export async function renderUsers() {
    const view = document.getElementById('view');
    view.innerHTML = `
        <div class="d-flex flex-wrap gap-2 align-items-center justify-content-between mb-4">
            <div>
                <h1 class="h3 page-title">Users</h1>
                <p class="text-muted small mb-0">Staff accounts that can sign in to the dashboard and the scanner.</p>
            </div>
            <button class="btn btn-primary" id="add-user"><i class="bi bi-person-plus me-1"></i>Add user</button>
        </div>
        <div class="card">
            <div class="card-header bg-white py-3 d-flex flex-wrap gap-2 align-items-center">
                <select class="form-select form-select-sm" style="max-width:200px" id="role-filter" aria-label="Filter by role">
                    <option value="">All roles</option>
                    ${Object.entries(ROLE_LABELS).map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}
                </select>
                <div class="form-check form-switch small mb-0">
                    <input class="form-check-input" type="checkbox" id="show-inactive">
                    <label class="form-check-label" for="show-inactive">Show deactivated</label>
                </div>
                <input type="search" class="form-control form-control-sm ms-auto" style="max-width:260px" placeholder="Search name or email…" id="user-search">
            </div>
            <div id="user-table"></div>
        </div>`;

    document.getElementById('add-user').addEventListener('click', () => editUser());
    ['role-filter', 'show-inactive', 'user-search'].forEach((id) => document.getElementById(id).addEventListener('input', draw));

    users = (await api('/users')).users;
    draw();
}

function draw() {
    const role = document.getElementById('role-filter').value;
    const showInactive = document.getElementById('show-inactive').checked;
    const q = document.getElementById('user-search').value.trim().toLowerCase();
    const rows = users.filter((u) => (!role || u.role === role) && (showInactive || u.is_active)
        && `${u.full_name} ${u.email}`.toLowerCase().includes(q));
    const table = document.getElementById('user-table');

    if (!rows.length) {
        table.innerHTML = emptyState('people', 'No users match your filters');
        return;
    }

    table.innerHTML = `
        <div class="table-responsive">
            <table class="table table-hover align-middle mb-0">
                <thead><tr><th style="min-width:240px">Name</th><th>Role</th><th>Status</th><th>Last sign-in</th><th class="sticky-end"></th></tr></thead>
                <tbody>
                    ${rows.map((u) => `
                    <tr class="${u.is_active ? '' : 'text-muted'}">
                        <td>
                            <div class="fw-semibold">${esc(u.full_name)}${u.user_id === state.user.user_id ? ' <span class="badge text-bg-light">You</span>' : ''}</div>
                            <div class="small text-muted">${esc(u.email)}</div>
                        </td>
                        <td><span class="badge badge-status role-${esc(u.role)}">${esc(ROLE_LABELS[u.role] || u.role)}</span></td>
                        <td class="small">
                            ${u.is_active ? '<span class="text-success"><i class="bi bi-circle-fill me-1" style="font-size:.5rem"></i>Active</span>' : '<span><i class="bi bi-slash-circle me-1"></i>Deactivated</span>'}
                            ${u.is_active && u.must_change_password ? '<div class="text-muted" style="font-size:.75rem">Temporary password</div>' : ''}
                        </td>
                        <td class="small text-nowrap">${u.last_login_at ? esc(formatDateTime(u.last_login_at)) : '<span class="text-muted">Never</span>'}</td>
                        <td class="text-end text-nowrap sticky-end">
                            <button class="btn btn-sm btn-light" data-edit="${u.user_id}" title="Edit"><i class="bi bi-pencil"></i></button>
                            <button class="btn btn-sm btn-light" data-reset="${u.user_id}" title="Reset password"><i class="bi bi-key"></i></button>
                            ${u.user_id === state.user.user_id ? '' : u.is_active
                                ? `<button class="btn btn-sm btn-light text-danger" data-toggle="${u.user_id}" title="Deactivate"><i class="bi bi-person-slash"></i></button>`
                                : `<button class="btn btn-sm btn-light text-success" data-toggle="${u.user_id}" title="Reactivate"><i class="bi bi-person-check"></i></button>`}
                        </td>
                    </tr>`).join('')}
                </tbody>
            </table>
        </div>`;

    const byId = (id) => users.find((u) => u.user_id === Number(id));
    table.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => editUser(byId(b.dataset.edit))));
    table.querySelectorAll('[data-reset]').forEach((b) => b.addEventListener('click', () => resetPassword(byId(b.dataset.reset))));
    table.querySelectorAll('[data-toggle]').forEach((b) => b.addEventListener('click', () => toggleActive(byId(b.dataset.toggle))));
}

function upsert(user) {
    const i = users.findIndex((u) => u.user_id === user.user_id);
    if (i === -1) users.push(user);
    else users[i] = user;
    draw();
}

function editUser(user = null) {
    const self = user?.user_id === state.user.user_id;
    openModal({
        title: user ? 'Edit user' : 'Add user',
        submitLabel: user ? 'Save changes' : 'Create user',
        body: `
            <div class="mb-3">
                <label class="form-label" for="u-name">Full name</label>
                <input class="form-control" id="u-name" name="full_name" maxlength="100" value="${esc(user?.full_name)}" required>
            </div>
            <div class="mb-3">
                <label class="form-label" for="u-email">Email</label>
                <input class="form-control" id="u-email" name="email" type="email" maxlength="100" value="${esc(user?.email)}" required>
                <div class="form-text">Used to sign in.</div>
            </div>
            <div class="mb-1">
                <label class="form-label">Role</label>
                ${Object.entries(ROLE_LABELS).map(([value, label]) => `
                <div class="form-check role-option">
                    <input class="form-check-input" type="radio" name="role" id="role-${value}" value="${value}"
                        ${(user?.role || 'Staff') === value ? 'checked' : ''} ${self ? 'disabled' : ''}>
                    <label class="form-check-label" for="role-${value}">
                        <span class="fw-semibold">${label}</span>
                        <span class="d-block small text-muted">${ROLE_HELP[value]}</span>
                    </label>
                </div>`).join('')}
                ${self ? '<div class="form-text">You can\'t change your own role.</div>' : ''}
            </div>
            ${user ? '' : '<div class="alert alert-info small mb-0 mt-3"><i class="bi bi-info-circle me-1"></i>A temporary password is generated for you to share. They\'ll set their own the first time they sign in.</div>'}`,
        onSubmit: async (form) => {
            const data = formData(form);
            const role = form.querySelector('[name=role]:checked')?.value;
            const body = { full_name: data.full_name, email: data.email, role };
            if (user) {
                const res = await api(`/users/${user.user_id}`, { method: 'PUT', body: { ...body, is_active: user.is_active } });
                upsert(res.user);
                if (self) {
                    Object.assign(state.user, res.user);
                    window.dispatchEvent(new CustomEvent('agripass:user-changed'));
                }
                toast('User updated.');
            } else {
                const res = await api('/users', { method: 'POST', body });
                upsert(res.user);
                document.getElementById('app-modal').addEventListener('hidden.bs.modal',
                    () => showTemporaryPassword(res.user, res.temporary_password, 'Account created'), { once: true });
            }
        },
    });
}

async function resetPassword(user) {
    const ok = await confirmDialog({
        title: 'Reset password',
        message: `Generate a new temporary password for <strong>${esc(user.full_name)}</strong>? Their current password stops working immediately.`,
        confirmLabel: 'Reset password',
        confirmClass: 'btn-danger',
    });
    if (!ok) return;
    try {
        const res = await api(`/users/${user.user_id}/reset-password`, { method: 'POST' });
        upsert(res.user);
        showTemporaryPassword(res.user, res.temporary_password, 'Password reset');
    } catch (err) {
        toastError(err);
    }
}

async function toggleActive(user) {
    const activate = !user.is_active;
    const ok = await confirmDialog({
        title: activate ? 'Reactivate user' : 'Deactivate user',
        message: activate
            ? `Allow <strong>${esc(user.full_name)}</strong> to sign in again?`
            : `<strong>${esc(user.full_name)}</strong> will be signed out everywhere and can no longer sign in. Their past check-ins and audit history are kept.`,
        confirmLabel: activate ? 'Reactivate' : 'Deactivate',
        confirmClass: activate ? 'btn-primary' : 'btn-danger',
    });
    if (!ok) return;
    try {
        const res = await api(`/users/${user.user_id}`, {
            method: 'PUT',
            body: { full_name: user.full_name, email: user.email, role: user.role, is_active: activate },
        });
        upsert(res.user);
        toast(activate ? 'User reactivated.' : 'User deactivated.');
    } catch (err) {
        toastError(err);
    }
}

function showTemporaryPassword(user, password, title) {
    openModal({
        title,
        submitLabel: 'Done',
        body: `
            <p>Share these sign-in details with <strong>${esc(user.full_name)}</strong>. The password is shown only once.</p>
            <dl class="row mb-2 small">
                <dt class="col-4">Sign in at</dt><dd class="col-8"><code>${esc(location.origin)}/admin/</code></dd>
                <dt class="col-4">Email</dt><dd class="col-8"><code>${esc(user.email)}</code></dd>
            </dl>
            <label class="form-label small fw-semibold" for="temp-pw">Temporary password</label>
            <div class="input-group">
                <input class="form-control font-monospace fs-5" id="temp-pw" value="${esc(password)}" readonly>
                <button class="btn btn-outline-primary" type="button" id="copy-pw"><i class="bi bi-clipboard"></i> Copy</button>
            </div>
            <p class="small text-muted mt-2 mb-0">They'll be asked to choose their own password after signing in.</p>`,
        onSubmit: () => {},
    });
    document.getElementById('copy-pw').addEventListener('click', async (e) => {
        const input = document.getElementById('temp-pw');
        input.select();
        try {
            await navigator.clipboard.writeText(password);
        } catch {
            document.execCommand('copy');
        }
        e.currentTarget.innerHTML = '<i class="bi bi-check2"></i> Copied';
    });
}
