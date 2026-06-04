// Edit mode for Beamer+ — slide reorder, media overlays, properties, save.
import { bus } from '../core/events.js';
import { collectWidgetStates, loadWidgetSchema } from '../core/iframe-widget-renderer.js';

/* ─── Built-in widget discovery maps ────────────────────────────
 * These are used ONLY by the "Add Widget" picker to enumerate and
 * categorise available widgets.  They do NOT control editable fields —
 * each widget HTML file declares its own schema via:
 *   <script id="widget-schema" type="application/json"> … </script>
 * ─────────────────────────────────────────────────────────────── */

const WIDGET_ICONS = {
    browser:            `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`,
    calculator:         `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="2" width="16" height="20" rx="2"/><line x1="8" y1="6" x2="16" y2="6"/><line x1="8" y1="11" x2="16" y2="11"/><line x1="8" y1="16" x2="12" y2="16"/></svg>`,
    camera:             `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>`,
    circuit_widget:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="7" y="7" width="10" height="10" rx="1"/><line x1="9" y1="7" x2="9" y2="4"/><line x1="12" y1="7" x2="12" y2="3"/><line x1="15" y1="7" x2="15" y2="4"/><line x1="9" y1="17" x2="9" y2="20"/><line x1="12" y1="17" x2="12" y2="21"/><line x1="15" y1="17" x2="15" y2="20"/><line x1="7" y1="9" x2="4" y2="9"/><line x1="7" y1="12" x2="3" y2="12"/><line x1="7" y1="15" x2="4" y2="15"/><line x1="17" y1="9" x2="20" y2="9"/><line x1="17" y1="12" x2="21" y2="12"/><line x1="17" y1="15" x2="20" y2="15"/></svg>`,
    'function-plotter': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>`,
    ipynb_widget:       `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>`,
    'll-delete':        `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="9" width="6" height="6" rx="1"/><rect x="10" y="9" width="6" height="6" rx="1"/><line x1="7" y1="12" x2="10" y2="12"/><line x1="19" y1="10" x2="22" y2="10"/><line x1="19" y1="14" x2="22" y2="14"/><line x1="22" y1="10" x2="22" y2="14"/></svg>`,
    map:                `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>`,
    mcq:                `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>`,
    'python-repl':      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="18" rx="2"/><polyline points="8 9 12 13 8 17"/><line x1="12" y1="17" x2="16" y2="17"/></svg>`,
    shell:              `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="18" rx="2"/><polyline points="4 9 8 13 4 17"/><line x1="10" y1="17" x2="20" y2="17"/></svg>`,
    survey:             `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>`,
    textbook:           `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>`,
    timer:              `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
    'word-cloud':       `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg>`,
    youtube:            `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22.54 6.42a2.78 2.78 0 0 0-1.95-1.96C18.88 4 12 4 12 4s-6.88 0-8.59.46a2.78 2.78 0 0 0-1.95 1.96A29 29 0 0 0 1 12a29 29 0 0 0 .46 5.58A2.78 2.78 0 0 0 3.41 19.6C5.12 20 12 20 12 20s6.88 0 8.59-.46a2.78 2.78 0 0 0 1.95-1.95A29 29 0 0 0 23 12a29 29 0 0 0-.46-5.58z"/><polygon points="9.75 15.02 15.5 12 9.75 8.98 9.75 15.02" fill="currentColor" stroke="none"/></svg>`,
    __default__:        `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>`,
    __custom__:         `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>`,
};

const WIDGET_LABELS = {
    'ipynb_widget':     'Coding Notebook',
    'circuit_widget':   'Digital Circuit Sim',
    'function-plotter': 'Function Plotter',
    'mcq':              'Choice',
    'word-cloud':       'Word Cloud',
};

// Widgets that exist on the server but should not appear in the picker UI.
const WIDGET_HIDDEN = new Set(['python-repl', 'll-delete']);

const WIDGET_CATEGORY_ORDER = [
    'Mathematics',
    'Computer Science',
    'Biology',
    'Engineering',
    'Audience Response',
    'Tools',
    'Other',
];

const WIDGET_CATEGORIES = {
    'calculator':       'Mathematics',
    'function-plotter': 'Mathematics',
    'browser':          'Tools',
    'ipynb_widget':     'Computer Science',
    'shell':            'Computer Science',
    'circuit_widget':   'Engineering',
    'mcq':              'Audience Response',
    'survey':           'Audience Response',
    'word-cloud':       'Audience Response',
    'camera':           'Tools',
    'map':              'Tools',
    'textbook':         'Tools',
    'timer':            'Tools',
    'youtube':          'Tools',
};

/* ─── Widget field schema ────────────────────────────────────── */

// Properties managed by the layout system — never shown as user-editable fields.
const _WIDGET_RESERVED = new Set([
    'id', 'type', 'x', 'y', 'width', 'height', 'zIndex',
    'builtin', 'src', 'interactive',
    'notebookContent', 'role', 'socketUrl',
]);

// Schema loaded from the currently-selected widget's HTML.
// Set by updatePropertiesPanel; used by _applyWidgetFieldValues.
let _currentWidgetSchema = null;

