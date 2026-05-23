// iframe-widget-renderer.js
// Renders widgets from HTML files in the zip file.
// Widgets are loaded as blob URLs from the presentation zip.

// ── Expand/collapse registry ───────────────────────────────────────────────
// widgetId → { iframe, container, savedStyle }
const _widgetRegistry = new Map();
let _expandListenerAttached = false;

function _ensureExpandListener() {
    if (_expandListenerAttached) return;
    _expandListenerAttached = true;
    window.addEventListener('message', e => {
        const { type, widgetId } = e.data || {};
        if (type === 'widget-expand') {
            const entry = _widgetRegistry.get(widgetId);
            if (!entry) return;
            const { iframe, container } = entry;
            const rect = container.getBoundingClientRect();
            entry.savedStyle = {
                left:       iframe.style.left,
                top:        iframe.style.top,
                width:      iframe.style.width,
                height:     iframe.style.height,
                zIndex:     iframe.style.zIndex,
                transition: iframe.style.transition,
            };
            iframe.style.transition = 'left 0.45s ease, top 0.45s ease, width 0.45s ease, height 0.45s ease';
            iframe.style.left   = '0px';
            iframe.style.top    = '0px';
            iframe.style.width  = rect.width  + 'px';
            iframe.style.height = rect.height + 'px';
            iframe.style.zIndex = '500';
        } else if (type === 'widget-collapse') {
            const entry = _widgetRegistry.get(widgetId);
            if (!entry?.savedStyle) return;
            Object.assign(entry.iframe.style, entry.savedStyle);
            entry.savedStyle = null;
        }
    });
}

// ── Iframe pool ────────────────────────────────────────────────────────────
// When navigating away from a slide, iframes are parked here instead of
// destroyed, so their internal state (code, drawings, timers…) is preserved.

let _pool = null;
function _getPool() {
    if (!_pool) {
        _pool = document.createElement('div');
        _pool.id = '_widget-pool';
        _pool.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:1px;height:1px;overflow:hidden;pointer-events:none;visibility:hidden;';
        document.body.appendChild(_pool);
    }
    return _pool;
}

// slideKey → Map(widgetId → iframe)
const _slideIframes = new Map();

// States loaded from ZIP to restore into freshly-created iframes
let _savedWidgetStates = {};

// In-session states captured whenever widgets are parked (survive slide
// transitions; cleared when a new presentation is loaded).
let _sessionWidgetStates = {};

// Passive listener — captures every widget-state reply into _sessionWidgetStates
// so we always have the freshest snapshot regardless of who asked for it.
let _stateListenerAttached = false;
function _ensureStateListener() {
    if (_stateListenerAttached) return;
    _stateListenerAttached = true;
    window.addEventListener('message', e => {
        if (e.data?.type === 'widget-state' && e.data.widgetId && e.data.state !== undefined) {
            _sessionWidgetStates[e.data.widgetId] = e.data.state;
        }
    });
}

/**
 * Store widget states to be injected after each widget iframe first loads.
 * Called when a ZIP is loaded that contains config/widget-states.json.
 */
export function setWidgetStates(states) {
    _savedWidgetStates = (states && typeof states === 'object') ? states : {};
    // A new ZIP was loaded — in-session snapshots are stale, start fresh.
    _sessionWidgetStates = {};
}

/**
 * Move all .widget-iframe elements from `container` into the hidden pool,
 * indexed by `slideKey`. Call before rendering a different slide into the
 * same container so widgets can be recovered when the slide is revisited.
 */
export function parkWidgets(container, slideKey) {
    _ensureStateListener();
    const iframes = Array.from(container.querySelectorAll('.widget-iframe'));
    if (iframes.length === 0) return;
    const pool = _getPool();

    let widgetMap = _slideIframes.get(slideKey);
    if (!widgetMap) { widgetMap = new Map(); _slideIframes.set(slideKey, widgetMap); }

    iframes.forEach(iframe => {
        const wid = iframe.dataset.widgetId;
        if (wid) {
            // Ask the widget for its current state before we move it.
            // The reply is caught by _ensureStateListener and stored in
            // _sessionWidgetStates — no await needed here.
            try { iframe.contentWindow?.postMessage({ type: 'widget-get-state' }, '*'); } catch {}

            // If the iframe reloads while sitting in the pool, immediately
            // push the last-known session state back into it.
            iframe.addEventListener('load', () => {
                const st = _sessionWidgetStates[wid];
                if (st !== undefined) {
                    try { iframe.contentWindow?.postMessage({ type: 'widget-set-state', state: st }, '*'); } catch {}
                }
            }, { once: true });

            widgetMap.set(wid, iframe);
            _widgetRegistry.delete(wid);
        }
        pool.appendChild(iframe); // DOM move — does NOT reload the iframe
    });
}

