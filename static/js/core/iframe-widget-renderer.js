// iframe-widget-renderer.js
// Renders widgets from HTML files in the zip file.
//
// ── Persistence strategy ───────────────────────────────────────────────────
// Iframes are NEVER moved or destroyed during normal slide navigation.
// When a slide is "parked" (navigated away from) its iframes stay in the
// same container but are hidden via opacity:0 + pointer-events:none.
// When the slide is revisited they are revealed and the widget is told to
// re-render (resize event + widget-set-state) so canvas content is restored.
// This guarantees the iframe never reloads and all JS state is preserved.

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

// ── Captured states ────────────────────────────────────────────────────────
// Populated by widget-get-state sent when parking, used to re-trigger
// widget rendering (e.g. canvas redraws) when the slide is revisited.
const _capturedStates = new Map(); // String(widgetId) → state

window.addEventListener('message', e => {
    if (e.data?.type === 'widget-state' && e.data.widgetId != null && e.data.state !== undefined) {
        _capturedStates.set(String(e.data.widgetId), e.data.state);
    }
});

// States loaded from ZIP to restore into freshly-created iframes
let _savedWidgetStates = {};

/**
 * Store widget states to be injected after each widget iframe first loads.
 * Called when a ZIP is loaded that contains config/widget-states.json.
 */
export function setWidgetStates(states) {
    _savedWidgetStates = (states && typeof states === 'object') ? states : {};
}

// ── CSS selector helper ────────────────────────────────────────────────────
// slideKey values are "L0", "R0", etc. – safe for attribute selectors.
function _bySlideSel(slideKey) {
    return `.widget-iframe[data-widget-slide="${slideKey}"]`;
}

// ── Park / restore ─────────────────────────────────────────────────────────

/**
 * "Park" the current slide's widgets: hide them with opacity:0 and ask each
 * one to report its state (so we can re-render canvases on reveal).
 * Iframes remain in the container — they are NOT moved or reloaded.
 */
export function parkWidgets(container, slideKey) {
    const iframes = Array.from(container.querySelectorAll(_bySlideSel(slideKey)));
    if (iframes.length === 0) return;

    iframes.forEach(iframe => {
        iframe.style.opacity       = '0';
        iframe.style.pointerEvents = 'none';
        iframe.style.zIndex        = '-1';  // ensure hidden behind visible iframes
        const wid = iframe.dataset.widgetId;
        if (wid) {
            _widgetRegistry.delete(wid);
            // Capture state now; will be re-applied when the slide is revisited.
            try { iframe.contentWindow?.postMessage({ type: 'widget-get-state' }, '*'); } catch (_) {}
        }
    });
}

/**
 * Destroy all widget iframes belonging to a specific slide.
 * Call after editor changes so a fresh render is forced on next visit.
 */
export function discardParkedWidgets(slideKey) {
    document.querySelectorAll(_bySlideSel(slideKey)).forEach(iframe => {
        const wid = iframe.dataset.widgetId;
        if (wid) { _widgetRegistry.delete(wid); _capturedStates.delete(String(wid)); }
        try { iframe.contentWindow?.postMessage({ type: 'widget-cleanup' }, '*'); } catch (_) {}
        iframe.remove();
    });
}

/**
 * Destroy ALL widget iframes in the document and reset saved states.
 * Call when a new presentation is loaded.
 */
export function clearAllParked() {
    document.querySelectorAll('.widget-iframe').forEach(iframe => {
        const wid = iframe.dataset.widgetId;
        if (wid) _widgetRegistry.delete(wid);
        try { iframe.contentWindow?.postMessage({ type: 'widget-cleanup' }, '*'); } catch (_) {}
        iframe.remove();
    });
    _capturedStates.clear();
    _savedWidgetStates = {};
}

/**
 * Collect serialised state from ALL live iframes (visible + hidden).
 * Sends { type:'widget-get-state' } to each iframe and waits for
 * { type:'widget-state', widgetId, state } replies.
 * Resolves with a { widgetId: state } map after timeoutMs.
 */
export async function collectWidgetStates(timeoutMs = 1500) {
    const allIframes = new Map();
    document.querySelectorAll('.widget-iframe').forEach(iframe => {
        const wid = iframe.dataset.widgetId;
        if (wid) allIframes.set(wid, iframe);
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
            try { iframe.contentWindow?.postMessage({ type: 'widget-get-state' }, '*'); } catch (_) {}
        });
    });
}

// ── Main render function ───────────────────────────────────────────────────

/**
 * @param {object}  slideConfig  - slide config object with .widgets array
 * @param {Element} container    - DOM container to place iframes in
 * @param {object}  zipFile      - JSZip instance (may be null for built-ins)
 * @param {boolean} viewerMode
 * @param {string|null} slideKey - unique key for this slide+pane combo
 */
