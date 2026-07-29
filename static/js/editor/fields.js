// Widget field rows — builds the Properties-panel controls from a widget's
// own schema declaration (<script id="widget-schema">), or falls back to a
// free-form key/value editor for widgets without one, and reads the values
// back into the config item.
import { escAttr, escHtml, fieldId } from './context.js';

// Properties managed by the layout system — never shown as user-editable fields.
export const WIDGET_RESERVED = new Set([
    'id', 'type', 'x', 'y', 'width', 'height', 'zIndex',
    'builtin', 'src', 'interactive',
    'notebookContent', 'role', 'socketUrl',
]);

/* ─── build ─────────────────────────────────────────────────── */

// schemaFields: the .fields array from the widget's own schema declaration,
// or null if the widget has no schema (→ fall back to custom key-value editor).
export function buildWidgetFieldsHTML(item, schemaFields) {
    if (schemaFields === null || schemaFields === undefined) {
        return buildCustomWidgetFieldsHTML(item);
    }
    let html = '';
    for (const field of schemaFields) html += buildOneFieldRow(field, item);
    return html;
}

function buildOneFieldRow(field, item) {
    const fid = 'prop-widget-' + field.key;
    const val = item[field.key];
    const eff = val !== undefined ? val : field.default;
    const notePart = field.note
        ? ` <span class="editor-prop-label-note">${escHtml(field.note)}</span>` : '';

    if (field.type === 'file') {
        const displayName = eff ? String(eff).split('/').pop() : '';
        return `
        <div class="editor-prop-row">
            <div class="editor-prop-label">${escHtml(field.label)}${notePart}</div>
            <div class="editor-prop-file-row">
                <input type="text" class="editor-prop-input" id="${fid}"
                       value="${escAttr(eff ?? '')}" readonly
                       placeholder="No file selected"
                       title="${escAttr(eff ?? '')}">
                <button class="btn editor-prop-file-btn"
                        data-field-key="${escAttr(field.key)}"
                        data-field-id="${fid}"
                        data-accept="${escAttr(field.accept || '*')}"
                        data-folder="${escAttr(field.folder || 'files')}">Upload</button>
            </div>
        </div>`;
    }

    if (field.type === 'checkbox') {
        return `
            <div class="editor-prop-row">
                <label class="editor-prop-checkbox-row">
                    <input type="checkbox" id="${fid}" ${eff === true ? 'checked' : ''}>
                    ${escHtml(field.label)}
                </label>
            </div>`;
    }

    let control = '';
    if (field.type === 'text') {
        control = `<input class="editor-prop-input" type="text" id="${fid}" value="${escAttr(eff ?? '')}" placeholder="${escAttr(field.placeholder || '')}">`;
    } else if (field.type === 'number' || field.type === 'number-nullable') {
        const numVal = (eff === null || eff === undefined) ? '' : eff;
        control = `<input class="editor-prop-input" type="number" id="${fid}"
            value="${escAttr(numVal)}"
            ${field.min  !== undefined ? `min="${field.min}"`   : ''}
            ${field.max  !== undefined ? `max="${field.max}"`   : ''}
            ${field.step !== undefined ? `step="${field.step}"` : ''}
            ${field.placeholder        ? `placeholder="${escAttr(field.placeholder)}"` : ''}>`;
    } else if (field.type === 'select') {
        const opts = field.options.map(o =>
            `<option value="${escAttr(o.v)}" ${eff === o.v ? 'selected' : ''}>${escHtml(o.l)}</option>`
        ).join('');
        control = `<select class="editor-prop-select" id="${fid}">${opts}</select>`;
    } else if (field.type === 'password') {
        control = `<input class="editor-prop-input" type="password" id="${fid}" value="${escAttr(eff ?? '')}" placeholder="${escAttr(field.placeholder || '')}">`;
    } else if (field.type === 'ai-model') {
        control = `<select class="editor-prop-select" id="${fid}" data-ai-model-select="1">
            <option value="${escAttr(eff ?? '')}">${eff ? escHtml(String(eff)) : '— loading… —'}</option>
        </select>`;
    } else if (field.type === 'textarea') {
        control = `<textarea class="editor-prop-input" id="${fid}" rows="${field.rows || 3}" spellcheck="false" placeholder="${escAttr(field.placeholder || '')}">${escHtml(eff ?? '')}</textarea>`;
    } else if (field.type === 'textarea-lines') {
        const text = Array.isArray(eff) ? eff.join('\n') : (eff ?? '');
        control = `<textarea class="editor-prop-input" id="${fid}" rows="${field.rows || 4}" spellcheck="false" placeholder="${escAttr(field.placeholder || '')}">${escHtml(text)}</textarea>`;
    }

    return `
        <div class="editor-prop-row">
            <div class="editor-prop-label">${escHtml(field.label)}${notePart}</div>
            ${control}
        </div>`;
}

/* ─── custom (schema-less) widget fields ────────────────────── */

// The value types a user can pick in the add-field modal. `id` is also what
// gets written to data-custom-type on the rendered row, so applyCustom… knows
// how to read the control back without re-guessing.
export const CUSTOM_FIELD_TYPES = [
    { id: 'string',    label: 'String' },
    { id: 'formatted', label: 'Formatted string (multi-line)' },
    { id: 'integer',   label: 'Integer' },
    { id: 'float',     label: 'Float' },
    { id: 'boolean',   label: 'Boolean' },
    { id: 'json',      label: 'JSON (list / object)' },
];

