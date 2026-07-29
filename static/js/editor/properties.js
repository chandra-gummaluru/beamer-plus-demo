// Properties panel — position/size/z-index for the selected overlay plus
// type-specific fields (video play mode, model animation, widget schema
// fields). Every change is applied to the in-memory config immediately.
import { ctx, getSlideEl, getOrCreateConfig, escAttr, escHtml, pickFile } from './context.js';
import { loadWidgetSchema } from '../core/iframe-widget-renderer.js';
import { WIDGET_RESERVED, buildWidgetFieldsHTML, applyWidgetFieldValues } from './fields.js';
import { openAddFieldModal } from './add-field-modal.js';
import { cleanupEditOverlays, renderEditOverlays, positionOverlay } from './overlays.js';
import { WIDGET_LABELS } from './widget-picker.js';
import { sessionUrl, widgetSessionConfig } from '../app/session.js';

// Schema loaded from the currently-selected widget's HTML.
// Set by updatePropertiesPanel; used when applying values back to the item.
let _currentWidgetSchema = null;

let _propsPanelGen = 0;

export async function updatePropertiesPanel() {
    const gen = ++_propsPanelGen;

    const panel = document.getElementById('editor-properties');
    if (!panel) return;
    if (!ctx.selectedOverlay) { panel.classList.remove('visible'); return; }
    panel.classList.add('visible');

    const { arrKey, index } = ctx.selectedOverlay;
    const cfg  = getOrCreateConfig();
    const item = cfg?.[arrKey]?.[index];
    if (!item) return;

    // Load widget schema asynchronously; abort if selection changed while awaiting.
    let schemaFields = null;
    if (arrKey === 'widgets') {
        const schema = await loadWidgetSchema(item.type);
        if (gen !== _propsPanelGen) return;  // selection changed — discard stale update
        _currentWidgetSchema = schema;
        schemaFields = schema?.fields ?? null;
    } else {
        _currentWidgetSchema = null;
    }

    const typeLabels = { videos: 'Video', audios: 'Audio', models: '3D Model', widgets: 'Widget' };
    const titleEl = document.getElementById('editor-properties-title');
    if (titleEl) titleEl.textContent = `${typeLabels[arrKey] || arrKey} Properties`;

    const body = document.getElementById('editor-properties-body');
    if (!body) return;
    body.innerHTML = buildPropsHTML(arrKey, item, schemaFields);

    // Populate ai-model selects from the server's loaded model list
    const aiModelSelects = body.querySelectorAll('[data-ai-model-select]');
    if (aiModelSelects.length) {
        fetch(sessionUrl('/api/models')).then(r => r.json()).then(({ models = [] }) => {
            if (gen !== _propsPanelGen) return;
            aiModelSelects.forEach(sel => {
                const fieldKey = sel.id.replace('prop-widget-', '');
                const cur = item[fieldKey] ?? '';
                sel.innerHTML = `<option value="">— no model —</option>` +
                    models.map(m => `<option value="${escAttr(m)}" ${cur === m ? 'selected' : ''}>${escHtml(m)}</option>`).join('');
            });
        }).catch(() => {});
    }

    // Delete button
    body.querySelector('#prop-delete')?.addEventListener('click', () => deleteItem(arrKey, index));

    // Custom widget (no schema declared): add / remove extra fields
    if (arrKey === 'widgets' && _currentWidgetSchema === null) {
        body.querySelectorAll('.editor-prop-rm-field').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const k = btn.dataset.key;
                if (k) { delete item[k]; updatePropertiesPanel(); }
            });
        });
        document.getElementById('prop-custom-add-btn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            openAddFieldModal({
                existingKeys: Object.keys(item).filter(k => !WIDGET_RESERVED.has(k)),
                onAdd: ({ key, value }) => {
                    item[key] = value;
                    updatePropertiesPanel();
                },
            });
        });
    }

    // AR lock: W drives H for video/model
    if (arrKey === 'videos' || arrKey === 'models') {
        const ar = (item.width ?? 0.4) / (item.height ?? 0.3);
        document.getElementById('prop-w')?.addEventListener('input', () => {
            const w = parseFloat(document.getElementById('prop-w')?.value ?? '0');
            const hEl = document.getElementById('prop-h');
            if (!isNaN(w) && hEl) hEl.value = Math.round(w / ar);
        });
    }

    // File-upload buttons (schema type: "file")
    body.querySelectorAll('.editor-prop-file-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const file = await pickFile(btn.dataset.accept);
            if (!file) return;
            const folder = btn.dataset.folder || 'assets';
            const path   = `${folder}/${file.name}`;

            // Store buffer for ZIP inclusion on save
            ctx.state.editorNewFiles[path] = await file.arrayBuffer();

            // POST to server immediately so the widget can stream the file via
            // /api/zip-asset/ before the ZIP has been saved.
            try {
                const fd = new FormData();
                fd.append('file', file);
                fd.append('folder', folder);
                await fetch(sessionUrl('/api/upload-asset'), { method: 'POST', body: fd });
            } catch (e) {
                console.warn('[editor] upload-asset POST failed (widget preview may not work):', e);
            }

            // Update in-memory config item
            const cfg = getOrCreateConfig();
            const itm = cfg?.[arrKey]?.[index];
            if (itm) itm[btn.dataset.fieldKey] = path;

            // Update the text input so applyPropertiesQuiet reads the new value
            const el = document.getElementById(btn.dataset.fieldId);
            if (el) { el.value = path; el.title = path; }

            applyPropertiesQuiet();

            // applyPropertiesQuiet only updates positions; it never postMessages
            // the iframe.  Push the full updated config to the widget directly so
            // it can load the file right now without waiting for a save+reload.
            if (arrKey === 'widgets' && itm?.id) {
                const iframe = document.querySelector(
                    `.widget-iframe[data-widget-id="${CSS.escape(String(itm.id))}"]`
                );
                if (iframe?.contentWindow) {
                    try {
                        iframe.contentWindow.postMessage({
                            type: 'widget-config',
                            config: { ...itm, ...widgetSessionConfig(), role: 'presenter' }
                        }, '*');
                    } catch (_) {}
                }
            }
        });
    });

    // Auto-apply every change immediately. Property assignment (not
    // addEventListener) because #editor-properties-body persists across panel
    // refreshes — addEventListener here would stack a new listener per refresh.
    body.oninput  = () => applyPropertiesQuiet();
    body.onchange = () => applyPropertiesQuiet();
}

