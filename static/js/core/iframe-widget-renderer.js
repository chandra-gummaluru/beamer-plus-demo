// iframe-widget-renderer.js
// Renders widgets from HTML files in the zip file
// Widgets are loaded as blob URLs from the presentation zip

// Registry for expand/collapse: widgetId -> { iframe, container, savedStyle }
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

export function renderWidgets(slideConfig, container, zipFile, viewerMode = false) {
    if (!slideConfig.widgets || slideConfig.widgets.length === 0) {
        return Promise.resolve();
    }

    const promises = slideConfig.widgets.map(async (w) => {
        const iframe = document.createElement("iframe");
        iframe.className = "widget-iframe";
        iframe.dataset.widgetId = w.id;
        
        // Store original widget config as percentages (0-1 range) for resize handling
        iframe.dataset.widgetX = w.x;
        iframe.dataset.widgetY = w.y;
        iframe.dataset.widgetWidth = w.width;
        iframe.dataset.widgetHeight = w.height;
        iframe.dataset.widgetZIndex = w.zIndex || 10;
        iframe.dataset.widgetInteractive = w.interactive !== false ? 'true' : 'false';
        
        // Get container's actual size
        const rect = container.getBoundingClientRect();
        
        // Styling - position relative to container's actual size
        iframe.style.position = "absolute";
        iframe.style.left = `${w.x * rect.width}px`;
        iframe.style.top = `${w.y * rect.height}px`;
        iframe.style.width = `${w.width * rect.width}px`;
        iframe.style.height = `${w.height * rect.height}px`;
        iframe.style.zIndex = w.zIndex || 10;
        iframe.style.border = "none";
        iframe.style.background = "transparent";
        iframe.style.pointerEvents = w.interactive !== false ? 'auto' : 'none';
        
        iframe.allow = "autoplay; fullscreen; camera; microphone";
        
        container.appendChild(iframe);
        _widgetRegistry.set(w.id, { iframe, container, savedStyle: null });
        _ensureExpandListener();

        // Load widget HTML from zip
        try {
            const widgetPath = resolveWidgetPath(w);
            const widgetFile = findWidgetFile(zipFile, widgetPath);
            
            if (!widgetFile) {
                console.error(`Widget file not found in zip: ${widgetPath}`);
                iframe.srcdoc = `<div style="padding:20px;font-family:sans-serif;color:#666;">Widget not found: ${widgetPath}</div>`;
                return;
            }
            
            const htmlContent = await widgetFile.async("string");

            // Resolve when the iframe fires 'load', with a 6 s safety fallback.
            await new Promise((resolve) => {
                let settled = false;
                const finish = () => { if (!settled) { settled = true; resolve(); } };
                iframe.addEventListener('load', () => {
                    iframe.contentWindow.postMessage({
                        type: 'widget-config',
                        config: {
                            ...w,
                            role: viewerMode ? 'viewer' : 'presenter',
                            socketUrl: window.location.origin,
                        },
                    }, '*');
                    finish();
                }, { once: true });
                setTimeout(finish, 6000);
                iframe.srcdoc = htmlContent;
            });
            
        } catch (error) {
            console.error('Error loading widget:', error);
            iframe.srcdoc = `<div style="padding:20px;font-family:sans-serif;color:#e74c3c;">Error loading widget: ${error.message}</div>`;
        }
    });

    return Promise.all(promises);
}

function resolveWidgetPath(widget) {
    const candidates = [
        widget?.path,
        widget?.src,
        widget?.file,
        widget?.url,
        widget?.type ? `widgets/${widget.type}.html` : null,
        widget?.id ? `widgets/${widget.id}.html` : null,
    ];

    for (const raw of candidates) {
        if (!raw || typeof raw !== 'string') continue;
        const trimmed = raw.trim();
        if (/^(https?:)?\/\//i.test(trimmed)) continue;
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

    // 1) Exact path first.
    let file = zipFile.file(widgetPath);
    if (file) return file;

    // 2) Case-insensitive exact match.
    const lower = widgetPath.toLowerCase();
    const ciMatches = zipFile.filter((relPath, f) => !f.dir && relPath.toLowerCase() === lower);
    const ciExact = ciMatches.length ? ciMatches[0] : null;
    if (ciExact) return ciExact;

    // 3) If config provided just a filename, try under widgets/.
    if (!widgetPath.startsWith('widgets/')) {
        file = zipFile.file(`widgets/${widgetPath}`);
        if (file) return file;
    }

    return null;
}

export function updateWidgetPositions(container) {
    // Update positions and sizes of all widgets after resize
    // Use the container's actual bounding rect for accurate positioning
    const rect = container.getBoundingClientRect();
    const widgets = container.querySelectorAll('.widget-iframe');
    
    widgets.forEach(iframe => {
        const x = parseFloat(iframe.dataset.widgetX);
        const y = parseFloat(iframe.dataset.widgetY);
        const width = parseFloat(iframe.dataset.widgetWidth);
        const height = parseFloat(iframe.dataset.widgetHeight);
        
        if (!isNaN(x) && !isNaN(y) && !isNaN(width) && !isNaN(height)) {
            iframe.style.left = `${x * rect.width}px`;
            iframe.style.top = `${y * rect.height}px`;
            iframe.style.width = `${width * rect.width}px`;
            iframe.style.height = `${height * rect.height}px`;
        }
    });
}

export function cleanupWidgets(container) {
    const existingWidgets = container.querySelectorAll('.widget-iframe');
    existingWidgets.forEach(iframe => {
        const wid = iframe.dataset.widgetId;
        if (wid) _widgetRegistry.delete(wid);
        // Send cleanup message to iframe
        if (iframe.contentWindow) {
            try {
                iframe.contentWindow.postMessage({ type: 'widget-cleanup' }, '*');
            } catch (e) {
                // Ignore errors if iframe is already destroyed
            }
        }
        iframe.remove();
    });
}
