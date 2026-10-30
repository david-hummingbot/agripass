import { api } from '../../lib/api.js';
import {
    confirmDialog, emptyState, esc, formatDateTime, openModal, paymentBadge, toast, toastError, withBusy,
} from '../../lib/ui.js';

export async function renderCertificates(el, event, reload) {
    const data = await api(`/events/${event.event_id}/certificates`);
    const { summary, settings, can_issue: blocker } = data;
    const editable = event.status !== 'Archived';
    let filter = 'all';

    el.innerHTML = `
        ${blocker ? `<div class="alert alert-warning small d-flex gap-2"><i class="bi bi-info-circle"></i><div>${esc(blocker)}
            ${event.status === 'Completed' ? ` <a href="#/events/${event.event_id}/edit">Edit event settings</a>` : ''}</div></div>` : ''}
        <div class="row g-3 mb-4">
            ${stat('Registrations', summary.registrations, 'people')}
            ${stat('Eligible', summary.eligible, 'patch-check')}
            ${stat('Issued', summary.issued, 'award')}
            ${stat('Waiting to issue', summary.pending, 'hourglass-split')}
        </div>
        <div class="row g-4 mb-4">
            <div class="col-lg-7">
                <div class="card h-100">
                    <div class="card-header bg-white py-3 d-flex align-items-center justify-content-between">
                        <h2 class="h6 mb-0 fw-semibold">Certificate settings</h2>
                        ${editable ? `<a class="btn btn-sm btn-outline-primary" href="#/events/${event.event_id}/edit"><i class="bi bi-pencil me-1"></i>Edit</a>` : ''}
                    </div>
                    <div class="card-body">
                        <dl class="row mb-0 small">
                            ${row('CPD units', esc(Number(settings.cpd_units)))}
                            ${row('Requirement', `Paid or waived, and at least ${settings.cpd_min_attendance_pct}% of ${event.sessions.length} session(s) attended`)}
                            ${row('PRC accreditation no.', esc(settings.prc_accreditation_no))}
                            ${row('Signatory', settings.signatory_name
                                ? `${esc(settings.signatory_name)}<div class="text-muted">${esc(settings.signatory_title)}</div>`
                                : '<span class="text-danger">Not set</span>')}
                        </dl>
                    </div>
                </div>
            </div>
            <div class="col-lg-5">
                <div class="card h-100">
                    <div class="card-header bg-white py-3"><h2 class="h6 mb-0 fw-semibold">Signature &amp; layout</h2></div>
                    <div class="card-body d-flex flex-column gap-3">
                        <div class="small">${settings.has_signature
                            ? '<i class="bi bi-check-circle-fill text-success me-1"></i>Signature image uploaded.'
                            : '<i class="bi bi-dash-circle text-muted me-1"></i>No signature image. A blank line is printed for wet signing.'}</div>
                        ${editable ? `
                        <form id="signature-form">
                            <label class="form-label small mb-1" for="signature">${settings.has_signature ? 'Replace signature' : 'Upload signature'}</label>
                            <input class="form-control form-control-sm mb-2" type="file" id="signature" name="signature" accept="image/png,image/jpeg" required>
                            <div class="d-flex align-items-center gap-2">
                                <button class="btn btn-sm btn-outline-primary text-nowrap" type="submit"><i class="bi bi-upload me-1"></i>Upload</button>
                                <span class="form-text mt-0">PNG with a transparent background works best. Up to 2 MB.</span>
                            </div>
                        </form>` : ''}
                        <a class="btn btn-sm btn-light border mt-auto align-self-start" href="/api/events/${event.event_id}/certificates/preview" target="_blank" rel="noopener">
                            <i class="bi bi-file-earmark-pdf me-1"></i>Preview sample certificate</a>
                    </div>
                </div>
            </div>
        </div>
        <div class="card">
            <div class="card-header bg-white py-3 d-flex flex-wrap gap-2 align-items-center">
                <select class="form-select form-select-sm" style="max-width:200px" id="cert-filter">
                    <option value="all">All attendees</option>
                    <option value="pending">Waiting to issue</option>
                    <option value="issued">Issued</option>
                    <option value="ineligible">Not eligible</option>
                    <option value="revoked">Revoked</option>
                </select>
                <span class="small text-muted" id="cert-count"></span>
                ${!blocker && summary.pending ? `<button class="btn btn-primary btn-sm ms-auto" id="issue-all">
                    <i class="bi bi-award me-1"></i>Issue &amp; email ${summary.pending} certificate${summary.pending === 1 ? '' : 's'}</button>` : ''}
            </div>
            <div id="cert-table"></div>
        </div>`;

    const matches = (r) => ({
        all: true,
        pending: r.eligible && !r.certificate_id,
        issued: r.certificate_id && !r.revoked_at,
        ineligible: !r.eligible && !r.certificate_id,
        revoked: !!r.revoked_at,
    })[filter];

    const draw = () => {
        const rows = data.certificates.filter(matches);
        document.getElementById('cert-count').textContent = `${rows.length} of ${data.certificates.length}`;
        const table = document.getElementById('cert-table');
        if (!rows.length) {
            table.innerHTML = emptyState('award', data.certificates.length ? 'Nobody matches this filter' : 'No registrations yet');
            return;
        }
        table.innerHTML = `
            <div class="table-responsive">
                <table class="table align-middle mb-0">
                    <thead><tr><th>Attendee</th><th>Payment</th><th class="text-center">Attendance</th><th>Certificate</th><th class="sticky-end"></th></tr></thead>
                    <tbody>${rows.map((r) => `
                        <tr>
                            <td><div class="fw-semibold">${esc(r.last_name)}, ${esc(r.first_name)}</div>
                                <div class="small text-muted">${esc(r.email)}${r.prc_license_number ? ` &middot; PRC ${esc(r.prc_license_number)}` : ''}</div></td>
                            <td>${paymentBadge(r.payment_status)}</td>
                            <td class="text-center text-nowrap">${r.sessions_attended} / ${r.sessions_total}
                                <div class="small text-muted">${r.attendance_pct}%</div></td>
                            <td class="small">${certificateStatus(r)}</td>
                            <td class="text-end sticky-end text-nowrap">${actions(r, blocker)}</td>
                        </tr>`).join('')}
                    </tbody>
                </table>
            </div>`;
    };

    document.getElementById('cert-filter').addEventListener('change', (e) => { filter = e.target.value; draw(); });
    draw();

    document.getElementById('signature-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        await withBusy(e.submitter, async () => {
            try {
                await api(`/events/${event.event_id}/signature`, { method: 'POST', body: new FormData(e.target) });
                toast('Signature uploaded. Preview the certificate to check it.');
                reload();
            } catch (err) {
                toastError(err.errors?.signature ? { message: err.errors.signature } : err);
            }
        });
    });

    document.getElementById('issue-all')?.addEventListener('click', async () => {
        const ok = await confirmDialog({
            title: 'Issue certificates',
            message: `Issue and email certificates to <strong>${summary.pending}</strong> eligible attendee(s)?
                Each receives a PDF with a verification QR code. Issued certificates can be revoked but not edited.`,
            confirmLabel: 'Issue certificates',
        });
        if (ok) await issueAll(event, summary.pending, reload);
    });

    el.addEventListener('click', async (e) => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        const r = data.certificates.find((c) => String(c.registration_id) === btn.dataset.reg);
        const name = `${esc(r.first_name)} ${esc(r.last_name)}`;
        try {
            if (btn.dataset.action === 'issue') {
                await withBusy(btn, () => api(`/events/${event.event_id}/certificates/issue`, { method: 'POST', body: { registration_id: r.registration_id } }));
                toast(`Certificate issued to ${r.first_name} ${r.last_name}.`);
                reload();
            } else if (btn.dataset.action === 'resend') {
                await withBusy(btn, () => api(`/certificates/${r.certificate_id}/resend`, { method: 'POST' }));
                toast(`Certificate emailed to ${r.email}.`);
                reload();
            } else if (btn.dataset.action === 'revoke') {
                revokeModal(r, name, reload);
            }
        } catch (err) {
            toastError(err);
        }
    });
}

