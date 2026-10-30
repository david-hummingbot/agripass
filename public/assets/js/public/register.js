import { api } from '../lib/api.js';
import {
    clearFormErrors, esc, formatDate, formatDateRange, formatPeso, formatTime, showFormErrors, toast, toastError, withBusy,
} from '../lib/ui.js';
import { passActions, passCard } from './pass-card.js';

const CHAPTERS = [
    'NCR - National Capital Region', 'CAR - Cordillera Administrative Region', 'Region I - Ilocos Region',
    'Region II - Cagayan Valley', 'Region III - Central Luzon', 'Region IV-A - CALABARZON', 'MIMAROPA Region',
    'Region V - Bicol Region', 'Region VI - Western Visayas', 'NIR - Negros Island Region', 'Region VII - Central Visayas',
    'Region VIII - Eastern Visayas', 'Region IX - Zamboanga Peninsula', 'Region X - Northern Mindanao',
    'Region XI - Davao Region', 'Region XII - SOCCSKSARGEN', 'Region XIII - Caraga', 'BARMM - Bangsamoro',
    'International / Overseas',
];

const PROFILE_FIELDS = ['first_name', 'last_name', 'email', 'contact_number', 'prc_license_number', 'paa_id_number', 'chapter_region'];

const app = document.getElementById('app');

async function start() {
    let event;
    try {
        ({ event } = await api('/active-event'));
    } catch (err) {
        app.innerHTML = err.status === 404 ? noEvent() : `<div class="alert alert-danger">${esc(err.message)}</div>`;
        return;
    }
    document.title = `Register · ${event.title} · AgriPass`;
    renderForm(event);
}

const noEvent = () => `
    <div class="card text-center mx-auto" style="max-width:520px"><div class="card-body p-5">
        <i class="bi bi-calendar2-x fs-1 text-muted"></i>
        <h1 class="h4 mt-3">Registration is currently closed</h1>
        <p class="text-muted mb-0">There is no event open for registration right now. Please check back soon or follow
            <a href="https://www.paaph.org/" target="_blank" rel="noopener">paaph.org</a> for announcements.</p>
    </div></div>`;

function hero(event) {
    const fee = Number(event.registration_fee);
    const fact = (label, value) => `<div class="col-6 col-md-3"><div class="fact"><div class="fact-label">${label}</div><div class="fact-value">${value}</div></div></div>`;

    return `
        <section class="event-hero p-4 p-md-5 mb-4">
            <span class="badge text-bg-warning mb-2">${esc(event.event_type)}</span>
            <h1 class="event-title display-6 mb-2">${esc(event.title)}</h1>
            <div class="meta mb-4">
                <div><i class="bi bi-geo-alt me-1"></i>${esc(event.venue)}</div>
                <div><i class="bi bi-calendar3 me-1"></i>${formatDateRange(event.start_date, event.end_date)}</div>
            </div>
            ${event.description ? `<p class="mb-4" style="white-space:pre-line">${esc(event.description)}</p>` : ''}
            <div class="row g-2">
                ${fact('Registration fee', fee > 0 ? formatPeso(fee) : 'Free')}
                ${fact('CPD units', Number(event.cpd_units) > 0 ? esc(Number(event.cpd_units)) : '—')}
                ${fact('Sessions', event.sessions.length || '—')}
                ${fact('PRC accreditation', esc(event.prc_accreditation_no) || '—')}
            </div>
        </section>`;
}

function schedule(event) {
    if (!event.sessions.length) return '';
    return `
        <div class="card mb-4"><div class="card-body p-4">
            <div class="section-title"><i class="bi bi-clock"></i>Schedule</div>
            <div class="row g-3">
                ${event.sessions.map((s) => `
                <div class="col-md-6"><div class="schedule-item">
                    <div class="fw-semibold">${esc(s.session_name)}</div>
                    <div class="small text-muted">${formatDate(s.session_date, { weekday: 'long', month: 'long', day: 'numeric' })}
                        &middot; ${formatTime(s.start_time)} – ${formatTime(s.end_time)}</div>
                </div></div>`).join('')}
            </div>
            ${Number(event.cpd_units) > 0 ? `<p class="small text-muted mt-3 mb-0"><i class="bi bi-award me-1"></i>
                Attend at least ${esc(event.cpd_min_attendance_pct)}% of sessions to receive your CPD Certificate of Attendance.</p>` : ''}
        </div></div>`;
}

