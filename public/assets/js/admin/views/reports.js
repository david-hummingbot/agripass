import { api } from '../../lib/api.js';
import { emptyState, esc, formatDate, formatDateTime, formatPeso, formatTime } from '../../lib/ui.js';

export async function renderReports(el, event) {
    const { report } = await api(`/events/${event.event_id}/report`);
    const { kpis } = report;
    const base = `/api/events/${event.event_id}`;

    el.innerHTML = `
        <div class="card mb-4">
            <div class="card-body d-flex flex-wrap align-items-center gap-3">
                <div class="me-auto">
                    <div class="fw-semibold">Downloads</div>
                    <div class="small text-muted">Figures as of ${formatDateTime(report.generated_at)}. Use Excel for PRC submissions, since it keeps leading zeros in license numbers.</div>
                </div>
                <a class="btn btn-sm btn-primary" href="${base}/report.pdf" target="_blank" rel="noopener"><i class="bi bi-file-earmark-pdf me-1"></i>Summary PDF</a>
                ${exportGroup('Attendance &amp; CPD', `${base}/exports/attendance`)}
                ${exportGroup('Check-in log', `${base}/exports/checkins`)}
            </div>
        </div>
        <div class="row g-3 mb-4">
            ${kpi('Registered', kpis.registered, `${kpis.cleared} paid or waived`, 'people')}
            ${kpi('Attended', kpis.attended, `${kpis.turnout_pct}% turnout`, 'person-check')}
            ${kpi('CPD eligible', kpis.cpd_eligible, `${kpis.certificates_issued} certificates issued`, 'patch-check')}
            ${kpi('Check-ins', kpis.total_scans, `${kpis.offline_scans} synced from offline`, 'qr-code-scan')}
            ${kpi('Revenue collected', formatPeso(kpis.revenue), `${kpis.payments.Paid} paid registrations`, 'cash-coin')}
            ${kpi('Pending payment', kpis.payments.Pending, `${formatPeso(kpis.outstanding)} outstanding`, 'hourglass-split')}
            ${kpi('Waived', kpis.payments.Waived, 'No fee due', 'gift')}
            ${kpi('Refunded', kpis.payments.Refunded, 'Passes invalid', 'arrow-counterclockwise')}
        </div>
        <div class="row g-4 mb-4">
            <div class="col-xxl-7">${card('Session attendance', sessionsTable(report.sessions), 'Turnout is measured against paid or waived registrants.')}</div>
            <div class="col-xxl-5">${card('Arrivals by hour', arrivals(report.arrivals))}</div>
        </div>
        <div class="row g-4 mb-4">
            <div class="col-xxl-6">${card('Chapter participation', groupTable('Chapter / region', report.chapters))}</div>
            <div class="col-xxl-6"><div class="row g-4">
                <div class="col-lg-6 col-xxl-12">${card('PRC license status', groupTable('License', report.licensed))}</div>
                <div class="col-lg-6 col-xxl-12">${card('PAA membership', groupTable('Membership', report.membership))}</div>
            </div></div>
        </div>
        ${card('Registration form answers', customFields(report.custom_fields))}`;
}

function exportGroup(label, path) {
    return `<div class="btn-group btn-group-sm" role="group" aria-label="${label}">
        <span class="btn btn-light border disabled text-body opacity-100">${label}</span>
        <a class="btn btn-outline-primary" href="${path}.xlsx" download><i class="bi bi-file-earmark-excel me-1"></i>Excel</a>
        <a class="btn btn-outline-primary" href="${path}.csv" download>CSV</a>
    </div>`;
}

function kpi(label, value, sub, icon) {
    return `<div class="col-6 col-lg-3"><div class="card h-100"><div class="card-body">
        <div class="d-flex align-items-center justify-content-between small text-muted mb-1">${label}<i class="bi bi-${icon} text-primary"></i></div>
        <div class="h4 mb-0 fw-bold">${esc(value)}</div>
        <div class="small text-muted">${esc(sub)}</div>
    </div></div></div>`;
}

function card(title, body, help = '') {
    return `<div class="card h-100">
        <div class="card-header bg-white py-3"><h2 class="h6 mb-0 fw-semibold">${title}</h2>${help ? `<div class="small text-muted">${help}</div>` : ''}</div>
        <div class="card-body">${body}</div>
    </div>`;
}

