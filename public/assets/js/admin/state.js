import { api } from '../lib/api.js';

export const ADMIN_ROLES = ['SuperAdmin', 'RegionalOfficer'];
export const ROLE_LABELS = { SuperAdmin: 'Super Admin', RegionalOfficer: 'Regional Officer', Staff: 'Gate Staff' };

export const state = {
    user: null,
    events: [],
};

export const isAdmin = () => ADMIN_ROLES.includes(state.user?.role);
export const isSuperAdmin = () => state.user?.role === 'SuperAdmin';

export const activeEvent = () => state.events.find((e) => Number(e.is_active) === 1) || null;

export async function loadEvents() {
    state.events = (await api('/events')).events;
    window.dispatchEvent(new CustomEvent('agripass:events-changed'));
    return state.events;
}
