/**
 * Beamer+ main orchestrator.
 * Wires up socket.io, canvas, and all feature modules.
 */
import { bus, initEvents, addHoldListener } from './core/events.js';
import { initButtons } from './core/button.js';
import { initToggle } from './core/toggle.js';
import { initModal } from './core/modal.js';
import { Canvas } from './core/canvas.js';
import { renderWidgets, cleanupWidgets, updateWidgetPositions,
         parkWidgets, discardParkedWidgets, clearAllParked, setWidgetStates } from './core/iframe-widget-renderer.js';

import { initToolbar } from './annotations/toolbar.js';
import { initPenSlots } from './annotations/pen-slots.js';
import { initShapeTools } from './annotations/shape-tools.js';

import { initNavigator } from './slides/navigator.js';
import { initThumbnails } from './slides/thumbnails.js';
import { initBookmarks } from './slides/bookmarks.js';

import { initUploader } from './upload/uploader.js';
import { initSurveyBridge } from './surveys/survey-bridge.js';
import { initEditor } from './editor/editor.js';
import { startTour } from './tour.js';

/* ─── Render generation counters ─────────────────────────────── */
// Incremented each time a new render starts for each pane.
// Used to detect when a slow earlier render finishes after a faster later
// one has already taken over, so we don't let the stale render overwrite
// the slideKey that the fresh render already committed.
const _renderGen = { L: 0, R: 0 };

/* ─── PWA install prompt ──────────────────────────────────────── */
let _pwaInstallPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    _pwaInstallPrompt = e;
});
window.addEventListener('appinstalled', () => { _pwaInstallPrompt = null; });

/* ─── shared state ────────────────────────────────────────────── */
const state = {
    currentSlide: 0,
    totalSlides: 0,
    bookmarks: {},
    collapsedParents: new Set(),
    splitView: false,
    rightSlideIndex: 0,
    splitRatio: 50,
    annotationTool: 'hand',
    activePenSlot: 0,
    zipFile: null,
    slideStructure: [],
    slideConfigs: {},
    mediaCache: {},
    annotations: {},
    annotationsRight: {},
    availableModels: [],
    annCvs: null,
    pdfCvs: null,
    annCvs2: null,
    pdfCvs2: null,
    slideThumbnailCache: {},
    thumbnailPdfDoc: null,
    _pdfDocPromise: null,   // memoized parse of the current slides.pdf (see getPdfDoc)
    socket: null,
    surveyData: null,
    surveyResults: null,
    surveyResponseCount: 0,
    surveyCountSubscribers: new Set(),
    surveyWidgetSlideIndex: null,
    spotlight: { visible: false, pane: 'left', x: 0.5, y: 0.5 },
    spotlightOverlays: {},
};
window.beamerState = state;

/* ─── bootstrap ───────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
    // splash
    setTimeout(() => {
        const splash = document.getElementById('splash-screen');
        if (splash) { splash.style.opacity = '0'; setTimeout(() => splash.remove(), 400); }
    }, 1600);

    // socket
    state.socket = io();
    state.socket.emit('join_presenter');

    // core
    initEvents(state);
    initModal(state);
    initButtons(state);
    initToggle(state);

    // canvases
    const annContainer  = document.getElementById('ann-canvas');
    const pdfContainer  = document.getElementById('pdf-canvas');
    const annContainer2 = document.getElementById('ann-canvas-2');
    const pdfContainer2 = document.getElementById('pdf-canvas-2');

    state.annCvs = new Canvas(annContainer, true);
    state.pdfCvs = new Canvas(pdfContainer, false);
    state.annCvs.setHistoryChangeHandler(updateHistoryBtns);
    updateHistoryBtns();
    sizeSlideCanvases();   // set pixel-exact 4:3 dimensions before any render

    // modules
    initNavigator(state);
    initThumbnails(state);
    initBookmarks(state);
    initToolbar(state);
    initPenSlots(state);
    initShapeTools(state);
    initUploader(state);
    initSurveyBridge(state);
    initEditor(state);

    // pen + hand defaults
    applyDefaultPen();
    wireHandButton();
    wireEraserButton();
    wireFocusMode();
    wireSplitViewButton(annContainer2, pdfContainer2);
    wireNavButtons();
    wireBookmarkButton();
    wireUndoRedo();
    wireAnnotationClear();
    wireKeyboardNav();
    wireResizeAndFullscreen();
    wireSocketEvents();
    wireSettingsBtn();
    initSpotlight();

    // annotation sync
    state.annCvs.canvas.addEventListener('pointerup', () => syncAnnotations());

    // load available AI models
    fetch('/api/models').then(r => r.json()).then(d => {
        state.availableModels = d.models || [];
    }).catch(() => { state.availableModels = []; });

    // Upload bus handlers
    bus.on('upload:zip', async (file) => {
        const modal = window.BeamerModal;
        modal?.show({ kind: 'loading', title: 'Uploading…', message: 'Parsing ZIP…' });
        try {
            const data = await file.arrayBuffer();
            const zip  = await JSZip.loadAsync(data);
            await uploadZipToServer(zip, modal);
        } catch (err) {
            modal?.close();
            window.BeamerModal?.show({ kind: 'error', title: 'Upload failed', message: err.message });
        }
    });

    bus.on('upload:folder', async (files) => {
        const modal = window.BeamerModal;
        modal?.show({ kind: 'loading', title: 'Uploading folder…', message: 'Zipping files…' });
        try {
            const zip = new JSZip();
            for (const file of files) {
                const rel = file.webkitRelativePath.split('/').slice(1).join('/');
                if (rel) zip.file(rel, await file.arrayBuffer());
            }
            await uploadZipToServer(zip, modal);
        } catch (err) {
            modal?.close();
            window.BeamerModal?.show({ kind: 'error', title: 'Upload failed', message: err.message });
        }
    });

    bus.on('upload:pdf', async (file) => {
        await loadPdfPresentation(file);
    });

    bus.emit('app:ready');
});

async function uploadZipToServer(zip, modal) {
    modal?.show({ kind: 'loading', title: 'Uploading…', message: 'Sending to server…' });
    const blob  = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
    const form  = new FormData();
    form.append('file', blob, 'presentation.zip');
    const resp  = await fetch('/upload', { method: 'POST', body: form });
    if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: 'Server error' }));
        throw new Error(err.error || `HTTP ${resp.status}`);
    }
    const file = new File([blob], 'presentation.zip', { type: 'application/zip' });
    await loadZipPresentation(file);
}

/* ─── history buttons ─────────────────────────────────────────── */
function updateHistoryBtns() {
    const undo = document.getElementById('annotation-undo');
    const redo = document.getElementById('annotation-redo');
    if (undo) undo.disabled = !state.annCvs?.canUndo();
    if (redo) redo.disabled = !state.annCvs?.canRedo();
}

/* ─── keyboard shortcut bindings ──────────────────────────────── */
const DEFAULT_SHORTCUTS = {
    hand:             'h',
    eraser:           'e',
    spotlight:        's',
    bookmark:         'b',
    clearAnnotations: 'c',
    splitView:        'v',
    focusMode:        'f',
    pen1:             '1',
    pen2:             '2',
    pen3:             '3',
    pen4:             '4',
    pen5:             '5',
};

const SHORTCUT_LABELS = {
    hand:             'Hand / pointer',
    eraser:           'Eraser',
    spotlight:        'Spotlight',
    bookmark:         'Bookmark slide',
    clearAnnotations: 'Clear annotations',
    splitView:        'Split view',
    focusMode:        'Focus mode',
    pen1:             'Pen slot 1',
    pen2:             'Pen slot 2',
    pen3:             'Pen slot 3',
    pen4:             'Pen slot 4',
    pen5:             'Pen slot 5',
};

function loadShortcuts() {
    try { return { ...DEFAULT_SHORTCUTS, ...JSON.parse(localStorage.getItem('beamer-shortcuts') || '{}') }; }
    catch { return { ...DEFAULT_SHORTCUTS }; }
}

function saveShortcuts(sc) {
    localStorage.setItem('beamer-shortcuts', JSON.stringify(sc));
}

function applyDefaultPen() {
    const handBtn = document.querySelector('[data-tool="hand"], #hand-btn');
    state.annotationTool = 'hand';
    state.annCvs.setPointerMode('hand');
    setShapeSidebarVisible(false);
    clearToolSelection();
    handBtn?.classList.add('btn_selected');
}

function wireHandButton() {
    const btn = document.querySelector('[data-tool="hand"], #hand-btn');
    if (!btn) return;
    btn.addEventListener('click', () => {
        state.annotationTool = 'hand';
        state.annCvs.setPointerMode('hand');
        setShapeSidebarVisible(false);
        clearToolSelection();
        btn.classList.add('btn_selected');
    });
}

function setWidgetInteractivityForSpotlight(spotlightActive) {
    const widgets = document.querySelectorAll('.widget-iframe');
    widgets.forEach((iframe) => {
        if (spotlightActive) {
            iframe.style.pointerEvents = 'none';
            return;
        }
        const interactive = iframe.dataset.widgetInteractive !== 'false';
        iframe.style.pointerEvents = interactive ? 'auto' : 'none';
    });
}

function wireEraserButton() {
    const btn = document.querySelector('[data-tool="eraser"], #eraser-btn');
    if (!btn) return;
    let held = false;
    addHoldListener(btn, () => {
        held = true;
        state.annCvs.clearAndCommit();
        state.annotations[state.currentSlide] = null;
    }, 550);
    btn.addEventListener('click', () => {
        if (held) { held = false; return; }
        state.annotationTool = 'erase';
        state.annCvs.setPointerMode('erase');
        setShapeSidebarVisible(false);
        clearToolSelection();
        btn.classList.add('btn_selected');
    });
}

function clearToolSelection() {
    document.querySelectorAll('#tool-container .btn').forEach(b => b.classList.remove('btn_selected'));
}

/* bus: pen:select from pen-slots module */
bus.on('pen:select', (pen) => {
    state.annCvs.setPointerMode(pen.mode === 'highlight' ? 'highlight' : 'draw');
    state.annCvs.setStrokeColor(pen.color);
    state.annCvs.setStrokeWidth(pen.size);
    setShapeSidebarVisible(false);
});