async function issueAll(event, total, reload) {
    const progress = openProgress(total);
    let issued = 0;
    let emailed = 0;
    try {
        for (;;) {
            const res = await api(`/events/${event.event_id}/certificates/issue`, { method: 'POST', body: {} });
            issued += res.issued;
            emailed += res.emailed;
            progress.update(issued);
            if (!res.remaining || !res.issued) break;
        }
        const notEmailed = issued - emailed;
        toast(`${issued} certificate(s) issued.${notEmailed ? ` ${notEmailed} could not be emailed; use Resend.` : ''}`, notEmailed ? 'warning' : 'success');
    } catch (err) {
        toastError(err);
    } finally {
        progress.close();
        reload();
    }
}

function openProgress(total) {
    const el = document.createElement('div');
    el.className = 'modal-backdrop show d-flex align-items-center justify-content-center';
    el.style.zIndex = 2000;
    el.innerHTML = `
        <div class="card shadow" style="width:min(420px,90vw)">
            <div class="card-body">
                <div class="fw-semibold mb-2"><span class="spinner-border spinner-border-sm text-primary me-2"></span>Issuing certificates…</div>
                <div class="progress mb-2" role="progressbar"><div class="progress-bar" style="width:0%"></div></div>
                <div class="small text-muted" data-count>0 of ${total}</div>
            </div>
        </div>`;
    document.body.append(el);
    return {
        update(done) {
            el.querySelector('.progress-bar').style.width = `${Math.min(100, (done / total) * 100)}%`;
            el.querySelector('[data-count]').textContent = `${done} of ${total}`;
        },
        close: () => el.remove(),
    };
}

