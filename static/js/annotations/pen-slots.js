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

function _savePenProfiles(profiles) {
    try { localStorage.setItem('beamer-pen-profiles', JSON.stringify(profiles)); } catch {}
}

function _loadPenProfiles() {
    try {
        const saved = JSON.parse(localStorage.getItem('beamer-pen-profiles') || 'null');
        if (Array.isArray(saved) && saved.length > 0) return saved;
    } catch {}
    return null;
}

export function initPenSlots(state) {
    // Load saved profiles (or fall back to defaults) — overrides whatever main.js seeded.
    state.penProfiles = _loadPenProfiles() ?? DEFAULT_PROFILES.map(p => ({ ...p }));

    const container = document.getElementById('pen-slots');
    if (!container) return;

    state.penProfiles.forEach((pen, i) => {
        const btn = document.createElement('button');
        btn.className = 'btn pen-slot-btn tool-btn';
        btn.title = `Pen ${i + 1}`;
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

const _PEN_SVG      = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>`;
const _HIGHLIGHT_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 11-6 6v3h3l6-6"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/></svg>`;

function applyPenStyle(btn, pen, selected) {
    btn.innerHTML = pen.mode === 'highlight' ? _HIGHLIGHT_SVG : _PEN_SVG;
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
                <button class="custom-modal-btn custom-modal-tool-btn${profile.mode === 'draw' ? ' is-selected' : ''}" type="button" data-mode="draw">${_PEN_SVG}</button>
                <button class="custom-modal-btn custom-modal-tool-btn${profile.mode === 'highlight' ? ' is-selected' : ''}" type="button" data-mode="highlight">${_HIGHLIGHT_SVG}</button>
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
                    _savePenProfiles(state.penProfiles);
                    const btn = container.children[index];
                    if (btn) {
                        btn.title = `Pen ${index + 1}`;
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
