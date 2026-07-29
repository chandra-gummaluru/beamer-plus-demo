// "Add field" modal for schema-less widgets — asks for a field name, a value
// type, and then a type-appropriate value control (checkbox-style True/False
// for booleans, number inputs for integer/float, a large textarea for
// formatted strings and JSON).
import { escAttr, escHtml } from './context.js';
import { WIDGET_RESERVED, CUSTOM_FIELD_TYPES, coerceCustomValue } from './fields.js';

// onAdd({ key, value }) is called once, only if name + value both validate.
// existingKeys is used to reject duplicates before the modal closes.
export function openAddFieldModal({ existingKeys = [], onAdd } = {}) {
    const modal = window.BeamerModal;
    if (!modal) return;

    const typeOpts = CUSTOM_FIELD_TYPES
        .map(t => `<option value="${escAttr(t.id)}">${escHtml(t.label)}</option>`).join('');

    const body = document.createElement('div');
    body.className = 'add-field-form';
    body.innerHTML = `
        <label class="add-field-group">
            <span class="add-field-label">Field name</span>
            <input class="editor-prop-input" type="text" id="add-field-key"
                   placeholder="e.g. caption" autocomplete="off" spellcheck="false">
        </label>
        <label class="add-field-group">
            <span class="add-field-label">Type</span>
            <select class="editor-prop-select" id="add-field-type">${typeOpts}</select>
        </label>
        <div class="add-field-group">
            <span class="add-field-label">Value</span>
            <div id="add-field-value-slot"></div>
        </div>
        <p class="add-field-error" id="add-field-error" hidden></p>
    `;

    const keyEl   = body.querySelector('#add-field-key');
    const typeEl  = body.querySelector('#add-field-type');
    const slot    = body.querySelector('#add-field-value-slot');
    const errEl   = body.querySelector('#add-field-error');

    const showError = (msg) => {
        errEl.textContent = msg || '';
        errEl.hidden = !msg;
    };

    // Rebuild the value control whenever the type changes.
    function renderValueControl() {
        const type = typeEl.value;
        if (type === 'boolean') {
            slot.innerHTML = `
                <select class="editor-prop-select" id="add-field-value">
                    <option value="true">True</option>
                    <option value="false" selected>False</option>
                </select>`;
        } else if (type === 'integer' || type === 'float') {
            slot.innerHTML = `<input class="editor-prop-input" type="number" id="add-field-value"
                                     step="${type === 'integer' ? '1' : 'any'}" value="0">`;
        } else if (type === 'formatted') {
            slot.innerHTML = `<textarea class="editor-prop-input add-field-textarea" id="add-field-value"
                                        rows="10" spellcheck="false"
                                        placeholder="Type your formatted text here — newlines are preserved."></textarea>`;
        } else if (type === 'json') {
            slot.innerHTML = `<textarea class="editor-prop-input add-field-textarea" id="add-field-value"
                                        rows="10" spellcheck="false"
                                        placeholder='e.g. ["a", "b"] or { "x": 1 }'></textarea>`;
        } else {
            slot.innerHTML = `<input class="editor-prop-input" type="text" id="add-field-value"
                                     autocomplete="off" placeholder="Value">`;
        }
        showError('');
    }
    typeEl.addEventListener('change', renderValueControl);
    renderValueControl();

    // Validation gate — returning false keeps the modal open.
    const guard = () => {
        const key = keyEl.value.trim();
        if (!key) { showError('Field name is required.'); return false; }
        if (WIDGET_RESERVED.has(key)) {
            showError(`"${key}" is reserved by the layout system.`); return false;
        }
        if (existingKeys.includes(key)) {
            showError(`"${key}" already exists on this widget.`); return false;
        }
        const valEl = slot.querySelector('#add-field-value');
        const raw   = typeEl.value === 'formatted' ? (valEl?.value ?? '') : (valEl?.value ?? '').trim();
        const { ok, value, error } = coerceCustomValue(typeEl.value, raw);
        if (!ok) { showError(error); return false; }
        guard._result = { key, value };
        return true;
    };

    modal.show({
        kind: 'info',
        title: 'Add field',
        body,
        buttons: [
            { label: 'Cancel', kind: 'cancel' },
            {
                label: 'Add', kind: 'ok', guard,
                onClick: () => { if (guard._result) onAdd?.(guard._result); },
            },
        ],
    });

    keyEl.focus();
}