/**
 * Destroy all parked iframes for a specific slide (e.g. after the editor
 * changes widget config so we want a fresh render).
 */
export function discardParkedWidgets(slideKey) {
    const widgetMap = _slideIframes.get(slideKey);
    if (!widgetMap) return;
    widgetMap.forEach((iframe, wid) => {
        _widgetRegistry.delete(wid);
        try { iframe.contentWindow?.postMessage({ type: 'widget-cleanup' }, '*'); } catch {}
        iframe.remove();
    });
    _slideIframes.delete(slideKey);
}

/**
 * Destroy every parked iframe and reset saved states.
 * Call when a new presentation is loaded.
 */
export function clearAllParked() {
    _slideIframes.forEach(widgetMap => {
        widgetMap.forEach((iframe, wid) => {
            _widgetRegistry.delete(wid);
            try { iframe.contentWindow?.postMessage({ type: 'widget-cleanup' }, '*'); } catch {}
            iframe.remove();
        });
    });
    _slideIframes.clear();
    _savedWidgetStates = {};
    _sessionWidgetStates = {};
}

/**
 * Collect serialised state from ALL live iframes (visible + parked).
 * Sends { type:'widget-get-state' } to each iframe and waits for
 * { type:'widget-state', widgetId, state } replies.
 * Resolves with a { widgetId: state } map after timeoutMs.
 */
export async function collectWidgetStates(timeoutMs = 1500) {
    const allIframes = new Map();

    // Visible iframes (in real DOM containers)
    document.querySelectorAll('.widget-iframe').forEach(iframe => {
        const wid = iframe.dataset.widgetId;
        if (wid) allIframes.set(wid, iframe);
    });

    // Parked iframes (in hidden pool)
    _slideIframes.forEach(widgetMap => {
        widgetMap.forEach((iframe, wid) => allIframes.set(wid, iframe));
    });

    if (allIframes.size === 0) return {};

    const states = {};
    const pending = new Set(allIframes.keys());

    return new Promise(resolve => {
        const done = () => {
            clearTimeout(timer);
            window.removeEventListener('message', handler);
            resolve(states);
        };
        const timer = setTimeout(done, timeoutMs);

        function handler(e) {
            if (e.data?.type === 'widget-state' && e.data.widgetId && e.data.state !== undefined) {
                states[e.data.widgetId] = e.data.state;
                pending.delete(e.data.widgetId);
                if (pending.size === 0) done();
            }
        }
        window.addEventListener('message', handler);

        allIframes.forEach(iframe => {
            try { iframe.contentWindow?.postMessage({ type: 'widget-get-state' }, '*'); } catch {}
        });
    });
}

// ── Main render function ───────────────────────────────────────────────────

/**
 * @param {object}  slideConfig  - slide config object with .widgets array
 * @param {Element} container    - DOM container to place iframes in
 * @param {object}  zipFile      - JSZip instance (may be null for built-ins)
 * @param {boolean} viewerMode
 * @param {string|number|null} slideKey - unique key for this slide+pane combo;
 *        used to recover parked iframes when revisiting the slide.
 */
