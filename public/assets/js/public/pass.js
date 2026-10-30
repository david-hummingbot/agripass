import { api } from '../lib/api.js';
import { esc, formatDate } from '../lib/ui.js';
import { passActions, passCard } from './pass-card.js';

const app = document.getElementById('app');
const token = new URLSearchParams(location.search).get('token') || '';

async function render() {
    if (!token) {
        app.innerHTML = notFound();
        return;
    }
    try {
        const { pass } = await api(`/passes?token=${encodeURIComponent(token)}`);
        document.title = `My AgriPass · ${pass.title}`;
        const ended = ['Completed', 'Archived'].includes(pass.event_status);
        app.innerHTML = `
            ${ended && !pass.certificate ? '<div class="alert alert-secondary text-center small mx-auto no-print" style="max-width:420px">This event has ended. Thank you for attending!</div>' : ''}
            ${pass.certificate ? certificateBanner(pass.certificate) : ''}
            ${passCard(pass, token)}
            ${passActions(token)}
            <p class="text-center small text-muted mt-3 no-print">Bookmark this page to open your pass at the venue.<br>
                Anyone with this QR code can check in as you, so please don't share it.</p>`;
    } catch (err) {
        app.innerHTML = err.status === 404 ? notFound() : `<div class="alert alert-danger">${esc(err.message)}</div>`;
    }
}

const certificateBanner = (certificate) => `
    <div class="card mx-auto mb-4 no-print border-success" style="max-width:420px"><div class="card-body d-flex gap-3 align-items-center">
        <i class="bi bi-award-fill fs-1 text-success"></i>
        <div class="flex-grow-1">
            <div class="fw-semibold">Your CPD certificate is ready</div>
            <div class="small text-muted">No. ${esc(certificate.certificate_no)} &middot; issued ${formatDate(certificate.issued_at)}</div>
            <a class="btn btn-success btn-sm mt-2" href="/api/certificates/download?token=${encodeURIComponent(token)}">
                <i class="bi bi-download me-1"></i>Download certificate (PDF)</a>
        </div>
    </div></div>`;

const notFound = () => `
    <div class="card mx-auto text-center" style="max-width:420px"><div class="card-body p-4">
        <i class="bi bi-ticket-perforated fs-1 text-muted"></i>
        <h1 class="h5 mt-2">Pass not found</h1>
        <p class="text-muted small">This link is invalid or incomplete. Open the link from your registration email, or request it again from the registration page.</p>
        <a class="btn btn-primary" href="/">Go to registration</a>
    </div></div>`;

render();
