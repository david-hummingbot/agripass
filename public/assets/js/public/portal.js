import { api } from '../lib/api.js';
import { CHAPTERS } from '../lib/chapters.js';
import {
    clearFormErrors, esc, formatDate, formatDateRange, formatPeso, paymentBadge, showFormErrors, toast, toastError, withBusy,
} from '../lib/ui.js';
import { passPageUrl } from './pass-card.js';

const app = document.getElementById('app');
const signOut = document.getElementById('sign-out');

const PROFILE_FIELDS = [
    ['first_name', 'First name', { required: true, maxlength: 50, autocomplete: 'given-name' }],
    ['last_name', 'Last name', { required: true, maxlength: 50, autocomplete: 'family-name' }],
    ['contact_number', 'Mobile number', { maxlength: 20, type: 'tel', autocomplete: 'tel', placeholder: '09XX XXX XXXX' }],
    ['prc_license_number', 'PRC license number', { maxlength: 50 }],
    ['paa_id_number', 'PAA ID number', { maxlength: 50 }],
];

async function start() {
    const loginToken = new URLSearchParams(location.hash.slice(1)).get('login');
    if (loginToken) {
        history.replaceState(null, '', location.pathname);
        try {
            const { member } = await api('/portal/session', { method: 'POST', body: { token: loginToken } });
            return renderDashboard(member);
        } catch (err) {
            return renderSignIn(err.message);
        }
    }
    try {
        const { member } = await api('/portal/me');
        renderDashboard(member);
    } catch (err) {
        if (err.status === 401) renderSignIn();
        else app.innerHTML = `<div class="alert alert-danger">${esc(err.message || 'Could not reach AgriPass. Try again.')}</div>`;
    }
}

function renderSignIn(error = '') {
    signOut.classList.add('d-none');
    document.title = 'Sign in · My AgriPass';
    app.innerHTML = `
        <div class="card mx-auto" style="max-width:460px"><div class="card-body p-4 p-md-5">
            <div class="text-center mb-4">
                <i class="bi bi-person-circle fs-1 text-success"></i>
                <h1 class="h4 fw-bold mt-2 mb-1" style="color:var(--paa-green-dark)">Sign in to My AgriPass</h1>
                <p class="text-muted small mb-0">See your event registrations, open your QR passes and download CPD certificates.</p>
            </div>
            ${error ? `<div class="alert alert-warning small">${esc(error)}</div>` : ''}
            <form id="link-form" novalidate>
                <label class="form-label" for="email">Email you registered with</label>
                <input class="form-control mb-3" type="email" id="email" name="email" maxlength="100" autocomplete="email" required autofocus>
                <button class="btn btn-primary w-100" type="submit"><i class="bi bi-envelope me-1"></i>Email me a sign-in link</button>
            </form>
            <p class="small text-muted text-center mt-4 mb-0">No password needed. We'll email you a link that signs you in.<br>
                New to AgriPass? <a href="/">Register for an event</a> first.</p>
        </div></div>`;

    const form = document.getElementById('link-form');
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        clearFormErrors(form);
        const email = form.email.value.trim();
        if (!email) {
            showFormErrors(form, { errors: { email: 'Enter your email address.' } });
            return;
        }
        await withBusy(form.querySelector('[type=submit]'), async () => {
            try {
                const { message } = await api('/portal/login-link', { method: 'POST', body: { email } });
                renderLinkSent(email, message);
            } catch (err) {
                showFormErrors(form, err);
            }
        });
    });
}

function renderLinkSent(email, message) {
    app.innerHTML = `
        <div class="card mx-auto text-center" style="max-width:460px"><div class="card-body p-4 p-md-5">
            <i class="bi bi-envelope-check fs-1 text-success"></i>
            <h1 class="h4 fw-bold mt-2" style="color:var(--paa-green-dark)">Check your email</h1>
            <p class="text-muted">${esc(message)}</p>
            <p class="small text-muted">The link expires in 30 minutes and works once. Open it on this device to stay signed in here.</p>
            <button class="btn btn-link" type="button" id="different-email">Use a different email</button>
        </div></div>`;
    document.getElementById('different-email').addEventListener('click', () => {
        renderSignIn();
        document.getElementById('email').value = email;
    });
}