// Infer which control to render for an existing value. JSON round-trips
// numbers as a single type, so int/float is decided by Number.isInteger.
export function customFieldType(v) {
    if (typeof v === 'boolean') return 'boolean';
    if (typeof v === 'number')  return Number.isInteger(v) ? 'integer' : 'float';
    if (v !== null && typeof v === 'object') return 'json';
    return String(v ?? '').includes('\n') ? 'formatted' : 'string';
}

// Coerce a raw control value into the type the field was declared as.
// Returns { ok, value, error } so the modal can refuse to close on bad input.
export function coerceCustomValue(type, raw) {
    switch (type) {
        case 'boolean':
            return { ok: true, value: raw === true || raw === 'true' };
        case 'integer': {
            const n = parseInt(String(raw).trim(), 10);
            if (isNaN(n)) return { ok: false, error: 'Enter a whole number.' };
            return { ok: true, value: n };
        }
        case 'float': {
            const n = parseFloat(String(raw).trim());
            if (isNaN(n)) return { ok: false, error: 'Enter a number.' };
            return { ok: true, value: n };
        }
        case 'json': {
            const s = String(raw).trim();
            if (s === '') return { ok: false, error: 'Enter some JSON.' };
            try { return { ok: true, value: JSON.parse(s) }; }
            catch (e) { return { ok: false, error: 'Invalid JSON: ' + e.message }; }
        }
        default:
            return { ok: true, value: String(raw ?? '') };
    }
}

function buildCustomWidgetFieldsHTML(item) {
    let html = '';
    const entries = Object.entries(item).filter(([k]) => !WIDGET_RESERVED.has(k));

    if (entries.length === 0) {
        html += `<p class="editor-prop-note">No extra fields yet.</p>`;
    }
    for (const [k, v] of entries) {
        const fid  = fieldId(k);
        const type = customFieldType(v);
        const head = `<div class="editor-prop-row editor-prop-custom-row"
                           data-custom-key="${escAttr(k)}" data-custom-type="${type}">`;
        const rm   = `<button class="editor-prop-rm-field" data-key="${escAttr(k)}" title="Remove field">✕</button>`;

        if (type === 'boolean') {
            html += `${head}
                    <div class="editor-prop-custom-bool-row">
                        <label class="editor-prop-checkbox-row">
                            <input type="checkbox" id="${fid}" ${v ? 'checked' : ''}>
                            <span>${escHtml(k)}</span>
                        </label>
                        ${rm}
                    </div>
                </div>`;
        } else if (type === 'formatted' || type === 'json') {
            const text = type === 'json' ? JSON.stringify(v, null, 2) : String(v ?? '');
            const rows = Math.min(12, Math.max(3, text.split('\n').length + 1));
            html += `${head}
                    <div class="editor-prop-custom-label-row">
                        <div class="editor-prop-label">${escHtml(k)}</div>
                        ${rm}
                    </div>
                    <textarea class="editor-prop-input editor-prop-custom-textarea" id="${fid}"
                              rows="${rows}" spellcheck="false">${escHtml(text)}</textarea>
                </div>`;
        } else {
            const step = type === 'integer' ? '1' : 'any';
            html += `${head}
                    <div class="editor-prop-label">${escHtml(k)}</div>
                    <div class="editor-prop-custom-val-row">
                        <input class="editor-prop-input" id="${fid}"
                               type="${type === 'string' ? 'text' : 'number'}"
                               ${type === 'string' ? '' : `step="${step}"`}
                               value="${escAttr(String(v))}">
                        ${rm}
                    </div>
                </div>`;
        }
    }
    // Add-field UI — opens the typed add-field modal (see add-field-modal.js)
    html += `
        <div class="editor-prop-add-field-block">
            <button class="btn editor-prop-add-field-btn" id="prop-custom-add-btn">+ Add field</button>
        </div>`;
    return html;
}

/* ─── apply (read panel values back into the config item) ───── */

export function applyWidgetFieldValues(item, schemaFields) {
    const get = id => document.getElementById(id);

    if (schemaFields === null || schemaFields === undefined) {
        applyCustomWidgetFieldValues(item);
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

function applyCustomWidgetFieldValues(item) {
    // Clear existing non-reserved keys, then re-populate from visible rows
    for (const k of Object.keys(item)) {
        if (!WIDGET_RESERVED.has(k)) delete item[k];
    }
    document.querySelectorAll('.editor-prop-custom-row').forEach(row => {
        const k = row.dataset.customKey;
        if (!k) return;
        const el = document.getElementById(fieldId(k));
        if (!el) return;
        const type = row.dataset.customType || customFieldType(el.value);

        if (type === 'boolean') {
            item[k] = el.checked;
            return;
        }
        // Formatted strings keep their whitespace verbatim; everything else is trimmed.
        const raw = type === 'formatted' ? el.value : el.value.trim();
        if (raw === '') {
            // Keep the key alive as an empty formatted string; drop otherwise.
            if (type === 'formatted') item[k] = '';
            return;
        }
        const { ok, value } = coerceCustomValue(type, raw);
        if (ok) item[k] = value;
    });
}