function _escAttr(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function _escHtml(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
// Safe element-id fragment for a custom field key (avoids CSS.escape dependency)
function _fieldId(key) {
    return 'prop-custom-' + key.replace(/[^a-zA-Z0-9_-]/g, '_');
}

// schemaFields: the .fields array from the widget's own schema declaration,
// or null if the widget has no schema (→ fall back to custom key-value editor).
function _buildWidgetFieldsHTML(item, schemaFields) {
    if (schemaFields === null || schemaFields === undefined) {
        return _buildCustomWidgetFieldsHTML(item);
    }
    let html = '';
    for (const field of schemaFields) html += _buildOneFieldRow(field, item);
    return html;
}

function _pickFile(accept) {
    return new Promise(resolve => {
        const inp = document.createElement('input');
        inp.type = 'file';
        inp.accept = accept || '*';
        inp.addEventListener('change', () => resolve(inp.files?.[0] ?? null));
        inp.addEventListener('cancel',  () => resolve(null));
        inp.click();
    });
}

function _buildOneFieldRow(field, item) {
    const fid = 'prop-widget-' + field.key;
    const val = item[field.key];
    const eff = val !== undefined ? val : field.default;
    const notePart = field.note
        ? ` <span class="editor-prop-label-note">${_escHtml(field.note)}</span>` : '';

    if (field.type === 'file') {
        const displayName = eff ? String(eff).split('/').pop() : '';
        return `
        <div class="editor-prop-row">
            <div class="editor-prop-label">${_escHtml(field.label)}${notePart}</div>
            <div class="editor-prop-file-row">
                <input type="text" class="editor-prop-input" id="${fid}"
                       value="${_escAttr(eff ?? '')}" readonly
                       placeholder="No file selected"
                       title="${_escAttr(eff ?? '')}">
                <button class="btn editor-prop-file-btn"
                        data-field-key="${_escAttr(field.key)}"
                        data-field-id="${fid}"
                        data-accept="${_escAttr(field.accept || '*')}"
                        data-folder="${_escAttr(field.folder || 'files')}">Upload</button>
            </div>
        </div>`;
    }

    if (field.type === 'checkbox') {
        return `
            <div class="editor-prop-row">
                <label class="editor-prop-checkbox-row">
                    <input type="checkbox" id="${fid}" ${eff === true ? 'checked' : ''}>
                    ${_escHtml(field.label)}
                </label>
            </div>`;
    }

    let control = '';
    if (field.type === 'text') {
        control = `<input class="editor-prop-input" type="text" id="${fid}" value="${_escAttr(eff ?? '')}" placeholder="${_escAttr(field.placeholder || '')}">`;
    } else if (field.type === 'number' || field.type === 'number-nullable') {
        const numVal = (eff === null || eff === undefined) ? '' : eff;
        control = `<input class="editor-prop-input" type="number" id="${fid}"
            value="${_escAttr(numVal)}"
            ${field.min  !== undefined ? `min="${field.min}"`   : ''}
            ${field.max  !== undefined ? `max="${field.max}"`   : ''}
            ${field.step !== undefined ? `step="${field.step}"` : ''}
            ${field.placeholder        ? `placeholder="${_escAttr(field.placeholder)}"` : ''}>`;
    } else if (field.type === 'select') {
        const opts = field.options.map(o =>
            `<option value="${_escAttr(o.v)}" ${eff === o.v ? 'selected' : ''}>${_escHtml(o.l)}</option>`
        ).join('');
        control = `<select class="editor-prop-select" id="${fid}">${opts}</select>`;
    } else if (field.type === 'password') {
        control = `<input class="editor-prop-input" type="password" id="${fid}" value="${_escAttr(eff ?? '')}" placeholder="${_escAttr(field.placeholder || '')}">`;
    } else if (field.type === 'ai-model') {
        control = `<select class="editor-prop-select" id="${fid}" data-ai-model-select="1">
            <option value="${_escAttr(eff ?? '')}">${eff ? _escHtml(String(eff)) : '— loading… —'}</option>
        </select>`;
    } else if (field.type === 'textarea') {
        control = `<textarea class="editor-prop-input" id="${fid}" rows="${field.rows || 3}" spellcheck="false" placeholder="${_escAttr(field.placeholder || '')}">${_escHtml(eff ?? '')}</textarea>`;
    } else if (field.type === 'textarea-lines') {
        const text = Array.isArray(eff) ? eff.join('\n') : (eff ?? '');
        control = `<textarea class="editor-prop-input" id="${fid}" rows="${field.rows || 4}" spellcheck="false" placeholder="${_escAttr(field.placeholder || '')}">${_escHtml(text)}</textarea>`;
    }

    return `
        <div class="editor-prop-row">
            <div class="editor-prop-label">${_escHtml(field.label)}${notePart}</div>
            ${control}
        </div>`;
}

function _buildCustomWidgetFieldsHTML(item) {
    let html = '';
    const entries = Object.entries(item).filter(([k]) => !_WIDGET_RESERVED.has(k));

    if (entries.length === 0) {
        html += `<p class="editor-prop-note">No extra fields yet.</p>`;
    }
    for (const [k, v] of entries) {
        const fid    = _fieldId(k);
        const isBool = typeof v === 'boolean';
        const isNum  = typeof v === 'number';
        if (isBool) {
            html += `
                <div class="editor-prop-row editor-prop-custom-row" data-custom-key="${_escAttr(k)}">
                    <div class="editor-prop-custom-bool-row">
                        <label class="editor-prop-checkbox-row">
                            <input type="checkbox" id="${fid}" ${v ? 'checked' : ''}>
                            <span>${_escHtml(k)}</span>
                        </label>
                        <button class="editor-prop-rm-field" data-key="${_escAttr(k)}" title="Remove field">✕</button>
                    </div>
                </div>`;
        } else {
            html += `
                <div class="editor-prop-row editor-prop-custom-row" data-custom-key="${_escAttr(k)}">
                    <div class="editor-prop-label">${_escHtml(k)}</div>
                    <div class="editor-prop-custom-val-row">
                        <input class="editor-prop-input" type="${isNum ? 'number' : 'text'}" id="${fid}" value="${_escAttr(String(v))}">
                        <button class="editor-prop-rm-field" data-key="${_escAttr(k)}" title="Remove field">✕</button>
                    </div>
                </div>`;
        }
    }
    // Add-field UI
    html += `
        <div class="editor-prop-add-field-block">
            <div class="editor-prop-label">Add custom field</div>
            <input class="editor-prop-input" type="text" id="prop-custom-new-key" placeholder="Key" autocomplete="off">
            <input class="editor-prop-input" type="text" id="prop-custom-new-val" placeholder="Value" autocomplete="off">
            <button class="btn editor-prop-add-field-btn" id="prop-custom-add-btn">+ Add field</button>
        </div>`;
    return html;
}

function _applyWidgetFieldValues(item) {
    const schemaFields = _currentWidgetSchema?.fields ?? null;
    const get          = id => document.getElementById(id);

    if (schemaFields === null) {
        _applyCustomWidgetFieldValues(item);
        return;
    }

    for (const field of schemaFields) {
        const el = get('prop-widget-' + field.key);
        if (!el) continue;
        if (field.type === 'checkbox') {
            item[field.key] = el.checked;
        } else if (field.type === 'number' || field.type === 'number-nullable') {
            const raw = el.value.trim();
            if (raw !== '') item[field.key] = parseFloat(raw);
            else delete item[field.key];
        } else if (field.type === 'textarea-lines') {
            const lines = el.value.split('\n').map(s => s.trim()).filter(Boolean);
            if (lines.length > 0) item[field.key] = lines;
            else delete item[field.key];
        } else {
            // text, textarea, select
            const v = el.value;
            if (v !== '') item[field.key] = v;
            else delete item[field.key];
        }
    }
}

function _applyCustomWidgetFieldValues(item) {
    // Clear existing non-reserved keys, then re-populate from visible rows
    for (const k of Object.keys(item)) {
        if (!_WIDGET_RESERVED.has(k)) delete item[k];
    }
    document.querySelectorAll('.editor-prop-custom-row').forEach(row => {
        const k  = row.dataset.customKey;
        if (!k) return;
        const el = document.getElementById(_fieldId(k));
        if (!el) return;
        if (el.type === 'checkbox') {
            item[k] = el.checked;
        } else if (el.type === 'number') {
            const v = parseFloat(el.value);
            if (!isNaN(v)) item[k] = v;
        } else {
            const v = el.value.trim();
            if (v !== '') item[k] = v;
        }
    });
}

/* ─── state ─────────────────────────────────────────────────── */

let _state = null;
let _selectedOverlay = null; // { div, arrKey, index }
let _pendingMediaType = null;
let _dragSrc = null;
let _slideReorderListeners = [];

/* ─── init ──────────────────────────────────────────────────── */

export function initEditor(state) {
    _state = state;
    state.editMode = false;
    state.editorNewFiles = {};

    document.getElementById('edit-mode-btn')?.addEventListener('click', toggleEditMode);
    document.getElementById('edit-save-btn')?.addEventListener('click', savePresentation);
    document.getElementById('edit-add-video-btn')?.addEventListener('click', () => pickMediaFile('video', 'video/*'));
    document.getElementById('edit-add-audio-btn')?.addEventListener('click', () => pickMediaFile('audio', 'audio/*'));
    document.getElementById('edit-add-model-btn')?.addEventListener('click', () => pickMediaFile('model', '.glb,.gltf'));
    document.getElementById('edit-add-widget-btn')?.addEventListener('click', addWidget);

    const fileInput = document.getElementById('edit-media-input');
    fileInput?.addEventListener('change', () => onMediaFileSelected(fileInput));

    bus.on('slides:loaded', () => { if (_state?.editMode) applySlideReorder(); });

    bus.on('slide:changed', () => {
        if (!_state?.editMode) return;
        _selectedOverlay = null;
        cleanupEditOverlays();
        renderEditOverlays();
        updatePropertiesPanel();
    });
}

/* ─── mode ──────────────────────────────────────────────────── */

function toggleEditMode() {
    if (_state.editMode) exitEditMode(); else enterEditMode();
}

async function enterEditMode() {
    // Edit mode uses a single-pane layout — exit split view first so the
    // slide container resizes before we try to render edit overlays.
    if (_state.splitView) {
        document.getElementById('split-toggle')?.click();
        // setSplitActive() has a 100 ms internal delay; wait for it to settle.
        await new Promise(r => setTimeout(r, 250));
    }
    _state.editMode = true;
    document.body.classList.add('edit-mode');
    const btn = document.getElementById('edit-mode-btn');
    if (btn) {
        btn.classList.add('is-close');
        btn.title = 'Exit edit mode';
        btn.dataset.originalHtml = btn.innerHTML;
        btn.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
    }
    if (_state.annCvs?.canvas) _state.annCvs.canvas.style.pointerEvents = 'none';
    applySlideReorder();
    setTimeout(() => { renderEditOverlays(); }, 60);
}

function exitEditMode() {
    _state.editMode = false;
    document.body.classList.remove('edit-mode');
    const btn = document.getElementById('edit-mode-btn');
    if (btn) {
        btn.classList.remove('is-close');
        btn.title = 'Edit mode';
        if (btn.dataset.originalHtml) btn.innerHTML = btn.dataset.originalHtml;
    }
    if (_state.annCvs?.canvas) _state.annCvs.canvas.style.pointerEvents = '';
    cleanupEditOverlays();
    removeSlideReorder();
    _selectedOverlay = null;
    updatePropertiesPanel();
    bus.emit('editor:exited');
}

/* ─── helpers ───────────────────────────────────────────────── */

function getSlideEl() { return document.getElementById('pdf-canvas'); }

function getCurrentPdfIndex() {
    const obj = _state.slideStructure[_state.currentSlide];
    return obj?.type === 'pdf' ? obj.pdfIndex : null;
}

function getOrCreateConfig() {
    const obj = _state.slideStructure[_state.currentSlide];
    if (!obj) return null;
    // PDF slides use their stable pdfIndex; blank slides use their stable blankId.
    const key = obj.type === 'pdf' ? obj.pdfIndex
              : obj.type === 'blank' ? obj.blankId
              : null;
    if (key === null || key === undefined) return null;
    if (!_state.slideConfigs[key]) _state.slideConfigs[key] = {};
    return _state.slideConfigs[key];
}

function arrKeyForType(type) {
    return type === 'video' ? 'videos' : type === 'audio' ? 'audios' : type === 'model' ? 'models' : 'widgets';
}

function getConfigItems(cfg) {
    return [
        ...(cfg.videos  || []).map((v, i) => ({ type: 'video',  arrKey: 'videos',  item: v, index: i })),
        ...(cfg.audios  || []).map((a, i) => ({ type: 'audio',  arrKey: 'audios',  item: a, index: i })),
        ...(cfg.models  || []).map((m, i) => ({ type: 'model',  arrKey: 'models',  item: m, index: i })),
        ...(cfg.widgets || []).map((w, i) => ({ type: 'widget', arrKey: 'widgets', item: w, index: i })),
    ];
}

/* ─── overlays ──────────────────────────────────────────────── */

function renderEditOverlays() {
    const container = getSlideEl();
    if (!container) return;
    const cfg = getOrCreateConfig();
    if (!cfg) return;
    const rect = container.getBoundingClientRect();
    if (!rect.width) return;
    getConfigItems(cfg).forEach(({ type, arrKey, item, index }) =>
        container.appendChild(buildOverlay(type, arrKey, item, index, container, rect)));
}

function buildOverlay(type, arrKey, item, index, container, rect) {
    const div = document.createElement('div');
    div.className = 'edit-overlay';
    div.dataset.arrKey = arrKey;
    div.dataset.itemIndex = String(index);
    positionOverlay(div, item, rect);

    const label = document.createElement('div');
    label.className = 'edit-overlay-label';
    const name = item.path ? item.path.split('/').pop() : (item.type || `${type} ${index + 1}`);
    label.textContent = name;
    div.appendChild(label);

    const handle = document.createElement('div');
    handle.className = 'edit-resize-handle';
    div.appendChild(handle);

    handle.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        selectOverlayEl(div, arrKey, index);
        startResize(e, div, handle, arrKey, index, container);
    });
    div.addEventListener('pointerdown', (e) => {
        if (e.target === handle) return;
        selectOverlayEl(div, arrKey, index);
        startMove(e, div, arrKey, index, container);
    });
    return div;
}

