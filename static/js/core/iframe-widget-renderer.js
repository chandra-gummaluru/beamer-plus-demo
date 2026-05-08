// iframe-widget-renderer.js
// Renders widgets from HTML files in the zip file
// Widgets are loaded as blob URLs from the presentation zip

export function renderWidgets(slideConfig, container, zipFile, viewerMode = false) {
    if (!slideConfig.widgets || slideConfig.widgets.length === 0) {
        return;
    }

    slideConfig.widgets.forEach(async (w) => {
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
        
        // Load widget HTML from zip
        try {
            // Accept common config fields for widget file path.
            // Example supported values:
            // - { path: "widgets/graph-search.html" }
            // - { src: "widgets/graph-search.html" }
            // - { file: "graph-search.html" }
            const widgetPath = resolveWidgetPath(w);
            const widgetFile = findWidgetFile(zipFile, widgetPath);
            
            if (!widgetFile) {
                console.error(`Widget file not found in zip: ${widgetPath}`);
                iframe.srcdoc = `<div style="padding:20px;font-family:sans-serif;color:#666;">Widget not found: ${widgetPath}</div>`;
                return;
            }
            
            const htmlContent = await widgetFile.async("string");
            
            // Set the iframe content
            iframe.srcdoc = htmlContent;
            
            // Pass full widget config (plus host context) to iframe once loaded
            iframe.addEventListener('load', () => {
                iframe.contentWindow.postMessage({
                    type: 'widget-config',
                    config: {
                        ...w,
                        role: viewerMode ? 'viewer' : 'presenter',
                        socketUrl: window.location.origin,
                    },
                }, '*');
            });
            
        } catch (error) {
            console.error('Error loading widget:', error);
            iframe.srcdoc = `<div style="padding:20px;font-family:sans-serif;color:#e74c3c;">Error loading widget: ${error.message}</div>`;
        }
    });
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
