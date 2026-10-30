import { api } from '../../lib/api.js';
import { clearFormErrors, esc, formData, showFormErrors, toast, withBusy } from '../../lib/ui.js';
import { isAdmin, loadEvents } from '../state.js';

const TYPES = ['Convention', 'General Assembly', 'Seminar', 'Workshop', 'Field Demo'];

export async function renderEventForm(eventId = null) {
    const view = document.getElementById('view');
    if (!isAdmin()) {
        view.innerHTML = '<div class="alert alert-warning">Only administrators can create or edit events.</div>';
        return;
    }

    const event = eventId ? (await api(`/events/${eventId}`)).event : {};
    if (event.status === 'Archived') {
        view.innerHTML = `<div class="alert alert-warning">Archived events are locked. <a href="#/events/${eventId}">Back to event</a></div>`;
        return;
    }
    const v = (key, fallback = '') => esc(event[key] ?? fallback);
    const back = eventId ? `#/events/${eventId}` : '#/events';

    view.innerHTML = `
        <nav aria-label="breadcrumb"><ol class="breadcrumb small mb-2">
            <li class="breadcrumb-item"><a href="#/events">Events</a></li>
            ${eventId ? `<li class="breadcrumb-item"><a href="${back}">${v('title')}</a></li>` : ''}
            <li class="breadcrumb-item active">${eventId ? 'Edit' : 'New event'}</li>
        </ol></nav>
        <h1 class="h3 page-title mb-4">${eventId ? 'Edit event' : 'Create a new event'}</h1>

        <form id="event-form" novalidate>
            <div class="row g-4">
                <div class="col-lg-8">
                    <div class="card mb-4">
                        <div class="card-header bg-white py-3"><h2 class="h6 mb-0 fw-semibold">Event details</h2></div>
                        <div class="card-body row g-3">
                            <div class="col-12">
                                <label class="form-label" for="title">Event title <span class="text-danger">*</span></label>
                                <input class="form-control" id="title" name="title" value="${v('title')}" maxlength="150" required
                                       placeholder="e.g. PAA National Convention 2026">
                            </div>
                            <div class="col-md-6">
                                <label class="form-label" for="event_type">Event type <span class="text-danger">*</span></label>
                                <select class="form-select" id="event_type" name="event_type" required>
                                    ${TYPES.map((t) => `<option ${event.event_type === t ? 'selected' : ''}>${t}</option>`).join('')}
                                </select>
                            </div>
                            <div class="col-md-6">
                                <label class="form-label" for="venue">Venue <span class="text-danger">*</span></label>
                                <input class="form-control" id="venue" name="venue" value="${v('venue')}" maxlength="255" required>
                            </div>
                            <div class="col-md-6">
                                <label class="form-label" for="start_date">Start date <span class="text-danger">*</span></label>
                                <input class="form-control" type="date" id="start_date" name="start_date" value="${v('start_date')}" required>
                            </div>
                            <div class="col-md-6">
                                <label class="form-label" for="end_date">End date <span class="text-danger">*</span></label>
                                <input class="form-control" type="date" id="end_date" name="end_date" value="${v('end_date')}" required>
                            </div>
                            <div class="col-12">
                                <label class="form-label" for="description">Description</label>
                                <textarea class="form-control" id="description" name="description" rows="4">${v('description')}</textarea>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="col-lg-4">
                    <div class="card mb-4">
                        <div class="card-header bg-white py-3"><h2 class="h6 mb-0 fw-semibold">Registration fee</h2></div>
                        <div class="card-body">
                            <label class="form-label" for="registration_fee">Fee</label>
                            <div class="input-group">
                                <span class="input-group-text">₱</span>
                                <input class="form-control" type="number" min="0" step="0.01" id="registration_fee" name="registration_fee" value="${v('registration_fee', '0.00')}">
                            </div>
                            <div class="form-text">Set to 0 for free events. Free registrations are marked as Waived automatically.</div>
                        </div>
                    </div>
                    <div class="card mb-4">
                        <div class="card-header bg-white py-3"><h2 class="h6 mb-0 fw-semibold">CPD &amp; PRC compliance</h2></div>
                        <div class="card-body row g-3">
                            <div class="col-12">
                                <label class="form-label" for="cpd_units">CPD units</label>
                                <input class="form-control" type="number" min="0" step="0.25" id="cpd_units" name="cpd_units" value="${v('cpd_units', '0')}">
                            </div>
                            <div class="col-12">
                                <label class="form-label" for="cpd_min_attendance_pct">Minimum attendance for certificate</label>
                                <div class="input-group">
                                    <input class="form-control" type="number" min="0" max="100" id="cpd_min_attendance_pct" name="cpd_min_attendance_pct" value="${v('cpd_min_attendance_pct', '80')}">
                                    <span class="input-group-text">% of sessions</span>
                                </div>
                            </div>
                            <div class="col-12">
                                <label class="form-label" for="prc_accreditation_no">PRC accreditation no.</label>
                                <input class="form-control" id="prc_accreditation_no" name="prc_accreditation_no" value="${v('prc_accreditation_no')}" maxlength="100">
                            </div>
                        </div>
                    </div>
                    <div class="card mb-4">
                        <div class="card-header bg-white py-3"><h2 class="h6 mb-0 fw-semibold">Certificate signatory</h2></div>
                        <div class="card-body row g-3">
                            <div class="col-12">
                                <label class="form-label" for="cert_signatory_name">Name</label>
                                <input class="form-control" id="cert_signatory_name" name="cert_signatory_name" value="${v('cert_signatory_name')}" maxlength="100"
                                       placeholder="e.g. Dr. Ramon C. Bautista">
                            </div>
                            <div class="col-12">
                                <label class="form-label" for="cert_signatory_title">Position</label>
                                <input class="form-control" id="cert_signatory_title" name="cert_signatory_title" value="${v('cert_signatory_title')}" maxlength="150"
                                       placeholder="e.g. National President, PAA">
                            </div>
                            <div class="col-12 form-text mt-2">Printed on CPD certificates. Upload the signature image from the event's Certificates tab.</div>
                        </div>
                    </div>
                </div>
            </div>
            <div class="d-flex gap-2 justify-content-end border-top pt-3">
                <a class="btn btn-light" href="${back}">Cancel</a>
                <button class="btn btn-primary px-4" type="submit">${eventId ? 'Save changes' : 'Create event'}</button>
            </div>
        </form>`;

    const form = document.getElementById('event-form');
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        clearFormErrors(form);
        await withBusy(form.querySelector('[type=submit]'), async () => {
            try {
                const body = formData(form);
                const res = eventId
                    ? await api(`/events/${eventId}`, { method: 'PUT', body })
                    : await api('/events', { method: 'POST', body });
                await loadEvents();
                toast(eventId ? 'Event updated.' : 'Event created. Add sessions next.');
                location.hash = eventId ? `#/events/${eventId}` : `#/events/${res.event.event_id}/sessions`;
            } catch (err) {
                showFormErrors(form, err);
                form.querySelector('.is-invalid, .form-alert')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        });
    });
}