function positionOverlay(div, item, rect) {
    Object.assign(div.style, {
        left:   `${(item.x      ?? 0.1) * rect.width}px`,
        top:    `${(item.y      ?? 0.1) * rect.height}px`,
        width:  `${(item.width  ?? 0.4) * rect.width}px`,
        height: `${(item.height ?? 0.3) * rect.height}px`,
    });
}

function selectOverlayEl(div, arrKey, index) {
    document.querySelectorAll('.edit-overlay.selected').forEach(el => el.classList.remove('selected'));
    div.classList.add('selected');
    _selectedOverlay = { div, arrKey, index };
    updatePropertiesPanel();
}

function cleanupEditOverlays() {
    document.querySelectorAll('.edit-overlay').forEach(el => el.remove());
}

/* ─── drag-to-move ──────────────────────────────────────────── */

function startMove(e, div, arrKey, index, container) {
    e.preventDefault();
    div.setPointerCapture(e.pointerId);
    const dr = div.getBoundingClientRect();
    const offX = e.clientX - dr.left;
    const offY = e.clientY - dr.top;

    const onMove = (e) => {
        const cr = container.getBoundingClientRect();
        div.style.left = `${Math.max(0, Math.min(cr.width  - div.offsetWidth,  e.clientX - cr.left - offX))}px`;
        div.style.top  = `${Math.max(0, Math.min(cr.height - div.offsetHeight, e.clientY - cr.top  - offY))}px`;
    };
    const onUp = () => {
        const cr = container.getBoundingClientRect();
        const item = getOrCreateConfig()?.[arrKey]?.[index];
        if (item) {
            item.x = parseFloat(div.style.left) / cr.width;
            item.y = parseFloat(div.style.top)  / cr.height;
        }
        syncPropertiesPosition();
        div.releasePointerCapture(e.pointerId);
        div.removeEventListener('pointermove', onMove);
        div.removeEventListener('pointerup',   onUp);
    };
    div.addEventListener('pointermove', onMove);
    div.addEventListener('pointerup',   onUp);
}