function bar(pct, label = `${pct}%`) {
    return `<div class="d-flex align-items-center gap-2">
        <div class="progress flex-grow-1" style="height:8px" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100">
            <div class="progress-bar" style="width:${pct}%"></div></div>
        <span class="small text-muted text-end" style="min-width:3rem">${label}</span>
    </div>`;
}

function sessionsTable(sessions) {
    if (!sessions.length) return emptyState('clock', 'No sessions', 'Add sessions to track attendance.');
    return `<div class="table-responsive"><table class="table table-sm align-middle mb-0">
        <thead><tr class="small text-muted text-nowrap"><th>Session</th><th class="text-end">Checked in</th><th class="text-end">Offline</th><th style="width:35%">Turnout</th></tr></thead>
        <tbody>${sessions.map((s) => `<tr>
            <td><div class="fw-medium">${esc(s.session_name)}</div>
                <div class="small text-muted">${formatDate(s.session_date)}, ${formatTime(s.start_time)}–${formatTime(s.end_time)}</div></td>
            <td class="text-end">${s.attended}</td>
            <td class="text-end">${s.offline}</td>
            <td>${bar(s.turnout_pct)}</td>
        </tr>`).join('')}</tbody>
    </table></div>`;
}

function arrivals(list) {
    const withScans = list.filter((s) => s.hours.length);
    if (!withScans.length) return '<p class="small text-muted mb-0">No check-ins recorded yet.</p>';
    return withScans.map((s) => {
        const max = Math.max(...s.hours.map((h) => h.count));
        return `<div class="mb-3">
            <div class="small fw-semibold">${esc(s.session_name)} <span class="text-muted fw-normal">· peak ${esc(s.peak.hour)} (${s.peak.count})</span></div>
            ${s.hours.map((h) => `<div class="d-flex align-items-center gap-2 small">
                <span class="text-muted" style="min-width:3rem">${esc(h.hour)}</span>
                <div class="progress flex-grow-1" style="height:8px"><div class="progress-bar" style="width:${Math.round(h.count / max * 100)}%"></div></div>
                <span class="text-end" style="min-width:2rem">${h.count}</span>
            </div>`).join('')}
        </div>`;
    }).join('');
}

function groupTable(heading, rows) {
    if (!rows.length) return '<p class="small text-muted mb-0">No registrations yet.</p>';
    return `<div class="table-responsive"><table class="table table-sm align-middle mb-0">
        <thead><tr class="small text-muted text-nowrap"><th>${heading}</th><th class="text-end">Registered</th><th class="text-end">Attended</th><th style="width:35%">Turnout</th></tr></thead>
        <tbody>${rows.map((r) => `<tr>
            <td class="text-nowrap">${esc(r.label)}</td><td class="text-end">${r.registered}</td><td class="text-end">${r.attended}</td><td>${bar(r.turnout_pct)}</td>
        </tr>`).join('')}</tbody>
    </table></div>`;
}

function customFields(fields) {
    if (!fields.length) return '<p class="small text-muted mb-0">This event has no custom registration questions.</p>';
    return `<div class="row g-4">${fields.map((f) => {
        const max = Math.max(1, ...f.options.map((o) => o.count));
        const summary = [`${f.answered} answered`];
        if (f.type === 'number' && f.average !== null && f.average !== undefined) summary.push(`average ${f.average}`);
        if (f.type === 'text' && f.options.length) summary.push('top answers');
        return `<div class="col-md-6 col-xl-4">
            <div class="fw-semibold small">${esc(f.label)}</div>
            <div class="small text-muted mb-2">${summary.join(' · ')}</div>
            ${f.options.length ? f.options.map((o) => `<div class="d-flex align-items-center gap-2 small mb-1">
                <span class="text-truncate" style="width:40%" title="${esc(o.value)}">${esc(o.value)}</span>
                <div class="progress flex-grow-1" style="height:8px"><div class="progress-bar bg-accent" style="width:${Math.round(o.count / max * 100)}%"></div></div>
                <span class="text-end" style="min-width:2rem">${o.count}</span>
            </div>`).join('') : '<div class="small text-muted">No answers yet.</div>'}
        </div>`;
    }).join('')}</div>`;
}
