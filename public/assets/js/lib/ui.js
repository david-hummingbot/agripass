const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]);

const peso = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' });
export const formatPeso = (value) => peso.format(Number(value || 0));

export function formatDate(value, opts = { month: 'short', day: 'numeric', year: 'numeric' }) {
    if (!value) return '';
    const date = new Date(value.length === 10 ? `${value}T00:00:00` : value.replace(' ', 'T'));
    return date.toLocaleDateString('en-PH', opts);
}

export function formatDateRange(start, end) {
    return start === end ? formatDate(start) : `${formatDate(start)} – ${formatDate(end)}`;
}

export function formatDateTime(value) {
    if (!value) return '';
    return new Date(value.replace(' ', 'T')).toLocaleString('en-PH', {
        month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    });
}

export const formatTime = (value) => {
    const [h, m] = String(value).split(':').map(Number);
    return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};

export const statusBadge = (status) => `<span class="badge badge-status status-${esc(status)}">${esc(status)}</span>`;
export const paymentBadge = (status) => `<span class="badge badge-status pay-${esc(status)}">${esc(status)}</span>`;

export function toast(message, variant = 'success') {
    const icon = variant === 'success' ? 'check-circle-fill' : 'exclamation-triangle-fill';
    const el = document.createElement('div');
    el.className = `toast align-items-center text-bg-${variant} border-0`;
    el.setAttribute('role', 'status');
    el.innerHTML = `<div class="d-flex"><div class="toast-body"><i class="bi bi-${icon} me-2"></i>${esc(message)}</div>
        <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button></div>`;
    document.getElementById('toasts').append(el);
    el.addEventListener('hidden.bs.toast', () => el.remove());
    new bootstrap.Toast(el, { delay: 4000 }).show();
}

export const toastError = (err) => toast(err.message || 'Something went wrong.', 'danger');

const modalEl = () => document.getElementById('app-modal');

/** Opens the shared modal. `onSubmit` receives the form and should throw to keep the modal open. */
export function openModal({ title, body, submitLabel = 'Save', submitClass = 'btn-primary', onSubmit, size = '' }) {
    const el = modalEl();
    el.querySelector('.modal-dialog').className = `modal-dialog modal-dialog-centered ${size}`;
    el.querySelector('.modal-content').innerHTML = `
        <form novalidate>
            <div class="modal-header">
                <h5 class="modal-title">${esc(title)}</h5>
                <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
            </div>
            <div class="modal-body">${body}</div>
            <div class="modal-footer">
                <button type="button" class="btn btn-light" data-bs-dismiss="modal">Cancel</button>
                <button type="submit" class="btn ${submitClass}">${esc(submitLabel)}</button>
            </div>
        </form>`;

    const modal = bootstrap.Modal.getOrCreateInstance(el);
    const form = el.querySelector('form');
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const button = form.querySelector('[type=submit]');
        clearFormErrors(form);
        await withBusy(button, async () => {
            try {
                await onSubmit(form);
                modal.hide();
            } catch (err) {
                showFormErrors(form, err);
            }
        });
    });
    modal.show();
    return form;
}

export function confirmDialog({ title, message, confirmLabel = 'Confirm', confirmClass = 'btn-primary' }) {
    return new Promise((resolve) => {
        let confirmed = false;
        openModal({
            title,
            body: `<p class="mb-0">${message}</p>`,
            submitLabel: confirmLabel,
            submitClass: confirmClass,
            onSubmit: () => { confirmed = true; },
        });
        modalEl().addEventListener('hidden.bs.modal', () => resolve(confirmed), { once: true });
    });
}

export async function withBusy(button, fn) {
    const original = button.innerHTML;
    button.disabled = true;
    button.innerHTML = `<span class="spinner-border spinner-border-sm me-1" aria-hidden="true"></span>${original}`;
    try {
        return await fn();
    } finally {
        button.disabled = false;
        button.innerHTML = original;
    }
}

export function formData(form) {
    const data = {};
    for (const el of form.elements) {
        if (!el.name) continue;
        if (el.type === 'checkbox') data[el.name] = el.checked;
        else data[el.name] = el.value.trim();
    }
    return data;
}

export function clearFormErrors(form) {
    form.querySelectorAll('.is-invalid').forEach((el) => el.classList.remove('is-invalid'));
    form.querySelectorAll('.invalid-feedback[data-generated], .form-alert').forEach((el) => el.remove());
}

export function showFormErrors(form, err) {
    let unmatched = err.message;
    for (const [field, message] of Object.entries(err.errors || {})) {
        const input = form.querySelector(`[name="${field}"]`);
        if (!input || typeof message !== 'string') continue;
        input.classList.add('is-invalid');
        const feedback = document.createElement('div');
        feedback.className = 'invalid-feedback d-block';
        feedback.dataset.generated = '';
        feedback.textContent = message;
        (input.closest('.input-group') || input).after(feedback);
        unmatched = null;
    }
    if (unmatched) {
        const alert = document.createElement('div');
        alert.className = 'alert alert-danger form-alert py-2';
        alert.textContent = unmatched;
        (form.querySelector('.modal-body') || form).prepend(alert);
    }
}

export function emptyState(icon, title, text = '', action = '') {
    return `<div class="empty-state"><i class="bi bi-${icon}"></i><h6 class="mt-3 mb-1 text-body">${esc(title)}</h6>
        <p class="small mb-3">${esc(text)}</p>${action}</div>`;
}