/* bus: tool:change from toolbar module */
let _prevTool = 'hand';
bus.on('tool:change', (tool) => {
    if (tool !== 'spotlight') _prevTool = tool;
    state.annotationTool = tool;
    // Map toolbar tool names to canvas pointer modes
    const modeMap = { eraser: 'erase', laser: 'hand', select: 'hand', shape: 'shape', hand: 'hand', spotlight: 'hand' };
    const mode = modeMap[tool] || 'hand';
    state.annCvs.setPointerMode(mode);
    if (tool !== 'shape') setShapeSidebarVisible(false);
    setWidgetInteractivityForSpotlight(tool === 'spotlight');
    if (tool !== 'spotlight') hideSpotlight(true);
});

bus.on('shape:select', (shape) => {
    state.annCvs.setShapeTool(shape);
    state.annCvs.setPointerMode('shape');
});

function setShapeSidebarVisible(visible) {
    const sidebar = document.getElementById('shape-sidebar');
    if (sidebar) sidebar.style.display = visible ? 'flex' : 'none';
    document.body.classList.toggle('shape-tools-visible', visible);
}

/* ─── undo / redo / clear ─────────────────────────────────────── */
function wireUndoRedo() {
    document.getElementById('annotation-undo')?.addEventListener('click', async () => {
        await state.annCvs.undo();
        syncAnnotations();
        updateHistoryBtns();
    });
    document.getElementById('annotation-redo')?.addEventListener('click', async () => {
        await state.annCvs.redo();
        syncAnnotations();
        updateHistoryBtns();
    });
}

function wireAnnotationClear() {
    document.getElementById('annotation-clear-btn')?.addEventListener('click', () => {
        state.annCvs.clearAndCommit();
        state.annotations[state.currentSlide] = null;
    });
}

/* ─── keyboard navigation ─────────────────────────────────────── */
function wireKeyboardNav() {
    document.addEventListener('keydown', (e) => {
        if (e.target.matches('input,textarea,[contenteditable]')) return;

        // Fixed: undo / redo
        if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
            e.preventDefault();
            document.getElementById('annotation-undo')?.click();
            return;
        }
        if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
            e.preventDefault();
            document.getElementById('annotation-redo')?.click();
            return;
        }
        if (e.ctrlKey || e.metaKey || e.altKey) return;

        // Fixed: navigation & escape
        if (e.key === 'ArrowLeft'  || e.key === 'PageUp')  goToSlide(state.currentSlide - 1, 'back');
        if (e.key === 'ArrowRight' || e.key === 'PageDown') goToSlide(state.currentSlide + 1, 'forward');
        if (e.key === 'Escape') { bus.emit('ui:escape'); BeamerModal?.close(); }

        // Configurable shortcuts
        const sc = loadShortcuts();
        if (e.key === sc.hand)             document.querySelector('[data-tool="hand"], #hand-btn')?.click();
        if (e.key === sc.eraser)           document.querySelector('[data-tool="eraser"]')?.click();
        if (e.key === sc.spotlight)        document.querySelector('[data-tool="spotlight"], #spotlight-btn')?.click();
        if (e.key === sc.bookmark)         toggleBookmark(state.currentSlide);
        if (e.key === sc.clearAnnotations) document.getElementById('annotation-clear-btn')?.click();
        if (e.key === sc.splitView)        document.getElementById('split-toggle')?.click();
        if (e.key === sc.focusMode)        toggleFocusMode();
        [sc.pen1, sc.pen2, sc.pen3, sc.pen4, sc.pen5].forEach((key, i) => {
            if (key && e.key === key) document.querySelectorAll('#pen-slots .pen-slot-btn')[i]?.click();
        });
    });
}

/* ─── settings modal (theme + editable shortcuts) ─────────────── */
function applyTheme(theme) {
    localStorage.setItem('beamer-theme', theme);
    const html = document.documentElement;
    if (theme === 'dark') {
        html.setAttribute('data-theme', 'dark');
    } else {
        // 'light' or any legacy value (e.g. 'system') → light
        html.removeAttribute('data-theme');
    }
}

const NON_BINDABLE = new Set([
    'Tab','Enter','Backspace','Delete','Escape',
    'ArrowLeft','ArrowRight','ArrowUp','ArrowDown','PageUp','PageDown','Home','End',
    'Control','Meta','Alt','Shift','CapsLock',
    'F1','F2','F3','F4','F5','F6','F7','F8','F9','F10','F11','F12',
]);

function _hasShortcutConflicts(sc) {
    const vals = Object.values(sc).filter(v => v);
    return vals.length !== new Set(vals).size;
}

function _updateShortcutConflicts(scGrid, sc, hintEl) {
    const counts = {};
    for (const key of Object.values(sc)) {
        if (key) counts[key] = (counts[key] || 0) + 1;
    }
    const hasConflicts = Object.values(counts).some(c => c > 1);
    scGrid.querySelectorAll('.shortcut-capture').forEach(inp => {
        const key = sc[inp.dataset.action];
        inp.classList.toggle('is-error', !!(key && counts[key] > 1));
    });
    if (hintEl) {
        if (hasConflicts) {
            hintEl.textContent = 'Duplicate keys: resolve all conflicts to close.';
            hintEl.classList.add('is-error');
        } else {
            hintEl.textContent = 'Click a key to rebind it.';
            hintEl.classList.remove('is-error');
        }
    }
}

const _SUN_SVG  = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><line x1="12" y1="2" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="22"/><line x1="4.22" y1="4.22" x2="6.34" y2="6.34"/><line x1="17.66" y1="17.66" x2="19.78" y2="19.78"/><line x1="2" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="22" y2="12"/><line x1="4.22" y1="19.78" x2="6.34" y2="17.66"/><line x1="17.66" y1="6.34" x2="19.78" y2="4.22"/></svg>`;
const _MOON_SVG = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`;

function showSettingsModal() {
    const rawTheme = localStorage.getItem('beamer-theme') || 'light';
    // Treat legacy 'system' as 'light'
    const savedTheme = (rawTheme === 'dark') ? 'dark' : 'light';
    const sc = loadShortcuts();

    const body = document.createElement('div');
    body.className = 'settings-grid';

    // ── Theme ──────────────────────────────────────────────────
    const themeLabel = document.createElement('div');
    themeLabel.className = 'settings-label settings-label-center';
    themeLabel.textContent = 'Theme';
    body.appendChild(themeLabel);

    const themeRow = document.createElement('div');
    themeRow.className = 'settings-theme-row';
    [{ value: 'light', label: 'Light', svg: _SUN_SVG }, { value: 'dark', label: 'Dark', svg: _MOON_SVG }].forEach(({ value, label, svg }) => {
        const btn = document.createElement('button');
        btn.className = 'btn settings-theme-btn' + (savedTheme === value ? ' btn_selected' : '');
        btn.title = label;
        btn.innerHTML = svg;
        btn.addEventListener('click', () => {
            applyTheme(value);
            themeRow.querySelectorAll('.btn').forEach(b => b.classList.remove('btn_selected'));
            btn.classList.add('btn_selected');
        });
        themeRow.appendChild(btn);
    });
    body.appendChild(themeRow);

    // ── Keyboard Shortcuts ─────────────────────────────────────
    const scSection = document.createElement('div');
    scSection.className = 'settings-section';

    const scLabel = document.createElement('div');
    scLabel.className = 'settings-label settings-label-center';
    scLabel.textContent = 'Keyboard Shortcuts';
    scSection.appendChild(scLabel);

    // Hint + reset on one line
    const scHintRow = document.createElement('div');
    scHintRow.className = 'settings-hint-row';

    const scHint = document.createElement('p');
    scHint.className = 'settings-shortcut-hint';
    scHint.textContent = 'Click a key to rebind it.';
    scHintRow.appendChild(scHint);

    const resetBtn = document.createElement('button');
    resetBtn.className = 'settings-shortcuts-reset-btn';
    resetBtn.textContent = 'Reset defaults';
    resetBtn.addEventListener('click', () => {
        Object.assign(sc, DEFAULT_SHORTCUTS);
        saveShortcuts(sc);
        scGrid.querySelectorAll('.shortcut-capture').forEach((inp, i) => {
            inp.value = DEFAULT_SHORTCUTS[Object.keys(SHORTCUT_LABELS)[i]] ?? '';
        });
        _updateShortcutConflicts(scGrid, sc, scHint);
    });
    scHintRow.appendChild(resetBtn);
    scSection.appendChild(scHintRow);

    const scGrid = document.createElement('div');
    scGrid.className = 'settings-shortcuts-grid';

    Object.entries(SHORTCUT_LABELS).forEach(([action, labelText]) => {
        const labelEl = document.createElement('span');
        labelEl.className = 'settings-shortcut-label';
        labelEl.textContent = labelText;
        scGrid.appendChild(labelEl);

        const input = document.createElement('input');
        input.type = 'text';
        input.readOnly = true;
        input.className = 'shortcut-capture';
        input.dataset.action = action;
        input.value = sc[action] ?? DEFAULT_SHORTCUTS[action] ?? '';
        input.title = 'Click to rebind';

        input.addEventListener('focus', () => {
            input.dataset.prev = input.value;
            input.value = '';
            input.placeholder = '…';
            input.classList.add('capturing');
        });
        input.addEventListener('keydown', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (e.key === 'Escape') { input.value = input.dataset.prev ?? ''; input.blur(); return; }
            if (e.ctrlKey || e.metaKey || e.altKey) { input.blur(); return; }
            if (NON_BINDABLE.has(e.key)) { input.blur(); return; }
            input.value = e.key;
            sc[action] = e.key;
            _updateShortcutConflicts(scGrid, sc, scHint);
            input.blur();
        });
        input.addEventListener('blur', () => {
            input.classList.remove('capturing');
            input.placeholder = '';
            if (!input.value) input.value = input.dataset.prev ?? '';
        });

        scGrid.appendChild(input);
    });
    scSection.appendChild(scGrid);

    body.appendChild(scSection);

    // ── Install App ────────────────────────────────────────────────
    const _isStandalone = window.matchMedia('(display-mode: standalone)').matches
        || window.navigator.standalone === true;
    if (!_isStandalone) {
        const installSection = document.createElement('div');
        installSection.className = 'settings-section';

        const installLabel = document.createElement('div');
        installLabel.className = 'settings-label settings-label-center';
        installLabel.textContent = 'Install App';
        installSection.appendChild(installLabel);

        const installBtn = document.createElement('button');
        installBtn.className = 'btn settings-install-btn';

        const _DL_ICON = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`;

        installBtn.innerHTML = _DL_ICON;
        installBtn.title = _pwaInstallPrompt ? 'Install as App' : 'Add to home screen from your browser menu';
        if (_pwaInstallPrompt) {
            installBtn.addEventListener('click', async () => {
                _pwaInstallPrompt.prompt();
                const { outcome } = await _pwaInstallPrompt.userChoice;
                if (outcome === 'accepted') _pwaInstallPrompt = null;
                window.BeamerModal?.close();
            });
        } else {
            installBtn.disabled = true;
        }

        installSection.appendChild(installBtn);
        body.appendChild(installSection);
    }

    window.BeamerModal?.show({
        kind: 'info',
        title: 'Settings',
        body,
        canClose: () => !_hasShortcutConflicts(sc),
        buttons: [
            {
                label: 'Cancel',
                kind: 'cancel',
                onClick: () => applyTheme(savedTheme),
            },
            {
                label: 'Save',
                kind: 'ok',
                guard: () => !_hasShortcutConflicts(sc),
                onClick: () => saveShortcuts(sc),
            },
        ],
    });
}

function wireSettingsBtn() {
    document.getElementById('settings-btn')?.addEventListener('click', showSettingsModal);
    document.getElementById('help-btn')?.addEventListener('click', showHelpModal);
    document.getElementById('tour-btn')?.addEventListener('click', () => {
        const loader = state.zipFile ? null : async () => {
            window.BeamerModal?.show({ kind: 'loading', title: 'Loading demo…', message: 'Fetching demo presentation…' });
            const resp = await fetch('/api/demo-zip');
            if (!resp.ok) { window.BeamerModal?.close(); return; }
            const blob = await resp.blob();
            await loadZipPresentation(new File([blob], 'demo.zip', { type: 'application/zip' }));
        };
        startTour(loader);
    });
    applyTheme(localStorage.getItem('beamer-theme') || 'light');
}

/* ─── Help modal ──────────────────────────────────────────── */

function _hic(s) { return `<code class="help-ic">${s}</code>`; }

// Small inline icon chip matching the actual button SVGs in the UI
const _HELP_ICONS = {
    upload:    `<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>`,
    download:  `<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>`,
    edit:      `<path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>`,
    split:     `<rect x="2" y="3" width="20" height="18" rx="2"/><line x1="12" y1="3" x2="12" y2="21"/>`,
    focus:     `<polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/>`,
    bookmark:  `<path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>`,
    hand:      `<path d="M18 11V6a2 2 0 0 0-2-2 2 2 0 0 0-2 2"/><path d="M14 10V4a2 2 0 0 0-2-2 2 2 0 0 0-2 2v2"/><path d="M10 10.5V6a2 2 0 0 0-2-2 2 2 0 0 0-2 2v8"/><path d="M18 11a2 2 0 1 1 4 0v3a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/>`,
    spotlight: `<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>`,
    pen:       `<path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.586 7.586"/><circle cx="11" cy="11" r="2"/>`,
    eraser:    `<path d="M7 21h10"/><path d="m5 11 9-9 6 6-9 9H5z"/>`,
    video:     `<polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>`,
    audio:     `<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>`,
    model3d:   `<path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>`,
    widget:    `<rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/>`,
};
function _hbtn(key, label) {
    return `<span class="help-btn-ref" title="${label}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${_HELP_ICONS[key]}</svg></span>`;
}