export function renderWidgets(slideConfig, container, zipFile, viewerMode = false, slideKey = null) {
    if (!slideConfig.widgets || slideConfig.widgets.length === 0) {
        return Promise.resolve();
    }

    // Consume any parked iframes for this slide key
    const parkedMap = (slideKey != null && _slideIframes.has(slideKey))
        ? new Map(_slideIframes.get(slideKey))
        : new Map();
    if (slideKey != null) _slideIframes.delete(slideKey); // consumed

    const promises = slideConfig.widgets.map(async (w) => {
        // ── Re-attach parked iframe (state preserved) ─────────────────────
        const parked = parkedMap.get(w.id);
        if (parked) {
            container.appendChild(parked);
            _widgetRegistry.set(w.id, { iframe: parked, container, savedStyle: null });
            _ensureExpandListener();
            _ensureStateListener();

            // Re-apply position/size in case the container was resized
            const rect = container.getBoundingClientRect();
            parked.style.left          = `${w.x * rect.width}px`;
            parked.style.top           = `${w.y * rect.height}px`;
            parked.style.width         = `${w.width * rect.width}px`;
            parked.style.height        = `${w.height * rect.height}px`;
            parked.style.zIndex        = w.zIndex || 10;
            parked.style.pointerEvents = w.interactive !== false ? 'auto' : 'none';

            // If the browser reloads the iframe when it's moved back into the
            // live DOM, restore the last-known session state on the load event.
            const _sessionSt = _sessionWidgetStates[w.id];
            if (_sessionSt !== undefined) {
                parked.addEventListener('load', () => {
                    try { parked.contentWindow?.postMessage({ type: 'widget-set-state', state: _sessionSt }, '*'); } catch {}
                }, { once: true });
            }

            parkedMap.delete(w.id);
            return;
        }

        // ── Create new iframe ──────────────────────────────────────────────
        const iframe = document.createElement("iframe");
        iframe.className = "widget-iframe";
        iframe.dataset.widgetId = w.id;

        iframe.dataset.widgetX      = w.x;
        iframe.dataset.widgetY      = w.y;
        iframe.dataset.widgetWidth  = w.width;
        iframe.dataset.widgetHeight = w.height;
        iframe.dataset.widgetZIndex = w.zIndex || 10;
        iframe.dataset.widgetInteractive = w.interactive !== false ? 'true' : 'false';

        const rect = container.getBoundingClientRect();
        iframe.style.position      = "absolute";
        iframe.style.left          = `${w.x * rect.width}px`;
        iframe.style.top           = `${w.y * rect.height}px`;
        iframe.style.width         = `${w.width * rect.width}px`;
        iframe.style.height        = `${w.height * rect.height}px`;
        iframe.style.zIndex        = w.zIndex || 10;
        iframe.style.border        = "none";
        iframe.style.background    = "transparent";
        iframe.style.pointerEvents = w.interactive !== false ? 'auto' : 'none';

        iframe.allow = "autoplay; fullscreen; camera; microphone";

        container.appendChild(iframe);
        _widgetRegistry.set(w.id, { iframe, container, savedStyle: null });
        _ensureExpandListener();

        try {
            let htmlContent;

            if (w.builtin) {
                const res = await fetch(`/widgets/${encodeURIComponent(w.type)}.html`);
                if (!res.ok) throw new Error(`Built-in widget not found: ${w.type} (${res.status})`);
                htmlContent = await res.text();
            } else if (w.src && /^blob:/i.test(w.src)) {
                const res = await fetch(w.src);
                if (!res.ok) throw new Error(`Could not load custom widget blob`);
                htmlContent = await res.text();
            } else {
                const widgetPath = resolveWidgetPath(w);
                const widgetFile = findWidgetFile(zipFile, widgetPath);
                if (!widgetFile) {
                    console.error(`Widget file not found in zip: ${widgetPath}`);
                    iframe.srcdoc = `<div style="padding:20px;font-family:sans-serif;color:#666;">Widget not found: ${widgetPath}</div>`;
                    return;
                }
                htmlContent = await widgetFile.async("string");
            }

            // Pre-load notebook from zip if widget config specifies one
            let notebookContent = null;
            if (w.notebook && typeof w.notebook === 'string' && w.notebook.trim()) {
                const nbPath = w.notebook.trim().replace(/^\/+/, '');
                const nbFile = zipFile?.file(nbPath)
                    || zipFile?.filter((p, f) => !f.dir && p.toLowerCase() === nbPath.toLowerCase())[0];
                if (nbFile) {
                    try {
                        notebookContent = JSON.parse(await nbFile.async('string'));
                    } catch (e) {
                        console.warn(`Failed to parse notebook ${nbPath}:`, e);
                    }
                } else {
                    console.warn(`Notebook file not found in zip: ${nbPath}`);
                }
            }

            const _configPayload = {
                ...w,
                role: viewerMode ? 'viewer' : 'presenter',
                socketUrl: window.location.origin,
                ...(notebookContent !== null ? { notebookContent } : {}),
            };
            const _configJson   = JSON.stringify(_configPayload).replace(/<\/script>/gi, '<\\/script>');
            const _configScript = `<script>window.WIDGET_CONFIG=${_configJson};<\/script>`;
            const _injectedHtml = htmlContent.replace(/(<head[^>]*>)/i, `$1${_configScript}`);

            await new Promise((resolve) => {
                let settled = false;
                const finish = () => { if (!settled) { settled = true; resolve(); } };
                iframe.addEventListener('load', () => {
                    // Send config via postMessage (for event-based widgets)
                    iframe.contentWindow.postMessage({ type: 'widget-config', config: _configPayload }, '*');
                    // Restore state: prefer in-session snapshot (captured when
                    // the user last left this slide) over the ZIP-persisted state.
                    const savedState = _sessionWidgetStates[w.id] ?? _savedWidgetStates[w.id];
                    if (savedState !== undefined) {
                        iframe.contentWindow.postMessage({ type: 'widget-set-state', state: savedState }, '*');
                    }
                    finish();
                }, { once: true });
                setTimeout(finish, 6000);
                iframe.srcdoc = _injectedHtml;
            });

        } catch (error) {
            console.error('Error loading widget:', error);
            iframe.srcdoc = `<div style="padding:20px;font-family:sans-serif;color:#e74c3c;">Error loading widget: ${error.message}</div>`;
        }
    });

    // Destroy any parked iframes whose widget ID is no longer in the config
    // (the widget was removed while this slide was not visible)
    parkedMap.forEach((iframe, wid) => {
        _widgetRegistry.delete(wid);
        try { iframe.contentWindow?.postMessage({ type: 'widget-cleanup' }, '*'); } catch {}
        iframe.remove();
    });

    return Promise.all(promises);
}