export function renderWidgets(slideConfig, container, zipFile, viewerMode = false, slideKey = null) {
    if (!slideConfig.widgets || slideConfig.widgets.length === 0) {
        return Promise.resolve();
    }

    // Find any already-hidden iframes for this slide still in the container.
    const existingMap = new Map();
    if (slideKey != null) {
        container.querySelectorAll(_bySlideSel(slideKey)).forEach(iframe => {
            existingMap.set(iframe.dataset.widgetId, iframe);
        });
    }

    const promises = slideConfig.widgets.map(async (w) => {
        // dataset properties are always strings; w.id may be a number from JSON —
        // coerce to string so the Map lookup matches the string keys in existingMap.
        const existing = existingMap.get(String(w.id));

        if (existing) {
            // ── Reveal parked iframe ───────────────────────────────────────
            existingMap.delete(String(w.id));

            _widgetRegistry.set(w.id, { iframe: existing, container, savedStyle: null });
            _ensureExpandListener();

            // Restore position / size in case the container was resized
            const rect = container.getBoundingClientRect();
            existing.style.left          = `${w.x * rect.width}px`;
            existing.style.top           = `${w.y * rect.height}px`;
            existing.style.width         = `${w.width * rect.width}px`;
            existing.style.height        = `${w.height * rect.height}px`;
            existing.style.zIndex        = w.zIndex || 10;
            existing.style.pointerEvents = w.interactive !== false ? 'auto' : 'none';
            existing.style.opacity       = '1';  // make visible

            // After a short delay (browser reflow), fire resize and re-apply
            // captured state so canvas-based widgets redraw correctly.
            const widId = String(w.id);
            setTimeout(() => {
                try { existing.contentWindow?.dispatchEvent(new Event('resize')); } catch (_) {}
                const captured = _capturedStates.get(widId);
                if (captured !== undefined) {
                    try {
                        existing.contentWindow?.postMessage({ type: 'widget-set-state', state: captured }, '*');
                    } catch (_) {}
                }
            }, 50);

            return;
        }

        // ── Create new iframe ──────────────────────────────────────────────
        const iframe = document.createElement('iframe');
        iframe.className = 'widget-iframe';
        iframe.dataset.widgetId    = w.id;
        iframe.dataset.widgetSlide = slideKey ?? '';   // which slide owns this iframe

        iframe.dataset.widgetX      = w.x;
        iframe.dataset.widgetY      = w.y;
        iframe.dataset.widgetWidth  = w.width;
        iframe.dataset.widgetHeight = w.height;
        iframe.dataset.widgetZIndex = w.zIndex || 10;
        iframe.dataset.widgetInteractive = w.interactive !== false ? 'true' : 'false';

        const rect = container.getBoundingClientRect();
        iframe.style.position      = 'absolute';
        iframe.style.left          = `${w.x * rect.width}px`;
        iframe.style.top           = `${w.y * rect.height}px`;
        iframe.style.width         = `${w.width * rect.width}px`;
        iframe.style.height        = `${w.height * rect.height}px`;
        iframe.style.zIndex        = w.zIndex || 10;
        iframe.style.border        = 'none';
        iframe.style.background    = 'transparent';
        iframe.style.pointerEvents = w.interactive !== false ? 'auto' : 'none';
        iframe.style.opacity       = '1';

        iframe.allow = 'autoplay; fullscreen; camera; microphone';

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
                if (!res.ok) throw new Error('Could not load custom widget blob');
                htmlContent = await res.text();
            } else {
                const widgetPath = resolveWidgetPath(w);
                const widgetFile = findWidgetFile(zipFile, widgetPath);
                if (!widgetFile) {
                    console.error(`Widget file not found in zip: ${widgetPath}`);
                    iframe.srcdoc = `<div style="padding:20px;font-family:sans-serif;color:#666;">Widget not found: ${widgetPath}</div>`;
                    return;
                }
                htmlContent = await widgetFile.async('string');
            }

            // Pre-load notebook from zip if widget config specifies one
            let notebookContent = null;
            if (w.notebook && typeof w.notebook === 'string' && w.notebook.trim()) {
                const nbPath = w.notebook.trim().replace(/^\/+/, '');
                const nbFile = zipFile?.file(nbPath)
                    || zipFile?.filter((p, f) => !f.dir && p.toLowerCase() === nbPath.toLowerCase())[0];
                if (nbFile) {
                    try { notebookContent = JSON.parse(await nbFile.async('string')); }
                    catch (e) { console.warn(`Failed to parse notebook ${nbPath}:`, e); }
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

            await new Promise(resolve => {
                let settled = false;
                const finish = () => { if (!settled) { settled = true; resolve(); } };
                iframe.addEventListener('load', () => {
                    iframe.contentWindow.postMessage({ type: 'widget-config', config: _configPayload }, '*');
                    const savedState = _savedWidgetStates[w.id];
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

    // Destroy any hidden iframes whose widget ID is no longer in the config
    // (the widget was removed from the slide while it was not being viewed).
    existingMap.forEach((iframe, wid) => {
        _widgetRegistry.delete(wid);
        _capturedStates.delete(String(wid));
        try { iframe.contentWindow?.postMessage({ type: 'widget-cleanup' }, '*'); } catch (_) {}
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

// ── Cleanup (hard destroy — used for editor changes) ───────────────────────

export function cleanupWidgets(container) {
    container.querySelectorAll('.widget-iframe').forEach(iframe => {
        const wid = iframe.dataset.widgetId;
        if (wid) { _widgetRegistry.delete(wid); _capturedStates.delete(String(wid)); }
        try { iframe.contentWindow?.postMessage({ type: 'widget-cleanup' }, '*'); } catch (_) {}
        iframe.remove();
    });
}

// ── Path resolution helpers ────────────────────────────────────────────────

function resolveWidgetPath(widget) {
    const candidates = [
        widget?.path, widget?.src, widget?.file, widget?.url,
        widget?.type ? `widgets/${widget.type}.html` : null,
        widget?.id   ? `widgets/${widget.id}.html`   : null,
    ];
    for (const raw of candidates) {
        if (!raw || typeof raw !== 'string') continue;
        if (/^(https?:|blob:)/i.test(raw.trim())) continue;
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