function showHelpModal() {
    const sections = [
        {
            id: 'start', label: 'Getting Started',
            html: `
<h4 class="help-h">Loading a presentation</h4>
<p class="help-p">Click the upload button ${_hbtn('upload','Upload')} in the top-right corner. You can load two types of file:</p>
<ul class="help-ul">
  <li>Your bare slide deck (as a PDF). Once loaded you can annotate it and place interactive widgets on any slide.</li>
  <li>A saved Beamer+ presentation (as a ZIP) that bundles the PDF together with all your widgets, overlays, and annotations. To create one, start from a bare slide deck, edit it in Beamer+, then click the download button ${_hbtn('download','Save & download')}. Beamer+ packages everything into a ZIP you can reload later.</li>
</ul>`,
        },
        {
            id: 'present', label: 'Presenting',
            html: `
<h4 class="help-h">Navigating slides</h4>
<ul class="help-ul">
  <li>Press ${_hic('←')} ${_hic('→')} or click any slide in the left navigator.</li>
<li>Bookmark a slide with the ${_hbtn('bookmark','Bookmark')} button at the bottom of the navigator. Bookmarked slides get a pin so you can jump to them instantly.</li>
</ul>
<h4 class="help-h">Split view</h4>
<p class="help-p">Click ${_hbtn('split','Split view')} at the top of the navigator to display two slides side by side, handy for comparing pages or keeping a reference slide visible while you present another.</p>
<h4 class="help-h">Focus mode</h4>
<p class="help-p">Click ${_hbtn('focus','Focus mode')} in the top-right to hide all UI and show only the slide. Press ${_hic('Esc')} to exit.</p>
<h4 class="help-h">Annotation tools</h4>
<p class="help-p">The floating toolbar on the left lets you draw directly on slides. Annotations are saved per slide.</p>
<ul class="help-ul">
  <li>${_hbtn('hand','Hand')} <strong>Hand</strong>: default mode, no drawing.</li>
  <li>${_hbtn('spotlight','Spotlight')} <strong>Spotlight</strong>: dims the slide and highlights your cursor position.</li>
  <li>${_hbtn('pen','Pen')} <strong>Pen</strong>: freehand drawing. Click the pen icon again to change colour and size.</li>
  <li>${_hbtn('eraser','Eraser')} <strong>Eraser</strong>: erase individual strokes.</li>
</ul>`,
        },
        {
            id: 'edit', label: 'Editing',
            html: `
<h4 class="help-h">Entering edit mode</h4>
<p class="help-p">Click the edit button ${_hbtn('edit','Edit mode')} in the top-right corner. A panel opens on the right where you can select, configure, and delete anything on the current slide.</p>
<h4 class="help-h">Adding overlays</h4>
<p class="help-p">The buttons at the bottom of the editor panel let you add content on top of your slides:</p>
<ul class="help-ul">
  <li>${_hbtn('video','Add video')} <strong>Video</strong>: overlay a video player.</li>
  <li>${_hbtn('audio','Add audio')} <strong>Audio</strong>: overlay an audio clip.</li>
  <li>${_hbtn('model3d','Add 3D model')} <strong>3D Model</strong>: embed a rotatable ${_hic('.glb')} or ${_hic('.gltf')} model.</li>
  <li>${_hbtn('widget','Add widget')} <strong>Widget</strong>: add an interactive widget (see the Widgets section).</li>
</ul>
<h4 class="help-h">Moving &amp; resizing</h4>
<p class="help-p">Drag any overlay to reposition it, or drag its bottom-right corner to resize. The Properties panel shows exact position, size, and layer controls.</p>
<h4 class="help-h">Saving your work</h4>
<p class="help-p">Click ${_hbtn('download','Save & download')} to save your presentation. All overlays, widgets, and annotations are included.</p>`,
        },
        {
            id: 'widgets', label: 'Widgets',
            html: `
<h4 class="help-h">What is a widget?</h4>
<p class="help-p">Widgets are interactive tools that live directly on your slides: live polls, coding environments, timers, and more.</p>
<h4 class="help-h">Adding a widget</h4>
<p class="help-p">In edit mode, click ${_hbtn('widget','Add widget')} at the bottom of the panel. Beamer+ comes with a built-in library to get you started, and you can also create your own custom widgets (see below).</p>
<hr class="help-divider">
<h4 class="help-h">Building a custom widget</h4>
<p class="help-p">A widget is a single self-contained ${_hic('.html')} file. Beamer+ loads it in an isolated iframe and handles the rest: persistence, resizing, and state saving.</p>
<h4 class="help-h">1 · Declare editable properties</h4>
<p class="help-p">Put a schema block at the top of ${_hic('&lt;head&gt;')}. Beamer+ reads it to render your widget's fields in the Properties panel automatically:</p>
<code class="help-code">&lt;script id="widget-schema" type="application/json"&gt;
{
  "label": "My Widget",
  "category": "Tools",
  "fields": [
    { "key": "title",   "label": "Title",      "type": "text",     "placeholder": "Hello" },
    { "key": "count",   "label": "Count",      "type": "number",   "min": 1, "step": 1 },
    { "key": "autorun", "label": "Auto-start", "type": "checkbox", "default": false }
  ]
}
&lt;/script&gt;</code>
<p class="help-p">Supported types: ${_hic('text')}, ${_hic('number')}, ${_hic('checkbox')}, ${_hic('select')}, ${_hic('textarea')}.</p>
<h4 class="help-h">2 · Read configuration</h4>
<p class="help-p">Beamer+ injects ${_hic('window.WIDGET_CONFIG')} before your widget loads. It contains the field values the presenter set, plus layout info:</p>
<code class="help-code">const cfg = window.WIDGET_CONFIG || {};
// cfg.title, cfg.count, cfg.autorun  ← your declared fields
// cfg.role  →  'presenter' or 'viewer'</code>
<h4 class="help-h">3 · Communicate with Beamer+</h4>
<dl class="help-kv">
  <dt>widget-expand</dt><dd>Post to <code class="help-ic">window.parent</code> to animate the widget to full-slide size.</dd>
  <dt>widget-collapse</dt><dd>Return to the original size.</dd>
  <dt>widget-get-state</dt><dd>Received when navigating away. Reply with a ${_hic('widget-state')} message containing serialisable state.</dd>
  <dt>widget-set-state</dt><dd>Received when returning to the slide. Restore your UI from the saved state.</dd>
  <dt>widget-cleanup</dt><dd>Received when the widget is removed. Stop timers and release resources.</dd>
</dl>
<h4 class="help-h">4 · Shared styles</h4>
<p class="help-p">Every widget automatically inherits Beamer+'s design tokens, with no setup needed:</p>
<code class="help-code">var(--bg)        var(--text)      var(--border)
var(--accent)    var(--font-ui)   var(--font-mono)
var(--radius)    /* …and more */</code>
<p class="help-p">Your own ${_hic(':root')} block overrides any token you want to customise.</p>`,
        },
    ];

    const wrap = document.createElement('div');
    wrap.className = 'help-modal-wrap';

    const nav = document.createElement('nav');
    nav.className = 'help-modal-nav';
    nav.setAttribute('aria-label', 'Help sections');

    const pane = document.createElement('div');
    pane.className = 'help-modal-pane';

    sections.forEach((s, i) => {
        const btn = document.createElement('button');
        btn.className = 'help-modal-nav-btn' + (i === 0 ? ' active' : '');
        btn.textContent = s.label;
        btn.addEventListener('click', () => {
            nav.querySelectorAll('.help-modal-nav-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            pane.querySelectorAll('.help-section').forEach(sec => sec.classList.remove('active'));
            document.getElementById('help-sec-' + s.id)?.classList.add('active');
        });
        nav.appendChild(btn);

        const sec = document.createElement('div');
        sec.className = 'help-section' + (i === 0 ? ' active' : '');
        sec.id = 'help-sec-' + s.id;
        sec.innerHTML = s.html;
        pane.appendChild(sec);
    });

    wrap.appendChild(nav);
    wrap.appendChild(pane);

    window.BeamerModal?.show({
        kind: 'info',
        title: 'Usage Guide',
        body: wrap,
        buttons: [{ label: 'Done', kind: 'ok' }],
    });

    // Widen the modal card for this documentation layout
    window.BeamerModal?.open
        ?.querySelector('.custom-modal-content')
        ?.classList.add('help-modal-content');
}

/* ─── nav prev/next buttons ───────────────────────────────────── */
function wireNavButtons() {
    document.getElementById('prev-btn')?.addEventListener('click', () => goToSlide(state.currentSlide - 1, 'back'));
    document.getElementById('next-btn')?.addEventListener('click', () => goToSlide(state.currentSlide + 1, 'forward'));
}

/* ─── bookmark button ─────────────────────────────────────────── */
function wireBookmarkButton() {
    document.getElementById('bookmark-btn')?.addEventListener('click', () => {
        toggleBookmark(state.currentSlide);
    });
}

function toggleBookmark(i) {
    if (state.bookmarks[i]) delete state.bookmarks[i];
    else state.bookmarks[i] = true;
    bus.emit('bookmarks:changed', state.bookmarks);
    populateBookmarkPins();
}

/* ─── focus mode ─────────────────────────────────────────────── */
function toggleFocusMode() {
    document.body.classList.toggle('focus-mode');
    // Trigger canvas resize so annotations stay aligned with the new layout
    setTimeout(() => {
        sizeSlideCanvases();
        state.annCvs?.resizeOnly?.();
        state.pdfCvs?.resizeOnly?.();
        if (state.splitView) {
            state.annCvs2?.resizeOnly?.();
            state.pdfCvs2?.resizeOnly?.();
        }
    }, 300); // wait for CSS transition to finish
}

function wireFocusMode() {
    // No button — feature is keyboard-only (configurable shortcut + Escape to exit).
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && document.body.classList.contains('focus-mode')) {
            toggleFocusMode();
        }
    });
}