function revokeModal(r, name, reload) {
    openModal({
        title: 'Revoke certificate',
        submitLabel: 'Revoke certificate',
        submitClass: 'btn-danger',
        body: `
            <p class="small">Revoke certificate <strong>${esc(r.certificate_no)}</strong> for <strong>${name}</strong>?
                Verification will show it as revoked and the attendee can no longer download it. This cannot be undone.</p>
            <label class="form-label" for="reason">Reason</label>
            <textarea class="form-control" id="reason" name="reason" rows="2" maxlength="255" required
                      placeholder="e.g. Attendance record was found to be incorrect"></textarea>`,
        onSubmit: async (form) => {
            await api(`/certificates/${r.certificate_id}/revoke`, { method: 'POST', body: { reason: form.reason.value.trim() } });
            toast('Certificate revoked.');
            reload();
        },
    });
}

function certificateStatus(r) {
    if (r.revoked_at) {
        return `<span class="badge text-bg-danger">Revoked</span> <span class="text-muted text-nowrap">${esc(r.certificate_no)}</span>
            <div class="text-muted">${esc(r.revoked_reason)}</div>`;
    }
    if (r.certificate_id) {
        return `<span class="badge text-bg-success">Issued</span> <span class="text-muted text-nowrap">${esc(r.certificate_no)}</span>
            <div class="text-muted">${r.emailed_at ? `<i class="bi bi-envelope-check me-1"></i>Emailed ${formatDateTime(r.emailed_at)}` : '<i class="bi bi-envelope-x me-1"></i>Not emailed yet'}</div>`;
    }
    if (r.eligible) return '<span class="badge text-bg-primary">Eligible</span> <span class="text-muted">Not issued yet</span>';
    return `<span class="badge text-bg-light border">Not eligible</span><div class="text-muted">${esc(r.reason)}</div>`;
}

function actions(r, blocker) {
    if (r.certificate_id && !r.revoked_at) {
        return `<a class="btn btn-sm btn-outline-secondary" href="/api/certificates/${r.certificate_id}/pdf" target="_blank" rel="noopener" title="View PDF"><i class="bi bi-file-earmark-pdf"></i></a>
            <button class="btn btn-sm btn-outline-primary" data-action="resend" data-reg="${r.registration_id}" title="Email again"><i class="bi bi-envelope"></i></button>
            <button class="btn btn-sm btn-outline-danger" data-action="revoke" data-reg="${r.registration_id}" title="Revoke"><i class="bi bi-x-octagon"></i></button>`;
    }
    if (r.eligible && !r.certificate_id && !blocker) {
        return `<button class="btn btn-sm btn-outline-primary" data-action="issue" data-reg="${r.registration_id}"><i class="bi bi-award me-1"></i>Issue</button>`;
    }
    return '';
}

function stat(label, value, icon) {
    return `<div class="col-6 col-md-3"><div class="card h-100"><div class="card-body d-flex align-items-center gap-3">
        <i class="bi bi-${icon} fs-3 text-primary"></i><div><div class="h4 mb-0 fw-bold">${value}</div><div class="small text-muted">${label}</div></div>
    </div></div></div>`;
}

function row(label, value) {
    return `<dt class="col-sm-5 text-muted fw-normal">${label}</dt><dd class="col-sm-7">${value || '<span class="text-muted">—</span>'}</dd>`;
}
