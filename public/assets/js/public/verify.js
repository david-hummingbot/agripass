import { api } from '../lib/api.js';
import { esc, formatDate, formatDateRange } from '../lib/ui.js';

const form = document.getElementById('verify-form');
const input = document.getElementById('code');
const result = document.getElementById('result');

async function verify(code) {
    code = code.replace(/[^0-9a-f]/gi, '').toUpperCase();
    input.value = code;
    if (code.length !== 16) {
        result.innerHTML = '<div class="alert alert-warning small">Verification codes are 16 characters (letters A–F and numbers).</div>';
        return;
    }
    history.replaceState(null, '', `?code=${code}`);
    result.innerHTML = '<div class="text-center py-4"><div class="spinner-border text-success" role="status"></div></div>';
    try {
        const { certificate } = await api(`/certificates/verify?code=${code}`);
        result.innerHTML = details(certificate);
    } catch (err) {
        result.innerHTML = err.status === 404
            ? `<div class="alert alert-danger"><i class="bi bi-x-circle-fill me-1"></i><strong>Not found.</strong>
                No certificate matches this code. Check the code for typos; if it still fails, the certificate may not be genuine.</div>`
            : `<div class="alert alert-danger">${esc(err.message || 'Could not reach the server. Try again.')}</div>`;
    }
}

function details(c) {
    const valid = c.status === 'valid';
    const row = (label, value) => `<dt class="col-sm-5 text-muted fw-normal">${label}</dt><dd class="col-sm-7">${value || '—'}</dd>`;
    return `
        <div class="card ${valid ? 'border-success' : 'border-danger'}">
            <div class="card-header py-3 ${valid ? 'text-bg-success' : 'text-bg-danger'}">
                <i class="bi ${valid ? 'bi-patch-check-fill' : 'bi-x-octagon-fill'} me-1"></i>
                <strong>${valid ? 'Valid certificate' : 'This certificate has been revoked'}</strong>
                ${valid ? '' : `<div class="small">Revoked ${formatDate(c.revoked_at)}. It should not be accepted for CPD credit.</div>`}
            </div>
            <div class="card-body">
                <dl class="row mb-0 small">
                    ${row('Attendee', `<strong>${esc(c.attendee_name)}</strong>`)}
                    ${row('PRC license no.', esc(c.prc_license_number))}
                    ${row('Event', esc(c.event_title))}
                    ${row('Venue', esc(c.event_venue))}
                    ${row('Dates', formatDateRange(c.event_start_date, c.event_end_date))}
                    ${row('Sessions attended', `${c.sessions_attended} of ${c.sessions_total}`)}
                    ${row('CPD units', esc(Number(c.cpd_units)))}
                    ${row('PRC accreditation no.', esc(c.prc_accreditation_no))}
                    ${row('Certificate no.', esc(c.certificate_no))}
                    ${row('Issued', formatDate(c.issued_at))}
                </dl>
            </div>
        </div>
        <p class="small text-muted text-center mt-3">Compare these details with the printed certificate. They must match exactly.</p>`;
}

form.addEventListener('submit', (e) => {
    e.preventDefault();
    verify(input.value);
});

const initial = new URLSearchParams(location.search).get('code');
if (initial) verify(initial);