/* ─── split-view ──────────────────────────────────────────────── */
function wireSplitViewButton(annContainer2, pdfContainer2) {
    const btn = document.getElementById('split-toggle');
    if (!btn) return;
    btn.addEventListener('click', async () => {
        const enteringSplit = !state.splitView;
        // Save before setSplitActive — resizeOnly() inside it clears the canvas
        saveCurrentAnnotations();
        // Show overlay(s) immediately before any layout work
        _slideOverlay(false)?.classList.add('visible');
        if (enteringSplit) _slideOverlay(true)?.classList.add('visible');
        await setSplitActive(enteringSplit);
        if (state.zipFile) {
            if (state.splitView) {
                await renderSplitSlides(state.currentSlide, state.rightSlideIndex);
            } else {
                await renderLogicalSlide(state.currentSlide);
            }
        } else {
            _slideOverlay(false)?.classList.remove('visible');
            _slideOverlay(true)?.classList.remove('visible');
        }
    });

    // Divider dragging for resizing — pointer events so touch works too
    const divider = document.getElementById('split-view-divider');
    let isDragging = false;

    function _onDividerDragEnd() {
        const wasDragging = isDragging;
        isDragging = false;
        divider.classList.remove('active');
        // Re-render both panes after divider resize — only if we were actually dragging
        if (wasDragging && state.splitView) {
            setTimeout(async () => {
                saveCurrentAnnotations();
                state.annCvs.resizeOnly?.();
                state.annCvs2?.resizeOnly?.();
                updateWidgetPositions(document.getElementById('pdf-canvas'));
                updateWidgetPositions(document.getElementById('pdf-canvas-2'));
                updateMediaPositions(document.getElementById('pdf-canvas'));
                updateMediaPositions(document.getElementById('pdf-canvas-2'));
                await renderSplitSlides(state.currentSlide, state.rightSlideIndex);
            }, 50);
        }
    }

    if (divider) {
        divider.addEventListener('pointerdown', (e) => {
            if (state.editMode) return;   // locked in edit mode; slider controls ratio instead
            isDragging = true;
            divider.classList.add('active');
            // Capture keeps pointermove/pointerup firing on this element even
            // after the pointer leaves it, which is essential for touch drag.
            divider.setPointerCapture(e.pointerId);
        });

        divider.addEventListener('pointermove', (e) => {
            if (!isDragging) return;
            const mainContent = document.getElementById('main-content');
            const leftContainer = document.getElementById('pdf-container');
            const rightContainer = document.getElementById('pdf-container-2');
            if (!mainContent || !leftContainer || !rightContainer) return;

            const rect = mainContent.getBoundingClientRect();
            const newLeftPercent = ((e.clientX - rect.left) / rect.width) * 100;
            applySplitRatio(newLeftPercent);
            // Recompute 4:3 canvas sizes now that the containers have new widths.
            sizeSlideCanvases();
        });

        divider.addEventListener('pointerup',     _onDividerDragEnd);
        divider.addEventListener('pointercancel', _onDividerDragEnd);
    }

    // Horizontal scroll on wheel in split view
    document.getElementById('slide-navigator')?.addEventListener('wheel', (e) => {
        if (!state.splitView) return;
        const scroller = document.getElementById('slide-nav-slides');
        if (!scroller) return;
        const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
        if (delta === 0) return;
        e.preventDefault();
        scroller.scrollLeft += delta;
    }, { passive: false });
}

function getSplitRatioBounds() {
    const mainContent = document.getElementById('main-content');
    if (!mainContent) return { min: 20, max: 80 };
    const rect = mainContent.getBoundingClientRect();
    const totalWidth  = rect.width;
    const totalHeight = rect.height;
    if (!totalWidth || !totalHeight) return { min: 20, max: 80 };
    // Compute the widest a single pane can be while keeping height as the
    // binding 4:3 constraint (so the full slide height remains visible).
    const maxContainerWidth = totalHeight * (4 / 3);
    const maxPercent = (maxContainerWidth / totalWidth) * 100;
    const min = Math.max(100 - maxPercent, 20);
    const max = Math.min(maxPercent, 80);
    if (min > max) return { min: 50, max: 50 };
    return { min, max };
}

function applySplitRatio(ratioPercent) {
    const leftContainer = document.getElementById('pdf-container');
    const rightContainer = document.getElementById('pdf-container-2');
    if (!leftContainer || !rightContainer) return state.splitRatio;

    const bounds = getSplitRatioBounds();
    const clamped = Math.max(bounds.min, Math.min(bounds.max, ratioPercent));
    state.splitRatio = clamped;
    leftContainer.style.flex = `1 1 ${clamped}%`;
    rightContainer.style.flex = `1 1 ${100 - clamped}%`;
    return clamped;
}

/* ─── slide navigation ────────────────────────────────────────── */
bus.on('slide:goto', (i) => goToSlide(i));
bus.on('slide:next', () => goToSlide(state.currentSlide + 1, 'forward'));
bus.on('slide:prev', () => goToSlide(state.currentSlide - 1, 'back'));
bus.on('slide:goto-right', async (i) => {
    if (!state.splitView || i === state.currentSlide) return;
    saveCurrentAnnotations();
    _slideOverlay(true)?.classList.add('visible');
    state.rightSlideIndex = i;
    await renderLogicalSlide(i, true);
    updateSlideNavigator();
    bus.emit('slide:changed', state.currentSlide);
});

async function goToSlide(i, direction = null, isSplitPaneNav = false) {
    if (i < 0 || i >= state.slideStructure.length) return;
    hideSpotlight(true);

    // Presentation-mode sequential nav from within split view:
    //   forward → exit split, show right pane slide full-screen
    //   backward → exit split, show left pane slide (currentSlide) full-screen
    // This gives the reversible flow: A → [split A|B] → B → [back] → [split A|B] → A
    if (!isSplitPaneNav && !state.editMode && state.splitView && direction !== null) {
        const targetIdx = direction === 'forward' ? state.rightSlideIndex : state.currentSlide;
        await setSplitActive(false);
        // Pass direction so the hidden-slide while loop runs in the recursive call.
        // Forward: skips right-pane if hidden, continues to next visible slide.
        // Back: skips left-pane if hidden, continues to previous visible slide.
        await goToSlide(targetIdx, direction, false);
        return;
    }

    // When already inside a split view, skip view slides (to avoid re-triggering
    // the same split view and getting stuck).  When not in split view, allow
    // sequential nav to land on a view slide so the split activates normally.
    // Always skip hidden slides regardless of edit mode — hidden slides are still
    // reachable via direct thumbnail clicks (direction === null bypasses this loop).
    // Direct jumps (direction === null) bypass this entirely.
    if (direction !== null) {
        const step = direction === 'forward' ? 1 : -1;
        while ((state.slideStructure[i]?.type === 'view' && state.splitView) ||
               state.slideStructure[i]?.hidden) {
            i += step;
            if (i < 0 || i >= state.slideStructure.length) return;
        }
    }

    // View slides: activate their pre-configured split layout, then navigate to the left slide.
    // Works in both presentation mode and edit mode (edit mode also shows the split for preview).
    const prelimObj = state.slideStructure[i];
    if (prelimObj?.type === 'view') {
        const leftIdx  = Math.max(0, Math.min(state.slideStructure.length - 1, prelimObj.left  ?? 0));
        const rightIdx = Math.max(0, Math.min(state.slideStructure.length - 1, prelimObj.right ?? 0));
        saveCurrentAnnotations();
        const previewRatio = state.editMode ? 50 : (prelimObj.ratio ?? null);
        if (leftIdx !== rightIdx) await setSplitActive(true, rightIdx, previewRatio);
        await goToSlide(leftIdx, null, true);  // isSplitPaneNav — skip auto-close
        return;
    }

    // Show overlay(s) immediately — before any async config loading or layout work
    _slideOverlay(false)?.classList.add('visible');
    if (state.splitView) _slideOverlay(true)?.classList.add('visible');

    // Capture right-pane index before any layout changes so we can detect if it shifted.
    const prevRightIndex = state.rightSlideIndex;

    // Save annotations before any canvas-clearing layout changes
    saveCurrentAnnotations();

    // Edit mode: if split view is active and we're navigating to a slide that
    // isn't a pane of the currently displayed view, close split view NOW — before
    // any canvas sizing or rendering — so the new slide renders at full-width
    // dimensions. Skip this when called internally from the view-slide handler
    // (isSplitPaneNav = true) so we don't immediately undo the split activation.
    if (!isSplitPaneNav && state.editMode && state.splitView && i !== state.rightSlideIndex) {
        await setSplitActive(false);
    }

    state.currentSlide = i;
    const obj = state.slideStructure[i];
    if (obj?.type === 'blank') state.collapsedParents.delete(obj.parent);

    if (state.splitView) {
        const rightChanged = state.rightSlideIndex !== prevRightIndex;
        if (rightChanged) {
            // Both panes need re-rendering
            await renderSplitSlides(i, state.rightSlideIndex);
        } else {
            // Only left pane changed — render it alone and hide its overlay
            _slideOverlay(true)?.classList.remove('visible');
            await renderLogicalSlide(i, false);
        }
    } else {
        await renderLogicalSlide(i);
    }
    updateSlideNavigator();
    updateBlankSlideButtons();
    bus.emit('slide:changed', i);
}

