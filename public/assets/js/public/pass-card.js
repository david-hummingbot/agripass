import { esc, formatDate, formatDateRange, formatDateTime, formatPeso, formatTime, paymentBadge } from '../lib/ui.js';

const qrUrl = (token, extra = '') => `/api/passes/qr?token=${encodeURIComponent(token)}${extra}`;
export const passPageUrl = (token) => `/pass/?token=${encodeURIComponent(token)}`;

function paymentNotice(pass, amountDue) {
    const seeYou = ['Completed', 'Archived'].includes(pass.event_status) ? '' : ' See you at the event!';
    switch (pass.payment_status) {
        case 'Paid':
            return `<div class="alert alert-success small mb-0"><i class="bi bi-check-circle-fill me-1"></i>Payment confirmed.${seeYou}</div>`;
        case 'Waived':
            return `<div class="alert alert-success small mb-0"><i class="bi bi-check-circle-fill me-1"></i>No payment required.${seeYou}</div>`;
        case 'Refunded':
            return '<div class="alert alert-danger small mb-0"><i class="bi bi-x-circle-fill me-1"></i>This registration was refunded and the pass is no longer valid.</div>';
        default:
            return `<div class="alert alert-warning small mb-0"><i class="bi bi-hourglass-split me-1"></i>
                <strong>Payment pending${amountDue ? ` (${formatPeso(amountDue)})` : ''}.</strong>
                Your pass will be accepted at the entrance once your payment is verified by PAA.
                Please bring your proof of payment.</div>`;
    }
}

export function passCard(pass, token, { amountDue = Number(pass.registration_fee) } = {}) {
    const checkedIn = pass.sessions.filter((s) => s.check_in_time).length;

    return `
        <div class="pass-card">
            <div class="pass-head d-flex gap-3 align-items-center">
                <img src="/assets/img/paa-logo-yellow.png" alt="">
                <div>
                    <div class="pass-event">${esc(pass.title)}</div>
                    <div class="small opacity-75">${esc(pass.venue)}</div>
                    <div class="small opacity-75">${formatDateRange(pass.start_date, pass.end_date)}</div>
                </div>
            </div>
            <div class="pass-qr ${pass.payment_status === 'Refunded' ? 'blocked' : ''}">
                <img src="${qrUrl(token)}" alt="Your QR pass">
                <div class="small text-muted">Show this QR code at the entrance of every session.</div>
            </div>
            <div class="pass-divider"></div>
            <div class="pass-body">
                <div class="label">Attendee</div>
                <div class="pass-name mb-2">${esc(pass.first_name)} ${esc(pass.last_name)}</div>
                <div class="row g-2 mb-3 small">
                    ${pass.chapter_region ? `<div class="col-6"><div class="label">Chapter</div>${esc(pass.chapter_region)}</div>` : ''}
                    ${pass.prc_license_number ? `<div class="col-6"><div class="label">PRC license</div>${esc(pass.prc_license_number)}</div>` : ''}
                    <div class="col-6"><div class="label">Payment</div>${paymentBadge(pass.payment_status)}</div>
                    ${Number(pass.cpd_units) > 0 ? `<div class="col-6"><div class="label">CPD units</div>${esc(Number(pass.cpd_units))}</div>` : ''}
                </div>
                ${paymentNotice(pass, amountDue)}
                ${pass.sessions.length ? `
                <div class="mt-3">
                    <div class="label mb-1">Sessions &middot; ${checkedIn} of ${pass.sessions.length} attended</div>
                    ${pass.sessions.map((s) => `
                    <div class="session-row small">
                        <i class="bi ${s.check_in_time ? 'bi-check-circle-fill' : 'bi-circle text-muted'}"></i>
                        <div class="flex-grow-1">
                            <div class="fw-semibold">${esc(s.session_name)}</div>
                            <div class="text-muted">${formatDate(s.session_date, { weekday: 'short', month: 'short', day: 'numeric' })},
                                ${formatTime(s.start_time)} – ${formatTime(s.end_time)}</div>
                        </div>
                        ${s.check_in_time ? `<span class="text-success text-nowrap">${formatDateTime(s.check_in_time)}</span>` : ''}
                    </div>`).join('')}
                </div>` : ''}
            </div>
        </div>`;
}

export function passActions(token, { showPassLink = false } = {}) {
    return `
        <div class="d-flex flex-wrap gap-2 justify-content-center mt-4 no-print">
            <a class="btn btn-primary" href="${qrUrl(token, '&format=png&download=1')}"><i class="bi bi-download me-1"></i>Download QR</a>
            ${showPassLink ? `<a class="btn btn-outline-primary" href="${passPageUrl(token)}"><i class="bi bi-ticket-perforated me-1"></i>Open my pass page</a>` : ''}
            <button class="btn btn-outline-primary" type="button" onclick="window.print()"><i class="bi bi-printer me-1"></i>Print</button>
        </div>`;
}