/* ─── resize — aspect ratio locked for video/model ──────────── */

function startResize(e, div, handle, arrKey, index, container) {
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    const startX = e.clientX, startY = e.clientY;
    const startW = div.offsetWidth, startH = div.offsetHeight;
    const lockAR = arrKey === 'videos' || arrKey === 'models';
    const ar     = startW / startH;

    const onMove = (e) => {
        const newW = Math.max(40, startW + (e.clientX - startX));
        const newH = lockAR ? newW / ar : Math.max(30, startH + (e.clientY - startY));
        div.style.width  = `${newW}px`;
        div.style.height = `${newH}px`;
    };
    const onUp = () => {
        const cr = container.getBoundingClientRect();
        const item = getOrCreateConfig()?.[arrKey]?.[index];
        if (item) {
            item.width  = div.offsetWidth  / cr.width;
            item.height = div.offsetHeight / cr.height;
        }
        syncPropertiesPosition();
        handle.releasePointerCapture(e.pointerId);
        handle.removeEventListener('pointermove', onMove);
        handle.removeEventListener('pointerup',   onUp);
    };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup',   onUp);
}

/* ─── properties panel (sidebar) ───────────────────────────── */

let _propsPanelGen = 0;

async function updatePropertiesPanel() {
    const gen = ++_propsPanelGen;

    const panel = document.getElementById('editor-properties');
    if (!panel) return;
    if (!_selectedOverlay) { panel.classList.remove('visible'); return; }
    panel.classList.add('visible');

    const { arrKey, index } = _selectedOverlay;
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
        fetch('/api/models').then(r => r.json()).then(({ models = [] }) => {
            if (gen !== _propsPanelGen) return;
            aiModelSelects.forEach(sel => {
                const fieldKey = sel.id.replace('prop-widget-', '');
                const cur = item[fieldKey] ?? '';
                sel.innerHTML = `<option value="">— no model —</option>` +
                    models.map(m => `<option value="${_escAttr(m)}" ${cur === m ? 'selected' : ''}>${_escHtml(m)}</option>`).join('');
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
            const keyEl = document.getElementById('prop-custom-new-key');
            const valEl = document.getElementById('prop-custom-new-val');
            const k = keyEl?.value.trim();
            const v = valEl?.value.trim() ?? '';
            if (!k || _WIDGET_RESERVED.has(k)) return;
            // Auto-detect boolean / number / string
            if      (v === 'true')                              item[k] = true;
            else if (v === 'false')                             item[k] = false;
            else if (v !== '' && !isNaN(Number(v)))             item[k] = Number(v);
            else                                                item[k] = v;
            updatePropertiesPanel();
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
            const file = await _pickFile(btn.dataset.accept);
            if (!file) return;
            const folder = btn.dataset.folder || 'assets';
            const path   = `${folder}/${file.name}`;

            // Store buffer for ZIP inclusion on save
            _state.editorNewFiles[path] = await file.arrayBuffer();

            // POST to server immediately so the widget can stream the file via
            // /api/zip-asset/ before the ZIP has been saved.
            try {
                const fd = new FormData();
                fd.append('file', file);
                fd.append('folder', folder);
                await fetch('/api/upload-asset', { method: 'POST', body: fd });
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
                            config: { ...itm, role: 'presenter', socketUrl: window.location.origin }
                        }, '*');
                    } catch (_) {}
                }
            }
        });
    });

    // Auto-apply every change immediately
    body.addEventListener('input',  () => applyPropertiesQuiet());
    body.addEventListener('change', () => applyPropertiesQuiet());
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
                <div class="editor-prop-type-badge">${_escHtml(typeLabel)}</div>
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
                <input class="editor-prop-input" type="text" id="prop-animName" value="${item.animationName ?? ''}">
            </div>
        `;
    } else if (arrKey === 'widgets') {
        html += `
            <div class="editor-prop-divider"></div>
            ${_buildWidgetFieldsHTML(item, schemaFields)}
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