async function setSplitActive(active, rightIndex = null, splitRatio = null) {
    const annContainer2 = document.getElementById('ann-canvas-2');
    const pdfContainer2 = document.getElementById('pdf-canvas-2');
    const btn           = document.getElementById('split-toggle');

    if (active === state.splitView && (rightIndex === null || rightIndex === state.rightSlideIndex)) return;

    state.splitView = active;
    document.body.classList.toggle('split-view-active', active);
    if (btn) btn.classList.toggle('btn_selected', active);

    // Block edit-mode, save, and upload while split view is active so the user
    // can't enter edit mode or change the presentation mid-split.
    // edit-mode-btn is exempted when already in edit mode — it becomes the close
    // button and must stay enabled so the user can exit edit mode.
    for (const id of ['edit-save-btn', 'upload-presentation-btn']) {
        const el = document.getElementById(id);
        if (el) el.disabled = active;
    }
    const editBtn = document.getElementById('edit-mode-btn');
    if (editBtn && !state.editMode) editBtn.disabled = active;

    if (active) {
        if (!state.annCvs2) {
            state.annCvs2 = new Canvas(annContainer2, true);
            state.pdfCvs2 = new Canvas(pdfContainer2, false);
            state.annCvs2.setPointerMode('hand');
        }
        state.rightSlideIndex = rightIndex ?? Math.min(state.currentSlide + 1, state.slideStructure.length - 1);
        applySplitRatio(splitRatio ?? state.splitRatio);
    }

    await new Promise(resolve => setTimeout(resolve, 100));
    sizeSlideCanvases(); // recompute 4:3 sizes for the new split / single layout
    state.annCvs.resizeOnly?.();
    state.pdfCvs.resizeOnly?.();
    if (state.annCvs2) state.annCvs2.resizeOnly?.();
    if (state.pdfCvs2) state.pdfCvs2.resizeOnly?.();

    // Render right pane AFTER the canvas resize — resizeOnly() clears canvas
    // dimensions so any render done before it would be wiped. This is the reason
    // the right slide sometimes appeared blank on first load.
    if (active) await renderLogicalSlide(state.rightSlideIndex, true);

    populateSlideNavigator();
}

function updateSlideNavigator() {
    document.querySelectorAll('.slide-nav-item').forEach((el, idx) => {
        el.classList.toggle('active',          idx === state.currentSlide);
        el.classList.toggle('current-slide',   idx === state.currentSlide);
        el.classList.toggle('bookmarked',      !!state.bookmarks[idx]);
        el.classList.toggle('type-view',        state.slideStructure[idx]?.type === 'view');
        el.classList.toggle('is-right-slide',  state.splitView && idx === state.rightSlideIndex);
        el.classList.toggle('is-hidden-slide', !!state.slideStructure[idx]?.hidden);

        const leftZone  = el.querySelector('.slide-split-zone--left');
        const rightZone = el.querySelector('.slide-split-zone--right');
        if (leftZone && rightZone) {
            // Active = this slide is currently assigned to that pane
            leftZone.classList.toggle('is-active',   state.splitView && idx === state.currentSlide);
            rightZone.classList.toggle('is-active',  state.splitView && idx === state.rightSlideIndex);
            // Disabled = placing this slide on that pane would duplicate across both panes
            leftZone.classList.toggle('is-disabled',  state.splitView && idx === state.rightSlideIndex && idx !== state.currentSlide);
            rightZone.classList.toggle('is-disabled', state.splitView && idx === state.currentSlide   && idx !== state.rightSlideIndex);
        }

        // Clear any legacy inline styles
        el.style.pointerEvents = '';
        el.style.opacity = '';
    });
}

function updateBlankSlideButtons() {
    const obj = state.slideStructure[state.currentSlide];
    const addBtn  = document.getElementById('add-blank-btn');
    const delBtn  = document.getElementById('delete-blank-btn');
    if (delBtn) {
        const isBlank = obj?.type === 'blank';
        delBtn.disabled = !isBlank;
        delBtn.style.opacity = isBlank ? '1' : '0.5';
    }
}

/* ─── slide rendering ─────────────────────────────────────────── */
function _slideOverlay(isRight) {
    const id = isRight ? 'pdf-container-2' : 'pdf-container';
    return document.getElementById(id)?.querySelector('.slide-loading-overlay') ?? null;
}

async function renderSplitSlides(leftIdx, rightIdx) {
    const lo = _slideOverlay(false);
    const ro = _slideOverlay(true);
    lo?.classList.add('visible');
    ro?.classList.add('visible');
    await Promise.all([
        renderLogicalSlide(leftIdx,  false, true),
        renderLogicalSlide(rightIdx, true,  true),
    ]);
    lo?.classList.remove('visible');
    ro?.classList.remove('visible');
}

// forceRefresh=true discards any parked widgets for this slide so editor
// changes (add/remove/modify widgets) take effect on re-render.
async function renderLogicalSlide(logicalIndex, isRight = false, suppressOverlay = false, forceRefresh = false) {
    const obj = state.slideStructure[logicalIndex];
    if (!obj) return;

    // Stamp a generation token so we can detect if a newer render supersedes
    // this one before we finish (fast tab-switching race condition).
    const paneKey = isRight ? 'R' : 'L';
    const myGen = ++_renderGen[paneKey];

    const slideContainer = isRight
        ? document.getElementById('pdf-canvas-2')
        : document.getElementById('pdf-canvas');
    const annContainer = isRight
        ? document.getElementById('ann-canvas-2')
        : document.getElementById('ann-canvas');
    const cvs    = isRight ? state.pdfCvs2 : state.pdfCvs;
    const annCvs = isRight ? state.annCvs2 : state.annCvs;
    const annotsMap = state.annotations;

    if (!cvs || !annCvs) return;

    // ── Park widgets from the slide currently in this container ───────────
    const newSlideKey = (isRight ? 'R' : 'L') + logicalIndex;
    const prevSlideKey = slideContainer?.dataset?.slideKey;
    if (slideContainer && prevSlideKey != null) {
        parkWidgets(slideContainer, prevSlideKey);
        // Remove non-widget media from the old slide
        slideContainer.querySelectorAll('video,audio,model-viewer').forEach(el => el.remove());
    }
    // After editor changes, kill parked widgets so fresh iframes are created
    if (forceRefresh) discardParkedWidgets(newSlideKey);

    const loading = suppressOverlay ? null : _slideOverlay(isRight);
    if (loading) loading.classList.add('visible');

    if (obj.type === 'pdf') {
        if (cvs.canvas) cvs.canvas.style.visibility = 'visible';
        if (annContainer) annContainer.style.background = '';
        await renderPdfSlide(obj.pdfIndex, logicalIndex, isRight, newSlideKey);
    } else if (obj.type === 'blank') {
        if (cvs.canvas) cvs.canvas.style.visibility = 'hidden';
        annCvs.clear();
        if (annotsMap[logicalIndex]) {
            await annCvs.loadAnnotations(annotsMap[logicalIndex]);
        } else {
            annCvs.resetHistory?.();
        }
        if (annContainer) annContainer.style.background = '';
        if (obj.blankId) {
            const blankCfg = await loadBlankConfig(obj.blankId);
            if (blankCfg && slideContainer) {
                const rect = slideContainer.getBoundingClientRect();
                await renderMedia(blankCfg, slideContainer, rect, isRight, newSlideKey);
            }
        }
    }

    // Only record which slide this container is showing if this render is
    // still the latest one for this pane — a faster later render may have
    // already written a newer key, and we must not overwrite it.
    if (myGen === _renderGen[paneKey] && slideContainer) {
        slideContainer.dataset.slideKey = newSlideKey;
    }

    if (loading) loading.classList.remove('visible');
    updateHistoryBtns();
}

async function renderPdfSlide(pdfIndex, logicalIndex, isRight = false, slideKey = null) {
    if (!state.zipFile) return;

    const pdfDoc = await getPdfDoc();
    if (!pdfDoc) { console.error('No slides.pdf in ZIP'); return; }
    const page = await pdfDoc.getPage(pdfIndex + 1);

    // Bail out if the slide at this logical index has changed (e.g. a blank
    // was inserted here) or if the user navigated away while we were loading.
    const latestObj = state.slideStructure[logicalIndex];
    if (!isRight && (!latestObj || latestObj.type !== 'pdf' || latestObj.pdfIndex !== pdfIndex || state.currentSlide !== logicalIndex)) return;

    const cvs    = isRight ? state.pdfCvs2 : state.pdfCvs;
    const annCvs = isRight ? state.annCvs2 : state.annCvs;
    const annotsMap = state.annotations;
    const container = isRight
        ? document.getElementById('pdf-canvas-2')
        : document.getElementById('pdf-canvas');

    await cvs.renderPDFPage(page);

    annCvs.clear();
    if (annotsMap[logicalIndex ?? state.currentSlide]) {
        await annCvs.loadAnnotations(annotsMap[logicalIndex ?? state.currentSlide]);
    } else {
        annCvs.resetHistory?.();
    }

    const config = await loadSlideConfig(pdfIndex);
    if (!config) return;

    const rect = container.getBoundingClientRect();
    await renderMedia(config, container, rect, isRight, slideKey);
}