function customFieldInput(field) {
    const name = `cf_${field.field_id}`;
    const required = Number(field.is_required);
    const label = `${esc(field.field_label)}${required ? ' <span class="text-danger">*</span>' : ''}`;

    if (field.field_type === 'checkbox') {
        return `<div class="col-12"><div class="form-check">
            <input class="form-check-input" type="checkbox" id="${name}" name="${name}">
            <label class="form-check-label" for="${name}">${esc(field.field_label)}</label></div></div>`;
    }
    if (field.field_type === 'select') {
        return `<div class="col-md-6"><label class="form-label" for="${name}">${label}</label>
            <select class="form-select" id="${name}" name="${name}" ${required ? 'required' : ''}>
                <option value="">Select…</option>
                ${(field.field_options || []).map((o) => `<option>${esc(o)}</option>`).join('')}
            </select></div>`;
    }
    const type = field.field_type === 'number' ? 'number' : 'text';
    return `<div class="col-md-6"><label class="form-label" for="${name}">${label}</label>
        <input class="form-control" type="${type}" id="${name}" name="${name}" ${type === 'text' ? 'maxlength="500"' : 'step="any"'} ${required ? 'required' : ''}></div>`;
}

function renderForm(event) {
    const fee = Number(event.registration_fee);

    app.innerHTML = `
        ${hero(event)}
        ${schedule(event)}
        <div class="card mb-4"><div class="card-body p-4 p-md-5">
            <h2 class="h4 fw-bold mb-1" style="color:var(--paa-green-dark)">Register for this event</h2>
            <p class="text-muted mb-4">Fields marked <span class="text-danger">*</span> are required. Your QR pass will be shown right after you register and sent to your email.</p>

            <div class="returning-box p-3 mb-4">
                <div class="d-flex align-items-center gap-2 mb-2"><i class="bi bi-person-check fs-5 text-success"></i>
                    <strong>Registered with PAA before?</strong></div>
                <p class="small text-muted mb-2">Enter your email and PRC license or PAA ID number to fill in your details automatically.</p>
                <form id="lookup-form" class="row g-2" novalidate>
                    <div class="col-md-5"><input class="form-control" type="email" name="email" placeholder="Email address" aria-label="Email address"></div>
                    <div class="col-md-4"><input class="form-control" name="id_number" placeholder="PRC license or PAA ID no." aria-label="PRC license or PAA ID number"></div>
                    <div class="col-md-3 d-grid"><button class="btn btn-accent" type="submit">Fill my details</button></div>
                </form>
            </div>

            <form id="register-form" novalidate>
                <div class="section-title"><i class="bi bi-person"></i>Personal information</div>
                <div class="row g-3 mb-4">
                    <div class="col-md-6"><label class="form-label" for="first_name">First name <span class="text-danger">*</span></label>
                        <input class="form-control" id="first_name" name="first_name" maxlength="50" autocomplete="given-name" required></div>
                    <div class="col-md-6"><label class="form-label" for="last_name">Last name <span class="text-danger">*</span></label>
                        <input class="form-control" id="last_name" name="last_name" maxlength="50" autocomplete="family-name" required></div>
                    <div class="col-md-6"><label class="form-label" for="email">Email <span class="text-danger">*</span></label>
                        <input class="form-control" type="email" id="email" name="email" maxlength="100" autocomplete="email" required>
                        <div class="form-text">Your QR pass will be sent here.</div></div>
                    <div class="col-md-6"><label class="form-label" for="contact_number">Mobile number</label>
                        <input class="form-control" type="tel" id="contact_number" name="contact_number" maxlength="20" autocomplete="tel" placeholder="09XX XXX XXXX"></div>
                </div>

                <div class="section-title"><i class="bi bi-patch-check"></i>Professional details</div>
                <div class="row g-3 mb-4">
                    <div class="col-md-6"><label class="form-label" for="prc_license_number">PRC license number</label>
                        <input class="form-control" id="prc_license_number" name="prc_license_number" maxlength="50">
                        <div class="form-text">Required to credit CPD units to your PRC record.</div></div>
                    <div class="col-md-6"><label class="form-label" for="paa_id_number">PAA ID number</label>
                        <input class="form-control" id="paa_id_number" name="paa_id_number" maxlength="50"></div>
                    <div class="col-12"><label class="form-label" for="chapter_region">PAA chapter / region</label>
                        <select class="form-select" id="chapter_region" name="chapter_region">
                            <option value="">Select your chapter…</option>
                            ${CHAPTERS.map((c) => `<option>${esc(c)}</option>`).join('')}
                        </select></div>
                </div>

                ${event.custom_fields.length ? `
                <div class="section-title"><i class="bi bi-ui-checks"></i>Event questions</div>
                <div class="row g-3 mb-4">${event.custom_fields.map(customFieldInput).join('')}</div>` : ''}

                <div class="section-title"><i class="bi bi-wallet2"></i>Payment</div>
                <div class="d-flex justify-content-between align-items-center p-3 rounded mb-2" style="background:var(--paa-light)">
                    <span>Registration fee</span><strong class="fs-5">${fee > 0 ? formatPeso(fee) : 'Free'}</strong>
                </div>
                <p class="small text-muted mb-4">${fee > 0
                    ? 'Online payment via GCash and Maya is coming soon. For now, pay through your PAA chapter or at the registration desk. Your pass will be accepted once your payment is verified.'
                    : 'This event is free of charge. Your pass is valid immediately.'}</p>

                <div class="form-check mb-4">
                    <input class="form-check-input" type="checkbox" id="privacy_consent" name="privacy_consent" required>
                    <label class="form-check-label small" for="privacy_consent">
                        I consent to the Philippine Association of Agriculturists, Inc. collecting and processing my personal information for event
                        registration, attendance, and CPD reporting to the PRC, in accordance with the Data Privacy Act of 2012 (RA 10173).
                        <span class="text-danger">*</span></label>
                </div>

                <button class="btn btn-primary btn-lg w-100" type="submit"><i class="bi bi-qr-code me-2"></i>Register &amp; get my QR pass</button>
            </form>

            <p class="text-center small text-muted mt-4 mb-0">Already registered?
                <a href="#" id="resend-link">Email my pass again</a></p>
            <form id="resend-form" class="row g-2 justify-content-center mt-2 d-none" novalidate>
                <div class="col-md-6"><input class="form-control" type="email" name="email" placeholder="Email you registered with" aria-label="Email you registered with"></div>
                <div class="col-md-3 d-grid"><button class="btn btn-outline-primary" type="submit">Send</button></div>
            </form>
        </div></div>`;

    bindLookup();
    bindResend(event);
    bindRegister(event);
}