function syncPropertiesPosition() {
    const { arrKey, index } = _selectedOverlay || {};
    if (!arrKey) return;
    const item = getOrCreateConfig()?.[arrKey]?.[index];
    if (!item) return;
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
    set('prop-x', Math.round((item.x      ?? 0)   * 100));
    set('prop-y', Math.round((item.y      ?? 0)   * 100));
    set('prop-w', Math.round((item.width  ?? 0.4) * 100));
    set('prop-h', Math.round((item.height ?? 0.3) * 100));
}

function applyPropertiesQuiet() {
    const { arrKey, index, div } = _selectedOverlay || {};
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
        _applyWidgetFieldValues(item);
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
    if (_selectedOverlay?.arrKey === arrKey && _selectedOverlay?.index === index) _selectedOverlay = null;
    cleanupEditOverlays();
    renderEditOverlays();
    updatePropertiesPanel();
}

/* ─── add media ─────────────────────────────────────────────── */

function pickMediaFile(type, accept) {
    _pendingMediaType = type;
    const fi = document.getElementById('edit-media-input');
    if (!fi) return;
    fi.accept = accept;
    fi.value  = '';
    fi.click();
}

async function onMediaFileSelected(fileInput) {
    const file = fileInput.files?.[0];
    if (!file || !_pendingMediaType) return;
    const type = _pendingMediaType;
    _pendingMediaType = null;

    const folder = type === 'model' ? 'models' : type;
    const path   = `${folder}/${file.name}`;
    _state.editorNewFiles[path] = await file.arrayBuffer();
    _state.mediaCache[path]     = URL.createObjectURL(file);

    const arrKey = arrKeyForType(type);
    const cfg    = getOrCreateConfig();
    if (!cfg) return;
    if (!cfg[arrKey]) cfg[arrKey] = [];

    const newItem = { path, x: 0.25, y: 0.25, width: 0.5, height: 0.5, zIndex: 5 };
    if (type === 'video') { newItem.playMode = 'click'; newItem.volume = 1; }
    if (type === 'audio') { newItem.playMode = 'click'; }

    cfg[arrKey].push(newItem);
    const newIndex = cfg[arrKey].length - 1;

    cleanupEditOverlays();
    renderEditOverlays();

    const overlay = document.querySelector(`.edit-overlay[data-arr-key="${arrKey}"][data-item-index="${newIndex}"]`);
    if (overlay) selectOverlayEl(overlay, arrKey, newIndex);
}