async function renderMedia(config, container, rect, isRight, slideKey = null) {
    if (config.videos) {
        for (const [videoIndex, v] of config.videos.entries()) {
            const url = await loadMedia(v.path);
            if (!url) continue;
            const video = document.createElement('video');
            const baseVideoId = v.id ?? `video-${videoIndex}`;
            video.src = url;
            video.volume = v.volume ?? 1;
            video.className = 'slide-video';
            video.disablePictureInPicture = true;
            Object.assign(video.dataset, { videoX: v.x, videoY: v.y, videoWidth: v.width, videoHeight: v.height, videoZIndex: v.zIndex ?? 5, videoId: baseVideoId + (isRight ? '-r' : '') });
            Object.assign(video.style, { position:'absolute', left:`${v.x*rect.width}px`, top:`${v.y*rect.height}px`, width:`${v.width*rect.width}px`, height:`${v.height*rect.height}px`, objectFit:'contain', zIndex: v.zIndex ?? 5, transition:'left 0.45s ease, top 0.45s ease, width 0.45s ease, height 0.45s ease' });
            if (v.playMode === 'once' || v.playMode === 'auto') { video.autoplay = true; video.muted = true; }
            if (v.playMode === 'loop') { video.autoplay = true; video.loop = true; video.muted = true; }
            if (v.playMode === 'manual') { video.controls = true; }
            // Expand-on-play: after expandDelay seconds the video grows to fill
            // the slide, then snaps back to its placed size when paused/ended.
            let _expandTimer = null;
            function _expandVideo() {
                const cr = container.getBoundingClientRect();
                Object.assign(video.style, { left: '0px', top: '0px', width: `${cr.width}px`, height: `${cr.height}px`, zIndex: '500' });
            }
            function _collapseVideo() {
                clearTimeout(_expandTimer); _expandTimer = null;
                const cr = container.getBoundingClientRect();
                const vz = video.dataset.videoZIndex;
                Object.assign(video.style, { left: `${v.x*cr.width}px`, top: `${v.y*cr.height}px`, width: `${v.width*cr.width}px`, height: `${v.height*cr.height}px`, zIndex: vz });
            }
            video.addEventListener('play', () => {
                if (!isRight && v.expandDelay != null && _expandTimer === null) {
                    _expandTimer = setTimeout(_expandVideo, v.expandDelay * 1000);
                }
            });
            video.addEventListener('pause', () => {
                if (!isRight && v.expandDelay != null) _collapseVideo();
            });
            video.addEventListener('ended', () => {
                if (!isRight && v.expandDelay != null) _collapseVideo();
            });
            video.addEventListener('click', (e) => { video.paused ? video.play() : video.pause(); e.stopPropagation(); });
            container.appendChild(video);
        }
    }
    if (config.audios) {
        for (const a of config.audios) {
            const url = await loadMedia(a.path);
            if (!url) continue;
            const audio = document.createElement('audio');
            audio.src = url;
            audio.className = 'slide-audio';
            if (a.playMode === 'auto')  { audio.autoplay = true; }
            if (a.playMode === 'loop')  { audio.autoplay = true; audio.loop = true; }
            audio.controls = (a.playMode !== 'auto' && a.playMode !== 'loop');
            Object.assign(audio.dataset, { audioX: a.x ?? 0.1, audioY: a.y ?? 0.1, audioWidth: a.width ?? 0.4 });
            Object.assign(audio.style, {
                position: 'absolute',
                left:   `${(a.x ?? 0.1) * rect.width}px`,
                top:    `${(a.y ?? 0.1) * rect.height}px`,
                width:  `${(a.width ?? 0.4) * rect.width}px`,
                height: '40px',
                zIndex: a.zIndex ?? 5,
            });
            container.appendChild(audio);
        }
    }
    if (config.models) {
        for (const m of config.models) {
            const url = await loadMedia(m.path);
            if (!url) continue;
            const mv = document.createElement('model-viewer');
            mv.src = url; mv.alt = m.alt ?? '3D model';
            mv.setAttribute('camera-controls', ''); mv.setAttribute('shadow-intensity', '1');
            if (m.autoRotate) mv.setAttribute('auto-rotate', '');
            if (m.animate !== false) mv.setAttribute('autoplay', '');
            if (m.animationName) mv.setAttribute('animation-name', m.animationName);
            Object.assign(mv.dataset, { modelId: m.id, mediaX: m.x, mediaY: m.y, mediaWidth: m.width, mediaHeight: m.height });
            Object.assign(mv.style, { position:'absolute', left:`${m.x*rect.width}px`, top:`${m.y*rect.height}px`, width:`${m.width*rect.width}px`, height:`${m.height*rect.height}px`, zIndex: m.zIndex ?? 5 });
            mv.style.setProperty('--progress-bar-height', '0px');
            const progressBarSlot = document.createElement('div');
            progressBarSlot.slot = 'progress-bar';
            mv.appendChild(progressBarSlot);
            container.appendChild(mv);
        }
    }
    if (config.widgets) {
        await renderWidgets(config, container, state.zipFile, false, slideKey);
        setWidgetInteractivityForSpotlight(state.annotationTool === 'spotlight');
    }
}

/* ─── media reposition after resize ──────────────────────────── */
function updateMediaPositions(container) {
    if (!container) return;
    const rect = container.getBoundingClientRect();
    // Videos
    container.querySelectorAll('.slide-video').forEach(el => {
        const x = parseFloat(el.dataset.videoX);
        const y = parseFloat(el.dataset.videoY);
        const w = parseFloat(el.dataset.videoWidth);
        const h = parseFloat(el.dataset.videoHeight);
        if (![x, y, w, h].some(isNaN)) {
            el.style.left   = `${x * rect.width}px`;
            el.style.top    = `${y * rect.height}px`;
            el.style.width  = `${w * rect.width}px`;
            el.style.height = `${h * rect.height}px`;
        }
    });
    // Audio players
    container.querySelectorAll('.slide-audio').forEach(el => {
        const x = parseFloat(el.dataset.audioX);
        const y = parseFloat(el.dataset.audioY);
        const w = parseFloat(el.dataset.audioWidth);
        if (![x, y, w].some(isNaN)) {
            el.style.left  = `${x * rect.width}px`;
            el.style.top   = `${y * rect.height}px`;
            el.style.width = `${w * rect.width}px`;
        }
    });
    // 3D model viewers
    container.querySelectorAll('model-viewer').forEach(el => {
        const x = parseFloat(el.dataset.mediaX);
        const y = parseFloat(el.dataset.mediaY);
        const w = parseFloat(el.dataset.mediaWidth);
        const h = parseFloat(el.dataset.mediaHeight);
        if (![x, y, w, h].some(isNaN)) {
            el.style.left   = `${x * rect.width}px`;
            el.style.top    = `${y * rect.height}px`;
            el.style.width  = `${w * rect.width}px`;
            el.style.height = `${h * rect.height}px`;
        }
    });
}

/* ─── slide config / media cache ─────────────────────────────── */

// Resolve a pdfIndex reference (used in onEnter.split / onLeave.goToSlide) to
// the corresponding slideStructure position.  Blank slides inserted by the user
// shift positions but never change pdfIndex values, so this keeps config
// cross-references stable regardless of how many blank slides exist.
function resolvePdfRef(pdfIndex) {
    const idx = state.slideStructure.findIndex(s => s.type === 'pdf' && s.pdfIndex === pdfIndex);
    return idx === -1 ? null : idx;
}

async function loadSlideConfig(pdfIndex) {
    if (state.slideConfigs[pdfIndex]) return state.slideConfigs[pdfIndex];
    try {
        const f = state.zipFile.file(`config/s${pdfIndex}.json`);
        if (!f) return null;
        state.slideConfigs[pdfIndex] = JSON.parse(await f.async('string'));
    } catch (e) { state.slideConfigs[pdfIndex] = null; }
    return state.slideConfigs[pdfIndex];
}

// Load config for a blank slide (keyed by blankId string).
// In-session the config lives in state.slideConfigs[blankId]; after save+reload
// it is read from config/s<blankId>.json inside the ZIP.
async function loadBlankConfig(blankId) {
    if (state.slideConfigs[blankId] !== undefined) return state.slideConfigs[blankId] || null;
    try {
        const f = state.zipFile?.file(`config/s${blankId}.json`);
        if (!f) { state.slideConfigs[blankId] = null; return null; }
        state.slideConfigs[blankId] = JSON.parse(await f.async('string'));
    } catch { state.slideConfigs[blankId] = null; }
    return state.slideConfigs[blankId];
}

async function loadMedia(path) {
    if (state.mediaCache[path]) return state.mediaCache[path];
    const f = state.zipFile?.file(path);
    if (!f) return null;
    const url = URL.createObjectURL(await f.async('blob'));
    state.mediaCache[path] = url;
    return url;
}

// Parse slides.pdf once per presentation and reuse the PDFDocument for every
// slide render and for thumbnail generation. We memoize the *promise* (not just
// the resolved doc) so the parallel left/right renders in split view share a
// single parse instead of each decoding the whole file. Reset to null whenever
// a new presentation is loaded.
function getPdfDoc() {
    if (state._pdfDocPromise) return state._pdfDocPromise;
    const pdfFile = state.zipFile?.file('slides.pdf');
    if (!pdfFile) return Promise.resolve(null);
    state._pdfDocPromise = pdfFile.async('arraybuffer')
        .then(data => pdfjsLib.getDocument({ data }).promise);
    return state._pdfDocPromise;
}

/* ─── annotation persistence ──────────────────────────────────── */
// Stash the current canvas into state.annotations so strokes survive
// navigating away and back (and get bundled into the saved ZIP).
let annotationSyncTimer = null;
function syncAnnotations() {
    clearTimeout(annotationSyncTimer);
    const idx = state.currentSlide;
    annotationSyncTimer = setTimeout(() => {
        state.annotations[idx] = state.annCvs.canvas.toDataURL('image/png');
    }, 100);
}

