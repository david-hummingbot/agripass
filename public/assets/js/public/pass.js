import { api } from '../lib/api.js';
import { esc } from '../lib/ui.js';
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
            ${ended ? '<div class="alert alert-secondary text-center small mx-auto no-print" style="max-width:420px">This event has ended. Thank you for attending!</div>' : ''}
            ${passCard(pass, token)}
            ${passActions(token)}
            <p class="text-center small text-muted mt-3 no-print">Bookmark this page to open your pass at the venue.<br>
                Anyone with this QR code can check in as you, so please don't share it.</p>`;
    } catch (err) {
        app.innerHTML = err.status === 404 ? notFound() : `<div class="alert alert-danger">${esc(err.message)}</div>`;
    }
}

const notFound = () => `
    <div class="card mx-auto text-center" style="max-width:420px"><div class="card-body p-4">
        <i class="bi bi-ticket-perforated fs-1 text-muted"></i>
        <h1 class="h5 mt-2">Pass not found</h1>
        <p class="text-muted small">This link is invalid or incomplete. Open the link from your registration email, or request it again from the registration page.</p>
        <a class="btn btn-primary" href="/">Go to registration</a>
    </div></div>`;

render();