function buildPropsHTML(arrKey, item, schemaFields = null) {
    const lockAR = arrKey === 'videos' || arrKey === 'models';

    let html = '';

    // ── Widget type badge (top of panel) ──────────────────────────────────
    if (arrKey === 'widgets') {
        const typeLabel = WIDGET_LABELS[item.type]
            || (item.type || '').replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
            || 'Custom Widget';
        html += `
            <div class="editor-prop-row editor-prop-row--type-header">
                <div class="editor-prop-label">Widget type</div>
                <div class="editor-prop-type-badge">${escHtml(typeLabel)}</div>
            </div>
            <div class="editor-prop-divider"></div>
        `;
    }

    html += `
        <div class="editor-prop-row">
            <div class="editor-prop-label">Position</div>
            <div class="editor-prop-row-2col">
                <div><div class="editor-prop-label">X (%)</div>
                <input class="editor-prop-input" type="number" min="0" max="100" step="1" id="prop-x" value="${Math.round((item.x ?? 0) * 100)}"></div>
                <div><div class="editor-prop-label">Y (%)</div>
                <input class="editor-prop-input" type="number" min="0" max="100" step="1" id="prop-y" value="${Math.round((item.y ?? 0) * 100)}"></div>
            </div>
        </div>
        <div class="editor-prop-row">
            <div class="editor-prop-label">Size${lockAR ? '<span class="editor-prop-label-note">locked ratio</span>' : ''}</div>
            <div class="editor-prop-row-2col">
                <div><div class="editor-prop-label">W (%)</div>
                <input class="editor-prop-input" type="number" min="1" max="100" step="1" id="prop-w" value="${Math.round((item.width  ?? 0.4) * 100)}"></div>
                <div><div class="editor-prop-label">H (%)</div>
                <input class="editor-prop-input" type="number" min="1" max="100" step="1" id="prop-h" value="${Math.round((item.height ?? 0.3) * 100)}"${lockAR ? ' readonly' : ''}></div>
            </div>
        </div>
        <div class="editor-prop-row">
            <div class="editor-prop-label">Z-Index</div>
            <input class="editor-prop-input" type="number" min="1" max="999" step="1" id="prop-z" value="${item.zIndex ?? 5}">
        </div>
    `;

    if (arrKey === 'videos') {
        html += `
            <div class="editor-prop-row">
                <div class="editor-prop-label">Play Mode</div>
                <select class="editor-prop-select" id="prop-playMode">
                    <option value="click"  ${(item.playMode ?? 'click') === 'click'  ? 'selected' : ''}>Click to play</option>
                    <option value="auto"   ${item.playMode === 'auto'   ? 'selected' : ''}>Auto (once, muted)</option>
                    <option value="loop"   ${item.playMode === 'loop'   ? 'selected' : ''}>Loop (muted)</option>
                    <option value="manual" ${item.playMode === 'manual' ? 'selected' : ''}>Manual controls</option>
                    <option value="once"   ${item.playMode === 'once'   ? 'selected' : ''}>Once</option>
                </select>
            </div>
            <div class="editor-prop-row">
                <div class="editor-prop-label">Volume (0–1)</div>
                <input class="editor-prop-input" type="number" min="0" max="1" step="0.05" id="prop-volume" value="${item.volume ?? 1}">
            </div>
        `;
    } else if (arrKey === 'audios') {
        html += `
            <div class="editor-prop-row">
                <div class="editor-prop-label">Play Mode</div>
                <select class="editor-prop-select" id="prop-playMode">
                    <option value="click" ${(item.playMode ?? 'click') === 'click' ? 'selected' : ''}>Click to play</option>
                    <option value="auto"  ${item.playMode === 'auto'  ? 'selected' : ''}>Auto</option>
                    <option value="loop"  ${item.playMode === 'loop'  ? 'selected' : ''}>Loop</option>
                </select>
            </div>
        `;
    } else if (arrKey === 'models') {
        html += `
            <div class="editor-prop-row">
                <label class="editor-prop-checkbox-row">
                    <input type="checkbox" id="prop-autoRotate" ${item.autoRotate ? 'checked' : ''}>
                    Auto-rotate
                </label>
            </div>
            <div class="editor-prop-row">
                <label class="editor-prop-checkbox-row">
                    <input type="checkbox" id="prop-animate" ${item.animate !== false ? 'checked' : ''}>
                    Play animation
                </label>
            </div>
            <div class="editor-prop-row">
                <div class="editor-prop-label">Animation name (optional)</div>
                <input class="editor-prop-input" type="text" id="prop-animName" value="${escAttr(item.animationName ?? '')}">
            </div>
        `;
    } else if (arrKey === 'widgets') {
        html += `
            <div class="editor-prop-divider"></div>
            ${buildWidgetFieldsHTML(item, schemaFields)}
        `;
    }

    html += `
        <button class="btn editor-delete-btn" id="prop-delete" title="Remove this item">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
            Remove
        </button>
    `;

    return html;
}

