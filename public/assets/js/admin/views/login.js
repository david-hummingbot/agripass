import { api } from '../../lib/api.js';
import { clearFormErrors, formData, showFormErrors, withBusy } from '../../lib/ui.js';

export function renderLogin(onSuccess) {
    document.getElementById('app-loading')?.remove();
    document.getElementById('root').innerHTML = `
        <div class="login-screen">
            <div class="card login-card">
                <div class="card-body p-4 p-md-5">
                    <div class="text-center mb-4">
                        <img class="logo mb-3" src="/assets/img/paa-logo.png" alt="Philippine Association of Agriculturists">
                        <h1 class="h4 fw-bold mb-1" style="color: var(--paa-green-dark)">AgriPass Admin</h1>
                        <p class="text-muted small mb-0">Event registration &amp; QR check-in</p>
                    </div>
                    <form id="login-form" novalidate>
                        <div class="mb-3">
                            <label class="form-label" for="email">Email</label>
                            <input class="form-control" id="email" name="email" type="email" autocomplete="username" required autofocus>
                        </div>
                        <div class="mb-4">
                            <label class="form-label" for="password">Password</label>
                            <input class="form-control" id="password" name="password" type="password" autocomplete="current-password" required>
                        </div>
                        <button class="btn btn-primary w-100 py-2" type="submit">Sign in</button>
                    </form>
                </div>
            </div>
        </div>`;

    const form = document.getElementById('login-form');
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        clearFormErrors(form);
        await withBusy(form.querySelector('[type=submit]'), async () => {
            try {
                await api('/auth/login', { method: 'POST', body: formData(form) });
                onSuccess();
            } catch (err) {
                showFormErrors(form, err);
            }
        });
    });
}
