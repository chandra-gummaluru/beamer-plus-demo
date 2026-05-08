// Pen slots — click to select, right-click/long-press to edit.
import { bus } from '../core/events.js';
import { addHoldListener } from '../core/events.js';

const DEFAULT_PROFILES = [
    { mode: 'draw',      color: '#333333', size: 2, label: 'P1' },
    { mode: 'draw',      color: '#e74c3c', size: 2, label: 'P2' },
    { mode: 'highlight', color: '#f1c40f', size: 5, label: 'H1' },
    { mode: 'highlight', color: '#2ecc71', size: 5, label: 'H2' },
    { mode: 'draw',      color: '#3498db', size: 2, label: 'P3' },
];

const PEN_SWATCHES = ['#eeeeee','#e74c3c','#f1c40f','#2ecc71','#3498db','#9b59b6','#333333'];

export function initPenSlots(state) {
    if (!state.penProfiles) state.penProfiles = DEFAULT_PROFILES.map(p => ({ ...p }));

    const container = document.getElementById('pen-slots');
    if (!container) return;

    state.penProfiles.forEach((pen, i) => {
        const btn = document.createElement('button');
        btn.className = 'btn pen-slot-btn tool-btn';
        btn.title = `${pen.label}: ${pen.mode} (${pen.size}px)`;
        applyPenStyle(btn, pen, false);

        let holdFired = false;
        addHoldListener(btn, () => {
            holdFired = true;
            openPenSettings(i, state, container);
        }, 500);

        btn.addEventListener('click', () => {
            if (holdFired) { holdFired = false; return; }
            // Clear selection from all non-pen tool buttons (hand, eraser, etc.)
            document.querySelectorAll('#tool-container .tool-btn:not(.pen-slot-btn)').forEach(b => b.classList.remove('btn_selected'));
            container.querySelectorAll('.pen-slot-btn').forEach(b => b.classList.remove('btn_selected'));
            btn.classList.add('btn_selected');
            applyPenStyle(btn, pen, true);
            state.activePenSlot = i;
            bus.emit('pen:select', { ...pen, slot: i });
        });

        btn.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            openPenSettings(i, state, container);
        });

        container.appendChild(btn);
    });

    // Select first slot
    container.firstElementChild?.click();
}

function applyPenStyle(btn, pen, selected) {
    const iconClass = pen.mode === 'highlight' ? 'fa-highlighter' : 'fa-pen';
    btn.innerHTML = `<i class="fa-solid ${iconClass}"></i>`;
    // Always keep the pen's color on the icon so it's visible selected or not
    btn.style.color = pen.color;
}

function openPenSettings(index, state, container) {
    const profile = state.penProfiles[index];
    if (!profile) return;

    let selMode  = profile.mode;
    let selColor = profile.color;
    let selSize  = profile.size;

    const swatchMarkup = PEN_SWATCHES.map(c =>
        `<button class="custom-modal-pen-swatch${c === profile.color ? ' is-selected' : ''}" type="button" data-color="${c}" style="background:${c};" aria-label="${c}"></button>`
    ).join('');

    const sizeMarkup = [1,2,3,4,5].map(s =>
        `<button class="custom-modal-size-option${s === profile.size ? ' is-selected' : ''}" type="button" data-size="${s}"><span class="custom-modal-size-dot size-${s}"></span></button>`
    ).join('');

    const body = document.createElement('div');
    body.className = 'custom-modal-pen-settings';
    body.innerHTML = `
        <div class="custom-modal-setting-group">
            <div class="custom-modal-setting-label">Style</div>
            <div class="custom-modal-button-group" data-setting="style">
                <button class="custom-modal-btn custom-modal-tool-btn${profile.mode === 'draw' ? ' is-selected' : ''}" type="button" data-mode="draw"><i class="fa-solid fa-pen"></i></button>
                <button class="custom-modal-btn custom-modal-tool-btn${profile.mode === 'highlight' ? ' is-selected' : ''}" type="button" data-mode="highlight"><i class="fa-solid fa-highlighter"></i></button>
            </div>
        </div>
        <div class="custom-modal-setting-group">
            <div class="custom-modal-setting-label">Color</div>
            <div class="custom-modal-swatch-row">${swatchMarkup}</div>
        </div>
        <div class="custom-modal-setting-group">
            <div class="custom-modal-setting-label">Size</div>
            <div class="custom-modal-size-row">${sizeMarkup}</div>
        </div>
    `;

    body.querySelectorAll('[data-mode]').forEach(b => {
        b.addEventListener('click', () => {
            selMode = b.dataset.mode;
            body.querySelectorAll('[data-mode]').forEach(x => x.classList.toggle('is-selected', x.dataset.mode === selMode));
        });
    });
    body.querySelectorAll('[data-color]').forEach(b => {
        b.addEventListener('click', () => {
            selColor = b.dataset.color;
            body.querySelectorAll('[data-color]').forEach(x => x.classList.toggle('is-selected', x.dataset.color === selColor));
        });
    });
    body.querySelectorAll('[data-size]').forEach(b => {
        b.addEventListener('click', () => {
            selSize = Number(b.dataset.size);
            body.querySelectorAll('[data-size]').forEach(x => x.classList.toggle('is-selected', Number(x.dataset.size) === selSize));
        });
    });

    window.BeamerModal?.show({
        kind: 'info',
        title: 'Edit Pen',
        body,
        buttons: [
            { label: 'Cancel', kind: 'cancel' },
            {
                label: 'Save', kind: 'ok',
                onClick() {
                    profile.mode  = selMode;
                    profile.color = selColor;
                    profile.size  = selSize;
                    const btn = container.children[index];
                    if (btn) {
                        btn.title = `${profile.label}: ${profile.mode} (${profile.size}px)`;
                        applyPenStyle(btn, profile, btn.classList.contains('btn_selected'));
                    }
                    if (state.activePenSlot === index) {
                        bus.emit('pen:select', { ...profile, slot: index });
                    }
                },
            },
        ],
    });
}
