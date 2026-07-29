// "Add field" modal for widget config — field name, value type, and a
// type-appropriate value control. Styled with the shared custom-modal-*
// classes so it reads as part of Beamer+ rather than a transplanted form.
import { escAttr, escHtml } from './context.js';
import { WIDGET_RESERVED, CUSTOM_FIELD_TYPES, coerceCustomValue } from './fields.js';

// onAdd({ key, value }) is called once, only if name + value both validate.
// existingKeys is used to reject duplicates before the modal closes.
export function openAddFieldModal({ existingKeys = [], onAdd } = {}) {
    const modal = window.BeamerModal;
    if (!modal) return;

    // Types as a segmented button row (like the pen-settings modal) rather than
    // a <select> — all six are visible at a glance.
    const typeBtns = CUSTOM_FIELD_TYPES.map((t, i) => `
        <button type="button" class="custom-modal-btn custom-modal-tool-btn add-field-type-btn${i === 0 ? ' is-selected' : ''}"
                data-type="${escAttr(t.id)}">${escHtml(t.label)}</button>`).join('');

    const body = document.createElement('div');
    body.className = 'add-field-form';
    body.innerHTML = `
        <div class="custom-modal-setting-group">
            <span class="custom-modal-setting-label">Field name</span>
            <input class="add-field-input" type="text" id="add-field-key"
                   autocomplete="off" spellcheck="false" placeholder="caption">
        </div>
        <div class="custom-modal-setting-group">
            <span class="custom-modal-setting-label">Type</span>
            <div class="custom-modal-button-group add-field-type-row">${typeBtns}</div>
        </div>
        <div class="custom-modal-setting-group">
            <span class="custom-modal-setting-label">Value</span>
            <div id="add-field-value-slot"></div>
        </div>
        <p class="add-field-error" id="add-field-error" hidden></p>
    `;

    const keyEl = body.querySelector('#add-field-key');
    const slot  = body.querySelector('#add-field-value-slot');
    const errEl = body.querySelector('#add-field-error');
    let type    = CUSTOM_FIELD_TYPES[0].id;

    const showError = (msg) => {
        errEl.textContent = msg || '';
        errEl.hidden = !msg;
    };

    // Rebuild the value control whenever the type changes.
    function renderValueControl() {
        if (type === 'boolean') {
            slot.innerHTML = `
                <div class="custom-modal-button-group add-field-bool-row">
                    <button type="button" class="custom-modal-btn custom-modal-tool-btn add-field-bool-btn" data-bool="true">True</button>
                    <button type="button" class="custom-modal-btn custom-modal-tool-btn add-field-bool-btn is-selected" data-bool="false">False</button>
                </div>`;
            slot.querySelectorAll('.add-field-bool-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    slot.querySelectorAll('.add-field-bool-btn')
                        .forEach(b => b.classList.toggle('is-selected', b === btn));
                });
            });
        } else if (type === 'integer' || type === 'float') {
            slot.innerHTML = `<input class="add-field-input" type="number" id="add-field-value"
                                     step="${type === 'integer' ? '1' : 'any'}" value="0">`;
        } else if (type === 'formatted') {
            slot.innerHTML = `<textarea class="add-field-input add-field-textarea" id="add-field-value"
                                        rows="10" spellcheck="false"></textarea>`;
        } else if (type === 'json') {
            slot.innerHTML = `<textarea class="add-field-input add-field-textarea" id="add-field-value"
                                        rows="10" spellcheck="false" placeholder='["a", "b"]'></textarea>`;
        } else {
            slot.innerHTML = `<input class="add-field-input" type="text" id="add-field-value" autocomplete="off">`;
        }
        showError('');
    }

    body.querySelectorAll('.add-field-type-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            type = btn.dataset.type;
            body.querySelectorAll('.add-field-type-btn')
                .forEach(b => b.classList.toggle('is-selected', b === btn));
            renderValueControl();
        });
    });
    renderValueControl();

    // Read the current value control back as a raw string.
    const readRaw = () => {
        if (type === 'boolean') {
            return slot.querySelector('.add-field-bool-btn.is-selected')?.dataset.bool ?? 'false';
        }
        const el = slot.querySelector('#add-field-value');
        // Formatted strings keep their whitespace verbatim.
        return type === 'formatted' ? (el?.value ?? '') : (el?.value ?? '').trim();
    };

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
        const { ok, value, error } = coerceCustomValue(type, readRaw());
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
                label: 'Add field', kind: 'ok', guard,
                onClick: () => { if (guard._result) onAdd?.(guard._result); },
            },
        ],
    });

    keyEl.focus();
}
