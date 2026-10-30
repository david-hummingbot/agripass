// IndexedDB persistence for offline scanning: downloaded rosters, the sync queue and device settings.

const DB_NAME = 'agripass-scanner';
const DB_VERSION = 1;

let dbPromise;

function open() {
    dbPromise ??= new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
            const db = req.result;
            db.createObjectStore('rosters', { keyPath: 'event_id' });
            db.createObjectStore('queue', { keyPath: 'client_uuid' });
            db.createObjectStore('meta');
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
    return dbPromise;
}

async function run(storeName, mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, mode);
        const result = fn(tx.objectStore(storeName));
        tx.oncomplete = () => resolve(result instanceof IDBRequest ? result.result : result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
    });
}

export const getMeta = (key) => run('meta', 'readonly', (s) => s.get(key));
export const setMeta = (key, value) => run('meta', 'readwrite', (s) => s.put(value, key));
export const deleteMeta = (key) => run('meta', 'readwrite', (s) => s.delete(key));

export const getRoster = (eventId) => run('rosters', 'readonly', (s) => s.get(eventId));
export const saveRoster = (roster) => run('rosters', 'readwrite', (s) => s.put(roster));
export const allRosters = () => run('rosters', 'readonly', (s) => s.getAll());

export const enqueue = (record) => run('queue', 'readwrite', (s) => s.put(record));
export const enqueueAll = (records) => run('queue', 'readwrite', (s) => records.forEach((r) => s.put(r)));
export const dequeue = (clientUuids) => run('queue', 'readwrite', (s) => clientUuids.forEach((id) => s.delete(id)));
export const allQueued = () => run('queue', 'readonly', (s) => s.getAll());

/** Stable per-browser identifier recorded with every scan as attendances.device_id. */
export async function deviceId() {
    let id = await getMeta('device_id');
    if (!id) {
        id = `scanner-${uuid().slice(0, 8)}`;
        await setMeta('device_id', id);
    }
    return id;
}

/** crypto.randomUUID is only exposed on secure origins; plain-HTTP LAN testing needs the fallback. */
export function uuid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
