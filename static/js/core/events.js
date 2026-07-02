// Tiny event bus shared across modules.
export const bus = (() => {
    const listeners = new Map();
    return {
        on(event, fn) {
            if (!listeners.has(event)) listeners.set(event, new Set());
            listeners.get(event).add(fn);
            return () => listeners.get(event)?.delete(fn);
        },
        off(event, fn) { listeners.get(event)?.delete(fn); },
        emit(event, ...args) {
            listeners.get(event)?.forEach(fn => {
                try { fn(...args); } catch (e) { console.error(`[bus:${event}]`, e); }
            });
        },
    };
})();

export function addHoldListener(el, onHold, holdTime = 500, onEnd) {
    let timerId = null;
    let held = false;
    const start = (e) => {
        if (typeof e.button === 'number' && e.button !== 0) return;
        held = false;
        clearTimeout(timerId);
        timerId = setTimeout(() => { held = true; onHold(e); }, holdTime);
    };
    const end = (e) => {
        clearTimeout(timerId);
        if (held && typeof onEnd === 'function') onEnd(e);
    };
    if (window.PointerEvent) {
        el.addEventListener('pointerdown', start);
        el.addEventListener('pointerup', end);
        el.addEventListener('pointercancel', end);
        el.addEventListener('pointerleave', end);
    } else {
        el.addEventListener('mousedown', start);
        el.addEventListener('mouseup', end);
        el.addEventListener('mouseleave', end);
        el.addEventListener('touchstart', start, { passive: true });
        el.addEventListener('touchend', end);
        el.addEventListener('touchcancel', end);
    }
}