async function renderDashboard(member) {
    signOut.classList.remove('d-none');
    document.title = `${member.first_name} ${member.last_name} · My AgriPass`;
    const [{ registrations, cpd_units_earned: cpdEarned }, openEvent] = await Promise.all([
        api('/portal/registrations'),
        api('/active-event').then((r) => r.event).catch(() => null),
    ]);
    const registeredForOpen = openEvent && registrations.some((r) => r.event.event_id === openEvent.event_id);
    const certificates = registrations.filter((r) => r.certificate).length;

    app.innerHTML = `
        <div class="d-flex flex-wrap align-items-end justify-content-between gap-3 mb-4">
            <div>
                <h1 class="h3 fw-bold mb-1" style="color:var(--paa-green-dark)">Hi, ${esc(member.first_name)}!</h1>
                <div class="text-muted small">${esc(member.email)}</div>
            </div>
            <div class="d-flex gap-3">
                ${summaryStat(registrations.length, registrations.length === 1 ? 'Event' : 'Events')}
                ${summaryStat(certificates, certificates === 1 ? 'Certificate' : 'Certificates')}
                ${summaryStat(Number(cpdEarned), 'CPD units earned')}
            </div>
        </div>
        ${openEvent && !registeredForOpen ? `
        <div class="returning-box p-3 mb-4 d-flex flex-wrap align-items-center gap-3">
            <i class="bi bi-calendar-plus fs-3 text-success"></i>
            <div class="flex-grow-1"><div class="fw-semibold">Registration is open: ${esc(openEvent.title)}</div>
                <div class="small text-muted">${esc(openEvent.venue)} &middot; ${formatDateRange(openEvent.start_date, openEvent.end_date)}</div></div>
            <a class="btn btn-accent" href="/">Register now</a>
        </div>` : ''}
        <div class="row g-4">
            <div class="col-lg-8">
                <h2 class="h5 fw-semibold mb-3">My events</h2>
                ${registrations.length ? registrations.map(registrationCard).join('') : `
                <div class="card"><div class="card-body text-center text-muted py-5">
                    <i class="bi bi-calendar2 fs-1"></i><p class="mt-2 mb-0">You haven't registered for any events yet.</p>
                </div></div>`}
            </div>
            <div class="col-lg-4"><div id="profile"></div></div>
        </div>`;

    renderProfile(member);
}

function summaryStat(value, label) {
    return `<div class="text-center px-3 py-2 bg-white rounded border"><div class="h4 fw-bold mb-0" style="color:var(--paa-green)">${esc(value)}</div>
        <div class="small text-muted text-nowrap">${label}</div></div>`;
}

const EVENT_STATE = {
    Active: ['Upcoming', 'text-bg-success'],
    Completed: ['Ended', 'text-bg-secondary'],
    Archived: ['Ended', 'text-bg-secondary'],
};

function registrationCard(r) {
    const { event } = r;
    const [state, stateClass] = EVENT_STATE[event.status] || [event.status, 'text-bg-light'];
    const ended = event.status !== 'Active';
    const fee = Number(event.registration_fee);
    const due = r.payment_status === 'Pending' && fee > 0;

    return `
        <div class="card mb-3"><div class="card-body">
            <div class="d-flex flex-wrap justify-content-between gap-2 mb-2">
                <div>
                    <div class="fw-bold fs-5" style="color:var(--paa-green-dark)">${esc(event.title)}</div>
                    <div class="small text-muted"><i class="bi bi-geo-alt me-1"></i>${esc(event.venue)}</div>
                    <div class="small text-muted"><i class="bi bi-calendar3 me-1"></i>${formatDateRange(event.start_date, event.end_date)} &middot; ${esc(event.event_type)}</div>
                </div>
                <div><span class="badge ${stateClass}">${state}</span></div>
            </div>
            <div class="d-flex flex-wrap gap-4 small my-3">
                <div><div class="text-muted">Payment</div>${paymentBadge(r.payment_status)}${due ? ` <span class="text-muted">${formatPeso(fee)} due</span>` : ''}</div>
                ${r.sessions_total ? `<div><div class="text-muted">Sessions attended</div><strong>${r.sessions_attended} of ${r.sessions_total}</strong></div>` : ''}
                ${Number(event.cpd_units) > 0 ? `<div><div class="text-muted">CPD units</div><strong>${esc(Number(event.cpd_units))}</strong>
                    <span class="text-muted">(${event.cpd_min_attendance_pct}% attendance)</span></div>` : ''}
                <div><div class="text-muted">Registered</div>${formatDate(r.registration_date)}</div>
            </div>
            ${due && !ended ? `<div class="alert alert-warning small py-2">Your pass will be accepted once PAA verifies your payment.
                Pay through your chapter or at the registration desk.</div>` : ''}
            ${r.certificate_note ? `<div class="alert alert-light border small py-2 mb-3"><i class="bi bi-info-circle me-1"></i>${esc(r.certificate_note)}</div>` : ''}
            <div class="d-flex flex-wrap gap-2">
                ${r.certificate ? `<a class="btn btn-success btn-sm" href="/api/certificates/download?token=${encodeURIComponent(r.qr_token)}">
                    <i class="bi bi-award me-1"></i>Download CPD certificate</a>` : ''}
                ${r.payment_status !== 'Refunded' ? `<a class="btn ${ended ? 'btn-outline-primary' : 'btn-primary'} btn-sm" href="${passPageUrl(r.qr_token)}">
                    <i class="bi bi-qr-code me-1"></i>${ended ? 'View pass' : 'Open my QR pass'}</a>` : ''}
            </div>
            ${r.certificate ? `<div class="small text-muted mt-2">Certificate no. ${esc(r.certificate.certificate_no)} &middot;
                <a href="/verify/?code=${esc(r.certificate.verification_code)}">verify</a></div>` : ''}
        </div></div>`;
}

