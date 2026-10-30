export class ApiError extends Error {
    constructor(status, body) {
        super(body?.error || `Request failed (${status})`);
        this.status = status;
        this.errors = body?.errors || {};
    }
}

/**
 * Throws ApiError when the server answered with an error status. Anything else thrown
 * (TypeError, TimeoutError) means the server could not be reached.
 */
export async function api(path, { method = 'GET', body, headers = {}, timeout } = {}) {
    const json = body !== undefined && !(body instanceof FormData);
    const res = await fetch(`/api${path}`, {
        method,
        credentials: 'same-origin',
        headers: {
            Accept: 'application/json',
            ...(json ? { 'Content-Type': 'application/json' } : {}),
            ...headers,
        },
        body: json ? JSON.stringify(body) : body,
        signal: timeout ? AbortSignal.timeout(timeout) : undefined,
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        if (res.status === 401 && path !== '/auth/login' && path !== '/auth/password') {
            window.dispatchEvent(new CustomEvent('agripass:unauthorized'));
        }
        throw new ApiError(res.status, data);
    }

    return data;
}