async function addWidget() {
    // Toggle: second click closes the modal
    if (document.getElementById('widget-modal-overlay')) {
        document.getElementById('widget-modal-overlay').remove();
        return;
    }

    let widgets = [];
    try {
        const res = await fetch('/api/widgets');
        if (res.ok) widgets = await res.json();
    } catch (e) {
        console.warn('Could not load widget list:', e);
    }

    _showWidgetModal(widgets);
}

function _showWidgetModal(widgets) {
    document.getElementById('widget-modal-overlay')?.remove();

    // Determine which categories actually have widgets (so we don't show empty tabs).
    const usedCats = new Set(widgets.flatMap(f => {
        const type = f.replace(/\.html$/i, '');
        if (WIDGET_HIDDEN.has(type)) return [];
        return [WIDGET_CATEGORIES[type] || 'Other'];
    }));
    const visibleCats = WIDGET_CATEGORY_ORDER.filter(c => usedCats.has(c));

    const overlay = document.createElement('div');
    overlay.id = 'widget-modal-overlay';
    overlay.className = 'widget-modal-overlay';
    overlay.innerHTML = `
        <div class="widget-modal" id="widget-modal">
            <div class="widget-modal-header">
                <h2 class="widget-modal-title">Add Widget</h2>
                <button class="btn widget-modal-close" id="widget-modal-close" title="Close">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
            </div>
            <div class="widget-modal-cats" id="widget-modal-cats">
                <button class="widget-cat-btn is-active" data-cat="all">All</button>
                ${visibleCats.map(c => `<button class="widget-cat-btn" data-cat="${c}">${c}</button>`).join('')}
            </div>
            <div class="widget-modal-search-row">
                <input class="editor-prop-input widget-modal-search" type="search"
                       id="widget-modal-search" placeholder="Search widgets…" autocomplete="off">
            </div>
            <div class="widget-modal-grid" id="widget-modal-grid"></div>
        </div>
    `;
    document.body.appendChild(overlay);

    const grid   = document.getElementById('widget-modal-grid');
    const search = document.getElementById('widget-modal-search');
    let activeCat = 'all';

    const refresh = () => _populateWidgetGrid(grid, widgets, search?.value ?? '', activeCat);
    refresh();

    document.getElementById('widget-modal-cats')?.addEventListener('click', e => {
        const btn = e.target.closest('.widget-cat-btn');
        if (!btn) return;
        activeCat = btn.dataset.cat;
        document.querySelectorAll('#widget-modal-cats .widget-cat-btn').forEach(b =>
            b.classList.toggle('is-active', b === btn));
        refresh();
    });

    search?.addEventListener('input', refresh);

    const close = () => overlay.remove();
    document.getElementById('widget-modal-close')?.addEventListener('click', close);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    const onKey = e => { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); } };
    document.addEventListener('keydown', onKey);

    setTimeout(() => search?.focus(), 40);
}