function saveCurrentAnnotations() {
    clearTimeout(annotationSyncTimer);
    if (!state.annCvs) return;
    state.annotations[state.currentSlide] = state.annCvs.canvas.toDataURL('image/png');
    // Also save the right pane when in split view
    if (state.splitView && state.annCvs2) {
        state.annotations[state.rightSlideIndex] = state.annCvs2.canvas.toDataURL('image/png');
    }
}

/* ─── populate slide navigator ────────────────────────────────── */
function populateSlideNavigator() {
    const labels = getSlideLabels(state.slideStructure);
    bus.emit('slides:loaded', state.slideStructure.map((obj, i) => {
        const base = {
            kind:     obj.type,
            label:    labels[i],
            title:    obj.type === 'blank' ? labels[i] : `Slide ${labels[i]}`,
            thumbUrl: obj.type === 'pdf'   ? (state.slideThumbnailCache[obj.pdfIndex] ?? null) : null,
        };
        if (obj.type === 'view') {
            base.viewLeft      = obj.left  ?? 0;
            base.viewRight     = obj.right ?? 0;
            base.viewRatio     = obj.ratio ?? 50;
            base.viewLeftLabel  = labels[obj.left]  ?? String((obj.left  ?? 0) + 1);
            base.viewRightLabel = labels[obj.right] ?? String((obj.right ?? 0) + 1);
        }
        return base;
    }));
    updateSlideNavigator();
}

bus.on('nav:refresh', () => populateSlideNavigator());

// Live divider-position preview while the slider is being dragged.
// Only adjusts CSS flex proportions — does NOT resize canvas pixel dimensions,
// so the existing rendered slide content stays visible (stretched slightly by CSS).
bus.on('view:set-ratio', (ratio) => {
    if (!state.splitView) return;
    applySplitRatio(ratio);
    updateWidgetPositions(document.getElementById('pdf-canvas'));
    updateWidgetPositions(document.getElementById('pdf-canvas-2'));
    updateMediaPositions(document.getElementById('pdf-canvas'));
    updateMediaPositions(document.getElementById('pdf-canvas-2'));
});

// Full resize + re-render committed when the slider is released.
bus.on('view:ratio-commit', async (ratio) => {
    if (!state.splitView) return;
    applySplitRatio(ratio);
    sizeSlideCanvases();
    state.annCvs.resizeOnly?.();
    state.annCvs2?.resizeOnly?.();
    state.pdfCvs.resizeOnly?.();
    state.pdfCvs2?.resizeOnly?.();
    await renderSplitSlides(state.currentSlide, state.rightSlideIndex);
    updateWidgetPositions(document.getElementById('pdf-canvas'));
    updateWidgetPositions(document.getElementById('pdf-canvas-2'));
    updateMediaPositions(document.getElementById('pdf-canvas'));
    updateMediaPositions(document.getElementById('pdf-canvas-2'));
});

/* ─── slide label helper ──────────────────────────────────────── */
function getSlideLabels(structure) {
    const labels = [];
    let pdfCount = 0;
    let blankCount = 0;
    for (const obj of structure) {
        if (obj.type !== 'blank' && obj.type !== 'view') {
            pdfCount++;
            blankCount = 0;
            labels.push(String(pdfCount));
        } else {
            blankCount++;
            const suffix = blankCount <= 26
                ? String.fromCharCode(96 + blankCount)
                : String(blankCount);
            labels.push(`${pdfCount}${suffix}`);
        }
    }
    return labels;
}

function populateBookmarkPins() {
    const pins = document.getElementById('bookmark-pins');
    if (!pins) return;
    pins.innerHTML = '';
    const indices = Object.keys(state.bookmarks).map(Number).filter(i => i >= 0 && i < state.slideStructure.length).sort((a, b) => a - b);
    pins.style.display = indices.length ? 'flex' : 'none';
    const labels = getSlideLabels(state.slideStructure);
    indices.forEach(i => {
        const item = document.createElement('div');
        item.className = 'slide-nav-item bookmarked';
        if (state.slideStructure[i]?.type === 'blank') item.classList.add('slide-nav-child');
        const preview = document.createElement('div');
        preview.className = 'slide-preview bookmark-preview';
        const lbl = labels[i] || String(i + 1);
        preview.dataset.slideNumber = lbl;
        if (state.slideThumbnailCache[i]) {
            const img = document.createElement('img'); img.src = state.slideThumbnailCache[i]; preview.appendChild(img);
        } else {
            const span = document.createElement('span'); span.textContent = `Slide ${lbl}`; preview.appendChild(span);
        }
        item.appendChild(preview);
        item.addEventListener('click', () => goToSlide(i));
        pins.appendChild(item);
    });
}

/* ─── blank / view slide management ──────────────────────────── */
document.getElementById('add-blank-btn')?.addEventListener('click', () => insertBlankAfterCurrent());
document.getElementById('add-view-btn')?.addEventListener('click',  () => insertViewAfterCurrent());
document.getElementById('delete-blank-btn')?.addEventListener('click', () => deleteCurrentBlank());

// Keeps every view slide's left/right pane indices consistent after an insertion (+1)
// or deletion (-1) at position `atIdx`.  Called whenever any slide is added or removed.
function adjustViewIndices(atIdx, delta) {
    for (const obj of state.slideStructure) {
        if (obj.type !== 'view') continue;
        if (obj.left  !== undefined && obj.left  >= atIdx) obj.left  += delta;
        if (obj.right !== undefined && obj.right >= atIdx) obj.right += delta;
    }
}

// Shift structure-index-keyed maps (annotations, bookmarks) after an insert (+1) or
// delete (-1) at `atIdx`.  For deletions the entry at the removed index is dropped.
function _shiftIndexedMap(map, atIdx, delta) {
    const out = {};
    for (const [key, val] of Object.entries(map)) {
        const k = parseInt(key, 10);
        if (delta < 0 && k === atIdx) continue;   // deleted slot — discard its data
        out[k >= atIdx ? k + delta : k] = val;
    }
    return out;
}
function shiftSlideData(atIdx, delta) {
    state.annotations = _shiftIndexedMap(state.annotations, atIdx, delta);
    state.bookmarks   = _shiftIndexedMap(state.bookmarks,   atIdx, delta);
}

function insertBlankAfterCurrent() {
    const ins = state.currentSlide + 1;
    const blankId = `b${Date.now()}`;
    adjustViewIndices(ins, +1);
    shiftSlideData(ins, +1);
    state.slideStructure.splice(ins, 0, { type: 'blank', blankId, parent: null });
    goToSlide(ins);
    populateSlideNavigator();
}

function insertViewAfterCurrent() {
    const ins    = state.currentSlide + 1;
    const viewId = `v${Date.now()}`;

    adjustViewIndices(ins, +1);
    shiftSlideData(ins, +1);

    // Splice first so we can compute post-splice indices correctly.
    state.slideStructure.splice(ins, 0, { type: 'view', viewId, left: 0, right: 0, ratio: 50 });

    // Left pane: current slide (unchanged after splice).
    // Right pane: the slide immediately after the view slide (ins+1), i.e. the
    // old "next slide" which is now labelled e.g. 7b after the view slide 7a.
    const leftDef  = state.currentSlide;
    const len      = state.slideStructure.length;
    const rightDef = ins + 1 < len ? ins + 1
                   : Math.max(0, leftDef - 1);

    state.slideStructure[ins].left  = leftDef;
    state.slideStructure[ins].right = rightDef;

    populateSlideNavigator();
    if (state.editMode) bus.emit('view:select', ins);
}

function deleteCurrentBlank() {
    const obj = state.slideStructure[state.currentSlide];
    if (obj?.type !== 'blank') return;
    const del = state.currentSlide;
    state.slideStructure.splice(del, 1);
    state.totalSlides = state.slideStructure.length;
    adjustViewIndices(del, -1);          // fix view slides after deletion
    const next = Math.min(del, state.slideStructure.length - 1);
    state.currentSlide = next;
    goToSlide(next);
    populateSlideNavigator();
}

/* ─── slide-canvas sizing ─────────────────────────────────────── */
/**
 * Compute a pixel-exact 4:3 size fitting within 95 % of each slide
 * container and apply it as inline styles to the canvas wrapper divs,
 * their annotation overlays, and the loading-overlay elements.
 *
 * Called on init, window resize, focus-mode toggle, and split-view
 * toggle so the ratio is always correct on every device / orientation.
 */
function sizeSlideCanvases() {
    const pairs = [
        ['pdf-container',   'pdf-canvas',   'ann-canvas'],
        ['pdf-container-2', 'pdf-canvas-2', 'ann-canvas-2'],
    ];
    for (const [containerId, cvId, annId] of pairs) {
        const pane = document.getElementById(containerId);
        const cv   = document.getElementById(cvId);
        const ann  = document.getElementById(annId);
        if (!pane || !cv) continue;
        const availW = pane.clientWidth  * 0.95;
        const availH = pane.clientHeight * 0.95;
        if (!availW || !availH) continue;
        let w, h;
        if (availW / availH >= 4 / 3) {
            h = availH; w = h * 4 / 3;   // height is the binding axis
        } else {
            w = availW; h = w * 3 / 4;   // width is the binding axis
        }
        cv.style.width  = `${w}px`;
        cv.style.height = `${h}px`;
        if (ann) { ann.style.width = `${w}px`; ann.style.height = `${h}px`; }
        const overlay = pane.querySelector('.slide-loading-overlay');
        if (overlay) { overlay.style.width = `${w}px`; overlay.style.height = `${h}px`; }
    }
}

/* ─── resize / fullscreen ─────────────────────────────────────── */
function wireResizeAndFullscreen() {
    window.addEventListener('resize', () => {
        sizeSlideCanvases();
        state.annCvs?.resize?.();
        if (state.splitView) state.annCvs2?.resize?.();
        if (state.splitView) applySplitRatio(state.splitRatio);
        if (state.zipFile && state.slideConfigs[state.currentSlide]) {
            updateWidgetPositions(document.getElementById('pdf-canvas'));
        }
    });
    document.addEventListener('fullscreenchange', () => {
        setTimeout(() => {
            sizeSlideCanvases();
            state.annCvs?.resize?.();
            if (state.splitView) applySplitRatio(state.splitRatio);
            if (state.zipFile && state.slideConfigs[state.currentSlide]) {
                updateWidgetPositions(document.getElementById('pdf-canvas'));
            }
            renderSpotlight();
        }, 100);
    });
}

