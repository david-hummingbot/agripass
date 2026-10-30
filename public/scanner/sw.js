// Bump when the shell file list changes so old caches are dropped.
const CACHE = 'agripass-scanner-v3';

const SHELL = [
    '/scanner/',
    '/scanner/manifest.webmanifest',
    '/assets/vendor/bootstrap/bootstrap.min.css',
    '/assets/vendor/bootstrap/bootstrap.bundle.min.js',
    '/assets/vendor/bootstrap-icons/bootstrap-icons.min.css',
    '/assets/vendor/bootstrap-icons/fonts/bootstrap-icons.woff2',
    '/assets/vendor/bootstrap-icons/fonts/bootstrap-icons.woff',
    '/assets/vendor/html5-qrcode/html5-qrcode.min.js',
    '/assets/css/theme.css',
    '/assets/css/scanner.css',
    '/assets/img/paa-logo.png',
    '/assets/img/paa-logo-yellow.png',
    '/assets/img/icons/scanner-192.png',
    '/assets/img/icons/scanner-512.png',
    '/assets/js/lib/api.js',
    '/assets/js/lib/ui.js',
    '/assets/js/lib/password.js',
    '/assets/js/scanner/app.js',
    '/assets/js/scanner/store.js',
    '/assets/js/scanner/checkin.js',
    '/assets/js/scanner/camera.js',
    '/assets/js/scanner/feedback.js',
];

self.addEventListener('install', (event) => {
    event.waitUntil(caches.open(CACHE)
        .then((cache) => cache.addAll(SHELL.map((url) => new Request(url, { cache: 'reload' }))))
        .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
            .then(() => self.clients.claim()),
    );
});

// Stale-while-revalidate for the app shell: open instantly (and offline), refresh the cache in the background.
// API calls are never cached; the scanner keeps its roster and queue in IndexedDB instead.
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);
    if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) {
        return;
    }
    const key = event.request.mode === 'navigate' ? '/scanner/' : url.pathname;

    event.respondWith(caches.open(CACHE).then(async (cache) => {
        const cached = await cache.match(key);
        const network = fetch(event.request)
            .then((response) => {
                if (response.ok) cache.put(key, response.clone());
                return response;
            })
            .catch(() => cached || Response.error());
        if (cached) {
            event.waitUntil(network.catch(() => {}));
            return cached;
        }
        return network;
    }));
});