function _populateWidgetGrid(grid, widgets, filter, category = 'all') {
    grid.innerHTML = '';
    const q = filter.trim().toLowerCase();

    // Custom upload card — shown in All and Other only (no category)
    const showCustom = (category === 'all' || category === 'Other')
        && (!q || 'custom upload html file'.includes(q));
    if (showCustom) {
        grid.appendChild(_makeWidgetCard('__custom__', 'Custom', WIDGET_ICONS.__custom__, true));
    }

    widgets.forEach(filename => {
        const type  = filename.replace(/\.html$/i, '');
        if (WIDGET_HIDDEN.has(type)) return;
        const cat   = WIDGET_CATEGORIES[type] || 'Other';
        if (category !== 'all' && cat !== category) return;
        const label = WIDGET_LABELS[type] || type.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        if (q && !label.toLowerCase().includes(q) && !type.toLowerCase().includes(q)) return;
        grid.appendChild(_makeWidgetCard(type, label, WIDGET_ICONS[type] || WIDGET_ICONS.__default__));
    });
}

function _makeWidgetCard(type, label, iconSvg, isCustom = false) {
    const card = document.createElement('button');
    card.className = 'widget-card' + (isCustom ? ' widget-card--custom' : '');
    card.innerHTML = `<div class="widget-card-icon">${iconSvg}</div><div class="widget-card-label">${label}</div>`;
    card.addEventListener('click', () => {
        document.getElementById('widget-modal-overlay')?.remove();
        if (type === '__custom__') _pickCustomWidget();
        else _doAddWidget(type);
    });
    return card;
}

function _pickCustomWidget() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.html';
    input.addEventListener('change', async () => {
        const file = input.files?.[0];
        if (!file) return;
        const type = file.name.replace(/\.html$/i, '');
        // Blob URL for immediate preview; file stored for ZIP inclusion on save
        const blobUrl = URL.createObjectURL(file);
        _state.editorNewFiles[`widgets/${file.name}`] = await file.arrayBuffer();

        const cfg = getOrCreateConfig();
        if (!cfg) return;
        if (!cfg.widgets) cfg.widgets = [];
        cfg.widgets.push({
            id: `widget_${Date.now()}`,
            type,
            src: blobUrl,
            x: 0.1, y: 0.1,
            width: 0.8, height: 0.8,
            zIndex: 10,
        });
        const newIndex = cfg.widgets.length - 1;
        cleanupEditOverlays();
        renderEditOverlays();
        const ov = document.querySelector(`.edit-overlay[data-arr-key="widgets"][data-item-index="${newIndex}"]`);
        if (ov) selectOverlayEl(ov, 'widgets', newIndex);
    });
    input.click();
}

function _doAddWidget(type) {
    const cfg = getOrCreateConfig();
    if (!cfg) return;
    if (!cfg.widgets) cfg.widgets = [];
    cfg.widgets.push({
        id: `widget_${Date.now()}`,
        type,
        src: '',
        x: 0.1, y: 0.1,
        width: 0.8, height: 0.8,
        zIndex: 10,
        builtin: true,
    });
    const newIndex = cfg.widgets.length - 1;
    cleanupEditOverlays();
    renderEditOverlays();
    const overlay = document.querySelector(`.edit-overlay[data-arr-key="widgets"][data-item-index="${newIndex}"]`);
    if (overlay) selectOverlayEl(overlay, 'widgets', newIndex);
}

/* ─── slide reorder ─────────────────────────────────────────── */

function applySlideReorder() {
    removeSlideReorder();
    const items = document.querySelectorAll('.slide-nav-item');
    items.forEach((item, i) => {
        item.setAttribute('draggable', 'true');

        const onDragStart = (e) => { _dragSrc = i; item.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; };
        const onDragOver  = (e) => {
            e.preventDefault();
            if (_dragSrc === null || _dragSrc === i) return;
            document.querySelectorAll('.slide-nav-item').forEach(el => el.classList.remove('drag-over-before', 'drag-over-after'));
            const rect    = item.getBoundingClientRect();
            const isHoriz = document.body.classList.contains('split-view-active') || window.innerWidth <= 1024;
            item.classList.add(
                (isHoriz ? e.clientX < rect.left + rect.width / 2 : e.clientY < rect.top + rect.height / 2)
                    ? 'drag-over-before' : 'drag-over-after'
            );
            e.dataTransfer.dropEffect = 'move';
        };
        const onDragLeave = () => item.classList.remove('drag-over-before', 'drag-over-after');
        const onDrop = (e) => {
            e.preventDefault();
            if (_dragSrc === null || _dragSrc === i) return;
            const rect    = item.getBoundingClientRect();
            const isHoriz = document.body.classList.contains('split-view-active') || window.innerWidth <= 1024;
            const before  = isHoriz ? e.clientX < rect.left + rect.width / 2 : e.clientY < rect.top + rect.height / 2;
            reorderSlide(_dragSrc, before ? i : i + 1);
            item.classList.remove('drag-over-before', 'drag-over-after');
        };
        const onDragEnd = () => {
            item.classList.remove('dragging');
            document.querySelectorAll('.slide-nav-item').forEach(el => el.classList.remove('drag-over-before', 'drag-over-after'));
            _dragSrc = null;
        };

        item.addEventListener('dragstart', onDragStart);
        item.addEventListener('dragover',  onDragOver);
        item.addEventListener('dragleave', onDragLeave);
        item.addEventListener('drop',      onDrop);
        item.addEventListener('dragend',   onDragEnd);
        _slideReorderListeners.push({ item, onDragStart, onDragOver, onDragLeave, onDrop, onDragEnd });
    });
}

