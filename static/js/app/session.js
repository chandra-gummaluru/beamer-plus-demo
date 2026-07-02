/** Session helpers — presenter URLs are scoped under /s/{session_id}/. */

export function getSessionId() {
    if (window.BEAMER_SESSION_ID) return window.BEAMER_SESSION_ID;
    const m = window.location.pathname.match(/^\/s\/([^/]+)/);
    return m ? m[1] : null;
}

/** Base path for session-scoped API routes, e.g. `/s/ABC123`. */
export function sessionPrefix() {
    const id = getSessionId();
    return id ? `/s/${id}` : '';
}

/** Prefix an API path with the current session scope. */
export function sessionUrl(path) {
    const prefix = sessionPrefix();
    if (!prefix) return path;
    return prefix + (path.startsWith('/') ? path : `/${path}`);
}

/** Audience-facing origin + session prefix (for QR codes). */
export function publicSessionBase() {
    const prefix = sessionPrefix();
    return prefix ? `${window.location.origin}${prefix}` : window.location.origin;
}

/** Widget iframe config fields shared by the presenter shell. */
export function widgetSessionConfig() {
    const id = getSessionId();
    const origin = window.location.origin;
    const base = id ? `${origin}/s/${id}` : origin;
    return {
        sessionId: id,
        socketUrl: origin,
        serverUrl: base,
        publicBaseUrl: base,
    };
}

const STORAGE_KEY = 'beamer-last-session';

export function saveLastSession(sessionId) {
    if (sessionId) localStorage.setItem(STORAGE_KEY, sessionId);
}

export function getLastSession() {
    return localStorage.getItem(STORAGE_KEY) || '';
}

export async function createSession() {
    const res = await fetch('/api/session/create', { method: 'POST' });
    if (!res.ok) throw new Error('Could not create session');
    const data = await res.json();
    saveLastSession(data.session_id);
    return data;
}

export async function sessionExists(sessionId) {
    const res = await fetch(`/api/session/${encodeURIComponent(sessionId)}`);
    return res.ok;
}
