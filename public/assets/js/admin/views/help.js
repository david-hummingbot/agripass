import { api } from '../../lib/api.js';
import { esc } from '../../lib/ui.js';
import { isAdmin } from '../state.js';

let cache = null;

async function topics() {
    cache ??= (await api('/help')).topics.map((t) => ({ ...t, text: textOf(t) }));
    return cache;
}

function textOf(topic) {
    const div = document.createElement('div');
    div.innerHTML = topic.html;
    return `${topic.title} ${topic.summary} ${div.textContent}`.toLowerCase().replace(/\s+/g, ' ');
}

function downloads() {
    return `<div class="d-flex flex-wrap gap-2">
        ${isAdmin() ? '<a class="btn btn-primary" href="/api/help/guide.pdf" target="_blank" rel="noopener"><i class="bi bi-file-earmark-pdf me-1"></i>Staff guide (PDF)</a>' : ''}
        <a class="btn ${isAdmin() ? 'btn-outline-primary' : 'btn-primary'}" href="/api/help/guide.pdf?audience=staff" target="_blank" rel="noopener">
            <i class="bi bi-printer me-1"></i>Gate staff handout (PDF)</a>
    </div>`;
}

export async function renderHelp(slug) {
    const list = await topics();
    const topic = slug ? list.find((t) => t.slug === slug) : null;
    if (slug && !topic) throw new Error('Help topic not found.');
    return topic ? renderTopic(list, topic) : renderIndex(list);
}

function renderIndex(list) {
    const view = document.getElementById('view');
    view.innerHTML = `
        <div class="d-flex flex-wrap gap-3 align-items-start justify-content-between mb-4">
            <div>
                <h1 class="h3 page-title">Help</h1>
                <p class="text-muted small mb-0">How to run events, check attendees in and handle common questions.${isAdmin()
                    ? ' Print the gate staff handout for event-day volunteers.' : ''}</p>
            </div>
            ${downloads()}
        </div>
        <input type="search" class="form-control mb-4" style="max-width:420px" id="help-search" placeholder="Search help, e.g. offline, refund, certificate…" aria-label="Search help">
        <div class="row g-3" id="help-topics"></div>`;

    const grid = document.getElementById('help-topics');
    const draw = (query) => {
        const words = query.toLowerCase().split(/\s+/).filter(Boolean);
        const matches = list.filter((t) => words.every((w) => t.text.includes(w)));
        grid.innerHTML = matches.map((t) => `
            <div class="col-md-6 col-xl-4">
                <a class="card h-100 text-decoration-none help-card" href="#/help/${t.slug}">
                    <div class="card-body d-flex gap-3">
                        <i class="bi bi-${t.icon} fs-3 text-primary"></i>
                        <div><div class="fw-semibold text-body">${esc(t.title)}</div><div class="small text-muted">${esc(t.summary)}</div></div>
                    </div>
                </a>
            </div>`).join('') || '<div class="col-12 text-muted small">No help topics match. Try a different word.</div>';
    };
    const search = document.getElementById('help-search');
    search.addEventListener('input', () => draw(search.value));
    draw('');
}

function renderTopic(list, topic) {
    const view = document.getElementById('view');
    const index = list.indexOf(topic);
    const prev = list[index - 1];
    const next = list[index + 1];

    view.innerHTML = `
        <nav aria-label="breadcrumb"><ol class="breadcrumb small mb-2">
            <li class="breadcrumb-item"><a href="#/help">Help</a></li>
            <li class="breadcrumb-item active">${esc(topic.title)}</li>
        </ol></nav>
        <div class="row g-4">
            <div class="col-lg-3 order-lg-2">
                <div class="list-group help-nav">
                    ${list.map((t) => `<a class="list-group-item list-group-item-action d-flex gap-2 align-items-center ${t === topic ? 'active' : ''}" href="#/help/${t.slug}">
                        <i class="bi bi-${t.icon}"></i><span>${esc(t.title)}</span></a>`).join('')}
                </div>
                <div class="mt-3">${downloads().replace('d-flex flex-wrap gap-2', 'd-grid gap-2')}</div>
            </div>
            <div class="col-lg-9 order-lg-1">
                <div class="card"><div class="card-body p-4">
                    <h1 class="h3 page-title d-flex align-items-center gap-2 mb-3"><i class="bi bi-${topic.icon} text-primary"></i>${esc(topic.title)}</h1>
                    <div class="help-content">${topic.html}</div>
                </div></div>
                <div class="d-flex justify-content-between mt-3">
                    ${prev ? `<a class="btn btn-light border" href="#/help/${prev.slug}"><i class="bi bi-arrow-left me-1"></i>${esc(prev.title)}</a>` : '<span></span>'}
                    ${next ? `<a class="btn btn-light border" href="#/help/${next.slug}">${esc(next.title)}<i class="bi bi-arrow-right ms-1"></i></a>` : ''}
                </div>
            </div>
        </div>`;
}