export function syncPropertiesPosition() {
    const { arrKey, index } = ctx.selectedOverlay || {};
    if (!arrKey) return;
    const item = getOrCreateConfig()?.[arrKey]?.[index];
    if (!item) return;
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
    set('prop-x', Math.round((item.x      ?? 0)   * 100));
    set('prop-y', Math.round((item.y      ?? 0)   * 100));
    set('prop-w', Math.round((item.width  ?? 0.4) * 100));
    set('prop-h', Math.round((item.height ?? 0.3) * 100));
}

export function applyPropertiesQuiet() {
    const { arrKey, index, div } = ctx.selectedOverlay || {};
    if (!arrKey) return;
    const cfg  = getOrCreateConfig();
    const item = cfg?.[arrKey]?.[index];
    if (!item) return;

    const get = (id) => document.getElementById(id);
    const num = (id) => parseFloat(get(id)?.value ?? '0');

    item.x      = num('prop-x') / 100;
    item.y      = num('prop-y') / 100;
    item.width  = num('prop-w') / 100;
    item.height = num('prop-h') / 100;
    item.zIndex = parseInt(get('prop-z')?.value ?? '5', 10);

    if (arrKey === 'videos') {
        item.playMode = get('prop-playMode')?.value ?? 'click';
        item.volume   = num('prop-volume');
    } else if (arrKey === 'audios') {
        item.playMode = get('prop-playMode')?.value ?? 'click';
    } else if (arrKey === 'models') {
        item.autoRotate    = get('prop-autoRotate')?.checked ?? false;
        item.animate       = get('prop-animate')?.checked ?? true;
        item.animationName = get('prop-animName')?.value || undefined;
    } else if (arrKey === 'widgets') {
        applyWidgetFieldValues(item, _currentWidgetSchema?.fields ?? null);
    }

    const container = getSlideEl();
    const cr = container?.getBoundingClientRect();
    if (div && cr) positionOverlay(div, item, cr);
}

function deleteItem(arrKey, index) {
    const cfg = getOrCreateConfig();
    if (!cfg?.[arrKey]) return;
    cfg[arrKey].splice(index, 1);
    if (!cfg[arrKey].length) delete cfg[arrKey];
    if (ctx.selectedOverlay?.arrKey === arrKey && ctx.selectedOverlay?.index === index) ctx.selectedOverlay = null;
    cleanupEditOverlays();
    renderEditOverlays();
    updatePropertiesPanel();
}