function removeSlideReorder() {
    _slideReorderListeners.forEach(({ item, onDragStart, onDragOver, onDragLeave, onDrop, onDragEnd }) => {
        item.removeAttribute('draggable');
        item.removeEventListener('dragstart', onDragStart);
        item.removeEventListener('dragover',  onDragOver);
        item.removeEventListener('dragleave', onDragLeave);
        item.removeEventListener('drop',      onDrop);
        item.removeEventListener('dragend',   onDragEnd);
    });
    _slideReorderListeners = [];
}

function reorderSlide(fromIndex, insertBefore) {
    if (fromIndex === insertBefore || fromIndex === insertBefore - 1) return;
    const struct   = _state.slideStructure;
    const n        = struct.length;
    const oldAnnot = { ..._state.annotations };

    const [moved] = struct.splice(fromIndex, 1);
    const actualInsert = fromIndex < insertBefore ? insertBefore - 1 : insertBefore;
    struct.splice(actualInsert, 0, moved);

    const oldToNew = new Array(n);
    for (let i = 0; i < n; i++) {
        if (i === fromIndex)                                                  oldToNew[i] = actualInsert;
        else if (fromIndex < insertBefore && i > fromIndex && i < insertBefore) oldToNew[i] = i - 1;
        else if (fromIndex >= insertBefore && i >= insertBefore && i < fromIndex) oldToNew[i] = i + 1;
        else                                                                  oldToNew[i] = i;
    }

    _state.annotations = {};
    for (const [k, v] of Object.entries(oldAnnot)) {
        const newI = oldToNew[parseInt(k)];
        if (newI !== undefined && v) _state.annotations[newI] = v;
    }

    _state.currentSlide = oldToNew[_state.currentSlide] ?? _state.currentSlide;
    _state.totalSlides  = struct.length;
    bus.emit('slides:reordered');
}

/* ─── save ──────────────────────────────────────────────────── */

async function savePresentation() {
    if (!_state.zipFile) {
        window.BeamerModal?.show({ kind: 'error', title: 'Nothing to save', message: 'No presentation loaded.' });
        return;
    }
    const modal = window.BeamerModal;
    modal?.show({ kind: 'loading', title: 'Saving…', message: 'Building ZIP…' });
    try {
        // Flush the current canvas so the latest strokes are captured.
        if (_state.annCvs?.canvas) {
            _state.annotations[_state.currentSlide] = _state.annCvs.canvas.toDataURL('image/png');
        }

        const newZip = new JSZip();

        for (const path of Object.keys(_state.zipFile.files)) {
            const f = _state.zipFile.file(path);
            if (!f || f.dir) continue;
            if (path.startsWith('config/s') && path.endsWith('.json')) continue;
            if (path === 'config/slide-order.json') continue;
            if (path === 'config/annotations.json') continue;
            if (path === 'config/widget-states.json') continue;
            newZip.file(path, await f.async('uint8array'));
        }

        for (const [pi, cfg] of Object.entries(_state.slideConfigs)) {
            if (cfg) newZip.file(`config/s${pi}.json`, JSON.stringify(cfg, null, 2));
        }

        const isDefault = _state.slideStructure.every((obj, i) => obj.type === 'pdf' && obj.pdfIndex === i);
        if (!isDefault) newZip.file('config/slide-order.json', JSON.stringify(_state.slideStructure));

        // Save annotations so pen strokes persist across re-uploads.
        const nonEmptyAnnotations = Object.fromEntries(
            Object.entries(_state.annotations).filter(([, v]) => v && v.length > 100)
        );
        if (Object.keys(nonEmptyAnnotations).length > 0) {
            newZip.file('config/annotations.json', JSON.stringify(nonEmptyAnnotations));
        }

        // Save widget states so interactive widgets resume where they left off.
        const widgetStates = await collectWidgetStates(1500);
        if (Object.keys(widgetStates).length > 0) {
            newZip.file('config/widget-states.json', JSON.stringify(widgetStates));
        }

        for (const [path, buffer] of Object.entries(_state.editorNewFiles)) {
            newZip.file(path, buffer);
        }

        const blob = await newZip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
        const url  = URL.createObjectURL(blob);
        const a    = Object.assign(document.createElement('a'), { href: url, download: 'presentation-edited.zip' });
        a.click();
        URL.revokeObjectURL(url);
        modal?.close();
    } catch (err) {
        modal?.close();
        window.BeamerModal?.show({ kind: 'error', title: 'Save failed', message: err.message });
    }
}