/* ─── spotlight tool ─────────────────────────────────────────── */
function initSpotlight() {
    ensureSpotlightOverlay('left');
    ensureSpotlightOverlay('right');

    document.addEventListener('pointermove', (event) => {
        if (state.annotationTool !== 'spotlight') return;
        const pane = getSpotlightPaneFromPoint(event.clientX, event.clientY);
        if (!pane) {
            hideSpotlight(true);
            return;
        }

        const paneName = pane.id === 'pdf-container-2' ? 'right' : 'left';
        const rect = pane.getBoundingClientRect();
        if (!rect.width || !rect.height) return;

        state.spotlight = {
            visible: true,
            pane: paneName,
            x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
            y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
        };

        renderSpotlight();
    }, true);

    document.addEventListener('pointerleave', () => {
        if (state.annotationTool === 'spotlight') hideSpotlight(true);
    });

    document.addEventListener('click', (event) => {
        if (state.annotationTool !== 'spotlight') return;
        // Restore the previous tool
        const prev = _prevTool || 'hand';
        const btn = document.querySelector(`#tool-container .tool-btn[data-tool="${prev}"]`);
        document.querySelectorAll('#tool-container .tool-btn').forEach(b => b.classList.remove('btn_selected'));
        if (btn) btn.classList.add('btn_selected');
        bus.emit('tool:change', prev);
    }, true);
}

function getSpotlightPaneFromPoint(clientX, clientY) {
    const rightCanvas = document.getElementById('pdf-canvas-2');
    if (state.splitView && rightCanvas) {
        const rightRect = rightCanvas.getBoundingClientRect();
        if (
            rightRect.width > 0 &&
            rightRect.height > 0 &&
            clientX >= rightRect.left && clientX <= rightRect.right &&
            clientY >= rightRect.top && clientY <= rightRect.bottom
        ) {
            return document.getElementById('pdf-container-2');
        }
    }

    const leftCanvas = document.getElementById('pdf-canvas');
    if (leftCanvas) {
        const leftRect = leftCanvas.getBoundingClientRect();
        if (
            leftRect.width > 0 &&
            leftRect.height > 0 &&
            clientX >= leftRect.left && clientX <= leftRect.right &&
            clientY >= leftRect.top && clientY <= leftRect.bottom
        ) {
            return document.getElementById('pdf-container');
        }
    }

    return null;
}

function ensureSpotlightOverlay(pane) {
    const container = document.getElementById(pane === 'right' ? 'pdf-container-2' : 'pdf-container');
    if (!container) return null;
    let overlay = container.querySelector('.spotlight-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.className = 'spotlight-overlay';
        container.appendChild(overlay);
    }
    state.spotlightOverlays[pane] = overlay;
    return overlay;
}

function renderSpotlight() {
    const left = ensureSpotlightOverlay('left');
    const right = ensureSpotlightOverlay('right');
    [left, right].forEach(overlay => overlay?.classList.remove('visible'));
    if (!state.spotlight?.visible) return;
    const overlay = state.spotlightOverlays[state.spotlight.pane];
    if (!overlay) return;
    overlay.style.setProperty('--spotlight-x', `${state.spotlight.x * 100}%`);
    overlay.style.setProperty('--spotlight-y', `${state.spotlight.y * 100}%`);
    overlay.classList.add('visible');
}

function hideSpotlight(force = false) {
    if (!state.spotlight.visible && !force) return;
    state.spotlight = { ...state.spotlight, visible: false };
    renderSpotlight();
}

/* ─── socket events ───────────────────────────────────────────── */
// The only inbound socket event the presenter cares about is the live survey
// response count (broadcast to the 'presenter' room by respond_survey).
function wireSocketEvents() {
    state.socket.on('survey_response', (data) => {
        if (!state.surveyData || data.survey_id !== state.surveyData.survey_id) return;
        if (typeof data.total === 'number') {
            state.surveyResponseCount = data.total;
            state.surveyCountSubscribers.forEach(cb => { try { cb(state.surveyResponseCount); } catch(e) {} });
        }
    });
}

/* ─── editor: exit → re-render so added media appears immediately */
bus.on('editor:exited', () => renderLogicalSlide(state.currentSlide, false, false, true));

/* ─── editor: slide reorder ───────────────────────────────────── */
bus.on('slides:reordered', async () => {
    // Slide indices changed — parked widgets are keyed by old indices, so discard them
    clearAllParked();
    const leftCvs = document.getElementById('pdf-canvas');
    const rightCvs = document.getElementById('pdf-canvas-2');
    if (leftCvs)  delete leftCvs.dataset.slideKey;
    if (rightCvs) delete rightCvs.dataset.slideKey;
    populateSlideNavigator();
    await renderLogicalSlide(state.currentSlide);
    updateSlideNavigator();
    updateBlankSlideButtons();
});

/* ─── thumbnail generation ────────────────────────────────────── */
async function generateThumbnails() {
    if (!state.zipFile) return;
    const pdfDoc = await getPdfDoc();
    if (!pdfDoc) return;
    state.thumbnailPdfDoc = pdfDoc;

    for (let i = 0; i < pdfDoc.numPages; i++) {
        const page = await pdfDoc.getPage(i + 1);
        const viewport = page.getViewport({ scale: 0.5 });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width; canvas.height = viewport.height;
        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
        state.slideThumbnailCache[i] = canvas.toDataURL();
    }
    populateSlideNavigator();
}

/* ─── upload (public) ─────────────────────────────────────────── */
export async function loadZipPresentation(file) {
    const modal = window.BeamerModal;
    modal?.show({ kind: 'loading', title: 'Loading…', message: 'Parsing presentation…' });

    try {
        const data = await file.arrayBuffer();
        const zip  = await JSZip.loadAsync(data);
        const pdfFile = zip.file('slides.pdf');
        if (!pdfFile) throw new Error('ZIP must contain slides.pdf');

        const pdfData = await pdfFile.async('arraybuffer');
        const pdfDoc  = await pdfjsLib.getDocument({ data: pdfData }).promise;
        const total   = pdfDoc.numPages;

        // Restore saved slide order written by the editor (if present)
        let slideStructure = Array.from({ length: total }, (_, i) => ({ type: 'pdf', pdfIndex: i }));
        const orderFile = zip.file('config/slide-order.json');
        if (orderFile) {
            try {
                const saved = JSON.parse(await orderFile.async('string'));
                if (Array.isArray(saved) && saved.length > 0) slideStructure = saved;
            } catch (_) {}
        }

        // Destroy all pooled widgets from any previous presentation
        clearAllParked();
        const leftCvs = document.getElementById('pdf-canvas');
        const rightCvs = document.getElementById('pdf-canvas-2');
        if (leftCvs)  delete leftCvs.dataset.slideKey;
        if (rightCvs) delete rightCvs.dataset.slideKey;

        state.zipFile        = zip;
        // Reuse the document we just parsed instead of decoding it again on first render.
        state._pdfDocPromise = Promise.resolve(pdfDoc);
        state.totalSlides    = slideStructure.length;
        state.slideStructure = slideStructure;
        state.currentSlide   = 0;
        state.slideConfigs   = {}; state.mediaCache = {};
        state.annotations    = {}; state.annotationsRight = {};
        state.bookmarks      = {}; state.collapsedParents = new Set();
        if (state.editorNewFiles) state.editorNewFiles = {};

        // Restore saved annotations (persistent pen strokes across re-uploads).
        const annotFile = zip.file('config/annotations.json');
        if (annotFile) {
            try {
                const saved = JSON.parse(await annotFile.async('string'));
                if (saved && typeof saved === 'object') state.annotations = saved;
            } catch (_) {}
        }

        // Restore saved widget states (so widgets resume where they left off).
        const wsFile = zip.file('config/widget-states.json');
        if (wsFile) {
            try {
                const saved = JSON.parse(await wsFile.async('string'));
                if (saved && typeof saved === 'object') setWidgetStates(saved);
            } catch (_) {}
        }

        await renderLogicalSlide(0);
        await generateThumbnails();
        populateSlideNavigator();
        updateBlankSlideButtons();
        await locateSurveyWidgetSlide();

        modal?.close();
        enableControls();
    } catch (err) {
        console.error('ZIP load error:', err);
        modal?.close();
        window.BeamerModal?.show({ kind: 'error', title: 'Upload failed', message: err.message });
    }
}

export async function loadPdfPresentation(file) {
    const modal = window.BeamerModal;
    modal?.show({ kind: 'loading', title: 'Loading…', message: 'Parsing PDF…' });

    try {
        const data   = await file.arrayBuffer();
        // Hand pdf.js a copy: v4 transfers the buffer to its worker, which
        // detaches it, and we still need `data` for the ZIP below.
        const pdfDoc = await pdfjsLib.getDocument({ data: data.slice(0) }).promise;
        const total  = pdfDoc.numPages;

        const zip = new JSZip();
        zip.file('slides.pdf', data);
        state.zipFile = zip;
        // Reuse the document we just parsed instead of decoding it again on first render.
        state._pdfDocPromise = Promise.resolve(pdfDoc);
        state.totalSlides = total;
        state.slideStructure = Array.from({ length: total }, (_, i) => ({ type: 'pdf', pdfIndex: i }));
        state.currentSlide   = 0;
        state.slideConfigs   = {}; state.mediaCache = {};
        state.annotations    = {}; state.annotationsRight = {};
        state.bookmarks      = {}; state.collapsedParents = new Set();

        await renderLogicalSlide(0);
        await generateThumbnails();
        populateSlideNavigator();
        updateBlankSlideButtons();
        modal?.close();
        enableControls();
    } catch (err) {
        console.error('PDF load error:', err);
        modal?.close();
        window.BeamerModal?.show({ kind: 'error', title: 'Upload failed', message: err.message });
    }
}

function enableControls() {
    const els = document.querySelectorAll('.controls-disable-before-load');
    els.forEach(el => { el.disabled = false; el.style.opacity = '1'; el.style.pointerEvents = 'auto'; });
}

async function locateSurveyWidgetSlide() {
    state.surveyWidgetSlideIndex = null;
    if (!state.zipFile || !state.totalSlides) return;
    for (let i = 0; i < state.totalSlides; i++) {
        const cfg = await loadSlideConfig(i);
        if (cfg?.widgets?.some(w => w.type === 'survey_result')) {
            state.surveyWidgetSlideIndex = i;
            break;
        }
    }
}