// ── Position update ────────────────────────────────────────────────────────

export function updateWidgetPositions(container) {
    const rect = container.getBoundingClientRect();
    container.querySelectorAll('.widget-iframe').forEach(iframe => {
        const x      = parseFloat(iframe.dataset.widgetX);
        const y      = parseFloat(iframe.dataset.widgetY);
        const width  = parseFloat(iframe.dataset.widgetWidth);
        const height = parseFloat(iframe.dataset.widgetHeight);
        if (!isNaN(x) && !isNaN(y) && !isNaN(width) && !isNaN(height)) {
            iframe.style.left   = `${x * rect.width}px`;
            iframe.style.top    = `${y * rect.height}px`;
            iframe.style.width  = `${width * rect.width}px`;
            iframe.style.height = `${height * rect.height}px`;
        }
    });
}

// ── Cleanup (hard destroy — bypasses the pool) ─────────────────────────────

export function cleanupWidgets(container) {
    container.querySelectorAll('.widget-iframe').forEach(iframe => {
        const wid = iframe.dataset.widgetId;
        if (wid) _widgetRegistry.delete(wid);
        try { iframe.contentWindow?.postMessage({ type: 'widget-cleanup' }, '*'); } catch {}
        iframe.remove();
    });
}

// ── Path resolution helpers ────────────────────────────────────────────────

function resolveWidgetPath(widget) {
    const candidates = [
        widget?.path,
        widget?.src,
        widget?.file,
        widget?.url,
        widget?.type ? `widgets/${widget.type}.html` : null,
        widget?.id   ? `widgets/${widget.id}.html`   : null,
    ];
    for (const raw of candidates) {
        if (!raw || typeof raw !== 'string') continue;
        const trimmed = raw.trim();
        if (/^(https?:|blob:)/i.test(trimmed)) continue;
        const clean = raw.split('?')[0].trim().replace(/\\/g, '/').replace(/^\/+/, '');
        if (!clean) continue;
        if (clean.startsWith('widgets/')) return clean;
        if (clean.endsWith('.html')) return `widgets/${clean}`;
        return clean;
    }
    return '';
}

function findWidgetFile(zipFile, widgetPath) {
    if (!zipFile || !widgetPath) return null;
    let file = zipFile.file(widgetPath);
    if (file) return file;
    const lower = widgetPath.toLowerCase();
    const ciMatches = zipFile.filter((relPath, f) => !f.dir && relPath.toLowerCase() === lower);
    if (ciMatches.length) return ciMatches[0];
    if (!widgetPath.startsWith('widgets/')) {
        file = zipFile.file(`widgets/${widgetPath}`);
        if (file) return file;
    }
    return null;
}