function renderProfile(member) {
    const el = document.getElementById('profile');
    const row = (label, value) => `<div class="mb-2"><div class="small text-muted">${label}</div><div>${value ? esc(value) : '<span class="text-muted">—</span>'}</div></div>`;

    el.innerHTML = `
        <div class="card"><div class="card-body">
            <div class="d-flex justify-content-between align-items-center mb-3">
                <h2 class="h5 fw-semibold mb-0">My profile</h2>
                <button class="btn btn-sm btn-outline-primary" type="button" id="edit-profile"><i class="bi bi-pencil me-1"></i>Edit</button>
            </div>
            ${row('Name', `${member.first_name} ${member.last_name}`)}
            ${row('Email', member.email)}
            ${row('Mobile number', member.contact_number)}
            ${row('PRC license number', member.prc_license_number)}
            ${row('PAA ID number', member.paa_id_number)}
            ${row('Chapter / region', member.chapter_region)}
        </div></div>`;
    document.getElementById('edit-profile').addEventListener('click', () => renderProfileForm(member));
}

function renderProfileForm(member) {
    const el = document.getElementById('profile');
    const input = ([name, label, opts]) => `
        <div class="mb-3">
            <label class="form-label small" for="${name}">${label}${opts.required ? ' <span class="text-danger">*</span>' : ''}</label>
            <input class="form-control form-control-sm" id="${name}" name="${name}" type="${opts.type || 'text'}" maxlength="${opts.maxlength}"
                   value="${esc(member[name] ?? '')}" ${opts.required ? 'required' : ''}
                   ${opts.autocomplete ? `autocomplete="${opts.autocomplete}"` : ''} ${opts.placeholder ? `placeholder="${opts.placeholder}"` : ''}>
        </div>`;
    const chapters = CHAPTERS.includes(member.chapter_region) || !member.chapter_region ? CHAPTERS : [member.chapter_region, ...CHAPTERS];

    el.innerHTML = `
        <div class="card"><div class="card-body">
            <h2 class="h5 fw-semibold mb-3">Edit profile</h2>
            <form id="profile-form" novalidate>
                ${PROFILE_FIELDS.map(input).join('')}
                <div class="mb-3">
                    <label class="form-label small" for="chapter_region">Chapter / region</label>
                    <select class="form-select form-select-sm" id="chapter_region" name="chapter_region">
                        <option value="">Select your chapter…</option>
                        ${chapters.map((c) => `<option ${c === member.chapter_region ? 'selected' : ''}>${esc(c)}</option>`).join('')}
                    </select>
                </div>
                <p class="small text-muted">To change your email address, contact PAA. Certificates already issued keep the name printed on them.</p>
                <div class="d-flex gap-2">
                    <button class="btn btn-primary btn-sm" type="submit">Save changes</button>
                    <button class="btn btn-light btn-sm" type="button" id="cancel-profile">Cancel</button>
                </div>
            </form>
        </div></div>`;

    const form = document.getElementById('profile-form');
    document.getElementById('cancel-profile').addEventListener('click', () => renderProfile(member));
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        clearFormErrors(form);
        const body = Object.fromEntries(new FormData(form));
        await withBusy(form.querySelector('[type=submit]'), async () => {
            try {
                const { member: updated } = await api('/portal/profile', { method: 'PUT', body });
                toast('Profile updated.');
                await renderDashboard(updated);
            } catch (err) {
                showFormErrors(form, err);
            }
        });
    });
}

signOut.addEventListener('click', async () => {
    try {
        await api('/portal/logout', { method: 'POST' });
        renderSignIn();
        toast('You have been signed out.');
    } catch (err) {
        toastError(err);
    }
});

window.addEventListener('hashchange', () => {
    if (location.hash.startsWith('#login=')) start();
});

start();
