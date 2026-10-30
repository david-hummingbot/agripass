import { api } from './api.js';
import { clearFormErrors, esc, formData, showFormErrors, withBusy } from './ui.js';

export const MIN_PASSWORD_LENGTH = 8;

export function passwordFields({ currentLabel = 'Current password' } = {}) {
    return `
        <div class="mb-3">
            <label class="form-label" for="pw-current">${currentLabel}</label>
            <input class="form-control" id="pw-current" name="current_password" type="password" autocomplete="current-password" required>
        </div>
        <div class="mb-3">
            <label class="form-label" for="pw-new">New password</label>
            <input class="form-control" id="pw-new" name="new_password" type="password" autocomplete="new-password" minlength="${MIN_PASSWORD_LENGTH}" required>
            <div class="form-text">At least ${MIN_PASSWORD_LENGTH} characters.</div>
        </div>
        <div class="mb-3">
            <label class="form-label" for="pw-confirm">Confirm new password</label>
            <input class="form-control" id="pw-confirm" name="confirm_password" type="password" autocomplete="new-password" required>
        </div>`;
}

/** Returns the updated user. Throws errors shaped for showFormErrors. */
export async function submitPasswordChange(form) {
    const data = formData(form);
    if (data.new_password !== data.confirm_password) {
        throw Object.assign(new Error('Validation failed.'), { errors: { confirm_password: 'Passwords do not match.' } });
    }
    const { user } = await api('/auth/password', {
        method: 'POST',
        body: { current_password: data.current_password, new_password: data.new_password },
    });
    return user;
}

/** Full-screen "set your own password" step shown after signing in with a temporary password. */
export function renderForcedPasswordChange(root, user, onDone, { onSignOut } = {}) {
    root.innerHTML = `
        <div class="login-screen">
            <div class="card login-card">
                <div class="card-body p-4 p-md-5">
                    <div class="text-center mb-4">
                        <img class="logo mb-3" src="/assets/img/paa-logo.png" alt="Philippine Association of Agriculturists">
                        <h1 class="h5 fw-bold mb-1" style="color: var(--paa-green-dark)">Set your password</h1>
                        <p class="text-muted small mb-0">Hi ${esc(user.full_name.split(' ')[0])}, you signed in with a temporary password. Choose your own to continue.</p>
                    </div>
                    <form id="pw-form" novalidate>
                        ${passwordFields({ currentLabel: 'Temporary password' })}
                        <button class="btn btn-primary w-100 py-2" type="submit">Save password</button>
                        ${onSignOut ? '<button class="btn btn-link w-100 mt-2 text-muted" type="button" id="pw-signout">Sign out</button>' : ''}
                    </form>
                </div>
            </div>
        </div>`;

    const form = root.querySelector('#pw-form');
    form.querySelector('input').focus();
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        clearFormErrors(form);
        await withBusy(form.querySelector('[type=submit]'), async () => {
            try {
                onDone(await submitPasswordChange(form));
            } catch (err) {
                showFormErrors(form, err);
            }
        });
    });
    root.querySelector('#pw-signout')?.addEventListener('click', onSignOut);
}