function bindLookup() {
    const form = document.getElementById('lookup-form');
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const body = { email: form.email.value.trim(), id_number: form.id_number.value.trim() };
        if (!body.email || !body.id_number) {
            toast('Enter both your email and your PRC license or PAA ID number.', 'warning');
            return;
        }
        await withBusy(form.querySelector('[type=submit]'), async () => {
            try {
                const { member } = await api('/members/lookup', { method: 'POST', body });
                const reg = document.getElementById('register-form');
                for (const field of PROFILE_FIELDS) {
                    if (member[field] && reg[field]) reg[field].value = member[field];
                }
                toast(`Welcome back, ${member.first_name}! Please review your details below.`);
                reg.first_name.focus();
            } catch (err) {
                toastError(err);
            }
        });
    });
}

function bindResend(event) {
    const form = document.getElementById('resend-form');
    document.getElementById('resend-link').addEventListener('click', (e) => {
        e.preventDefault();
        form.classList.toggle('d-none');
        form.email.focus();
    });
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = form.email.value.trim();
        if (!email) return;
        await withBusy(form.querySelector('[type=submit]'), async () => {
            try {
                const res = await api(`/events/${event.event_id}/registrations/resend`, { method: 'POST', body: { email } });
                toast(res.message);
                form.reset();
                form.classList.add('d-none');
            } catch (err) {
                toastError(err);
            }
        });
    });
}

function collect(form, event) {
    const body = { custom_responses: {} };
    for (const field of PROFILE_FIELDS) body[field] = form[field].value.trim();
    body.privacy_consent = form.privacy_consent.checked;
    for (const f of event.custom_fields) {
        const input = form[`cf_${f.field_id}`];
        if (f.field_type === 'checkbox') body.custom_responses[f.field_id] = input.checked;
        else if (input.value.trim() !== '') body.custom_responses[f.field_id] = f.field_type === 'number' ? Number(input.value) : input.value.trim();
    }
    return body;
}

function bindRegister(event) {
    const form = document.getElementById('register-form');
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        clearFormErrors(form);
        await withBusy(form.querySelector('[type=submit]'), async () => {
            try {
                const { registration } = await api(`/events/${event.event_id}/registrations`, { method: 'POST', body: collect(form, event) });
                await renderConfirmation(registration);
            } catch (err) {
                const errors = { ...err.errors };
                for (const [id, message] of Object.entries(errors.custom_responses || {})) errors[`cf_${id}`] = message;
                delete errors.custom_responses;
                showFormErrors(form, { ...err, message: err.message, errors });
                const alert = form.querySelector('.form-alert');
                if (alert) form.querySelector('[type=submit]').before(alert);
                if (err.status === 409) {
                    document.getElementById('resend-form').classList.remove('d-none');
                    document.getElementById('resend-form').email.value = form.email.value;
                }
                form.querySelector('.is-invalid, .form-alert')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        });
    });
}

async function renderConfirmation(registration) {
    const { pass } = await api(`/passes?token=${encodeURIComponent(registration.qr_token)}`);
    app.innerHTML = `
        <div class="text-center mb-4">
            <div class="display-6 text-success"><i class="bi bi-check-circle-fill"></i></div>
            <h1 class="h3 fw-bold mt-2" style="color:var(--paa-green-dark)">You're registered!</h1>
            <p class="text-muted mb-0">${registration.emailed
                ? `We've sent your QR pass to <strong>${esc(registration.email)}</strong>.`
                : "We couldn't send the confirmation email, so please download or save your pass now."}</p>
        </div>
        ${passCard(pass, registration.qr_token)}
        ${passActions(registration.qr_token, { showPassLink: true })}
        <p class="text-center small text-muted mt-3 no-print">Save your pass page link to open your QR code at the venue, even on a slow connection.</p>`;
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

start();
