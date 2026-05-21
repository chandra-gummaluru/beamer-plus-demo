/**
 * Beamer+ main orchestrator.
 * Wires up socket.io, canvas, and all feature modules.
 */
import { bus, initEvents, addHoldListener } from './core/events.js';
import { initButtons } from './core/button.js';
import { initToggle } from './core/toggle.js';
import { initModal } from './core/modal.js';
import { Canvas } from './core/canvas.js';
import { renderWidgets, cleanupWidgets, updateWidgetPositions } from './core/iframe-widget-renderer.js';

import { initToolbar } from './annotations/toolbar.js';
import { initPenSlots } from './annotations/pen-slots.js';
import { initShapeTools } from './annotations/shape-tools.js';

import { initNavigator } from './slides/navigator.js';
import { initThumbnails } from './slides/thumbnails.js';
import { initBookmarks } from './slides/bookmarks.js';

import { initUploader } from './upload/uploader.js';
import { initSurveyBridge } from './surveys/survey-bridge.js';
import { initEditor } from './editor/editor.js';

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

/* ─── pen / tool wiring ───────────────────────────────────────── */
const PEN_SLOT_DEFAULTS = [
    { mode: 'draw', color: '#333333', size: 2, label: 'P1' },
    { mode: 'draw', color: '#e74c3c', size: 2, label: 'P2' },
    { mode: 'highlight', color: '#f1c40f', size: 5, label: 'H1' },
    { mode: 'highlight', color: '#2ecc71', size: 5, label: 'H2' },
    { mode: 'draw', color: '#3498db', size: 2, label: 'P3' },
];
const PEN_SWATCHES = ['#eeeeee','#e74c3c','#f1c40f','#2ecc71','#3498db','#9b59b6','#333333'];
state.penProfiles = PEN_SLOT_DEFAULTS.map(p => ({ ...p }));

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

function applyPenSlot(i) {
    const profile = state.penProfiles[i];
    if (!profile) return;
    state.activePenSlot = i;
    state.annotationTool = profile.mode === 'highlight' ? 'highlight' : 'draw';
    state.annCvs.setPointerMode(state.annotationTool);
    state.annCvs.setStrokeColor(profile.color);
    state.annCvs.setStrokeWidth(profile.size);
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
        state.socket.emit('clear_annotations');
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
        state.socket.emit('clear_annotations');
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
        if (e.key === sc.focusMode)        document.getElementById('focus-mode-btn')?.click();
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
    } else if (theme === 'light') {
        html.removeAttribute('data-theme');
    } else {
        if (window.matchMedia('(prefers-color-scheme: dark)').matches)
            html.setAttribute('data-theme', 'dark');
        else html.removeAttribute('data-theme');
    }
}

const NON_BINDABLE = new Set([
    'Tab','Enter','Backspace','Delete','Escape',
    'ArrowLeft','ArrowRight','ArrowUp','ArrowDown','PageUp','PageDown','Home','End',
    'Control','Meta','Alt','Shift','CapsLock',
    'F1','F2','F3','F4','F5','F6','F7','F8','F9','F10','F11','F12',
]);

function showSettingsModal() {
    const currentTheme = localStorage.getItem('beamer-theme') || 'system';
    const sc = loadShortcuts();

    const body = document.createElement('div');
    body.className = 'settings-grid';

    // ── Theme ──────────────────────────────────────────────────
    const themeLabel = document.createElement('div');
    themeLabel.className = 'settings-label';
    themeLabel.textContent = 'Theme';
    body.appendChild(themeLabel);

    const themeRow = document.createElement('div');
    themeRow.className = 'settings-theme-row';
    ['Light', 'Dark', 'System'].forEach(t => {
        const btn = document.createElement('button');
        btn.className = 'btn' + (currentTheme === t.toLowerCase() ? ' btn_selected' : '');
        btn.textContent = t;
        btn.addEventListener('click', () => {
            applyTheme(t.toLowerCase());
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
    scLabel.className = 'settings-label';
    scLabel.textContent = 'Keyboard Shortcuts';
    scSection.appendChild(scLabel);

    const scHint = document.createElement('p');
    scHint.className = 'settings-shortcut-hint';
    scHint.textContent = 'Click a key to rebind it.';
    scSection.appendChild(scHint);

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
            saveShortcuts(sc);
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

    const resetRow = document.createElement('div');
    resetRow.className = 'settings-shortcuts-reset';
    const resetBtn = document.createElement('button');
    resetBtn.className = 'btn';
    resetBtn.textContent = 'Reset defaults';
    resetBtn.addEventListener('click', () => {
        Object.assign(sc, DEFAULT_SHORTCUTS);
        saveShortcuts(sc);
        scGrid.querySelectorAll('.shortcut-capture').forEach((inp, i) => {
            inp.value = DEFAULT_SHORTCUTS[Object.keys(SHORTCUT_LABELS)[i]] ?? '';
        });
    });
    resetRow.appendChild(resetBtn);
    scSection.appendChild(resetRow);
    body.appendChild(scSection);

    window.BeamerModal?.show({
        kind: 'info',
        title: 'Settings',
        body,
        buttons: [{ label: 'Close', kind: 'cancel' }],
    });
}

function wireSettingsBtn() {
    document.getElementById('settings-btn')?.addEventListener('click', showSettingsModal);
    applyTheme(localStorage.getItem('beamer-theme') || 'system');
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
function wireFocusMode() {
    const btn = document.getElementById('focus-mode-btn');
    if (!btn) return;
    btn.addEventListener('click', () => {
        const active = document.body.classList.toggle('focus-mode');
        btn.title = active ? 'Exit focus mode' : 'Focus mode (hide UI)';
        btn.querySelector('i').className = active ? 'fa-solid fa-compress' : 'fa-solid fa-expand';
        // Trigger canvas resize so annotations stay aligned with the new layout
        setTimeout(() => {
            state.annCvs?.resizeOnly?.();
            state.pdfCvs?.resizeOnly?.();
            if (state.splitView) {
                state.annCvs2?.resizeOnly?.();
                state.pdfCvs2?.resizeOnly?.();
            }
        }, 300); // wait for CSS transition to finish
    });

    // Pressing Escape also exits focus mode
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && document.body.classList.contains('focus-mode')) {
            btn.click();
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
        emitSlideState();
    });

    const moveBtn = document.getElementById('move-left-to-right-btn');
    if (moveBtn) {
        moveBtn.addEventListener('click', async () => {
            if (!state.splitView) return;
            
            saveCurrentAnnotations();
            
            // If current slide is at the last slide, wrap left to beginning
            if (state.currentSlide >= state.slideStructure.length - 1) {
                state.rightSlideIndex = state.currentSlide;
                state.currentSlide = 0;
            } else {
                state.rightSlideIndex = state.currentSlide;
                state.currentSlide = state.currentSlide + 1;
            }
            
            await renderSplitSlides(state.currentSlide, state.rightSlideIndex);
            updateSlideNavigator();
            updateBlankSlideButtons();
            emitSlideState();
            bus.emit('slide:changed', state.currentSlide);
        });
    }

    // Divider dragging for resizing
    const divider = document.getElementById('split-view-divider');
    let isDragging = false;
    if (divider) {
        divider.addEventListener('mousedown', () => { isDragging = true; divider.classList.add('active'); });
        document.addEventListener('mouseup', () => {
            const wasDragging = isDragging;
            isDragging = false;
            divider.classList.remove('active');
            // Re-render both panes after divider resize — only if we were actually dragging
            if (wasDragging && state.splitView) {
                setTimeout(async () => {
                    // Save first (canvas still has correct pixels), then resize
                    // buffers to match new layout so coordinates align with mouse
                    saveCurrentAnnotations();
                    state.annCvs.resizeOnly?.();
                    state.annCvs2?.resizeOnly?.();
                    updateWidgetPositions(document.getElementById('pdf-canvas'));
                    updateWidgetPositions(document.getElementById('pdf-canvas-2'));
                    await renderSplitSlides(state.currentSlide, state.rightSlideIndex);
                    emitSlideState();
                }, 50);
            }
        });
        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            const mainContent = document.getElementById('main-content');
            const leftContainer = document.getElementById('pdf-container');
            const rightContainer = document.getElementById('pdf-container-2');
            if (!mainContent || !leftContainer || !rightContainer) return;

            const rect = mainContent.getBoundingClientRect();
            const newLeftPercent = ((e.clientX - rect.left) / rect.width) * 100;
            applySplitRatio(newLeftPercent);
            emitSlideState();
        });
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
    const totalWidth = rect.width;
    const totalHeight = rect.height;
    if (!totalWidth || !totalHeight) return { min: 20, max: 80 };

    // Respect the 4:3 slide ratio under max-height constraints.
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

async function goToSlide(i, direction = null) {
    if (i < 0 || i >= state.slideStructure.length) return;
    hideSpotlight(true);

    // Show overlay(s) immediately — before any async config loading or layout work
    _slideOverlay(false)?.classList.add('visible');
    if (state.splitView) _slideOverlay(true)?.classList.add('visible');

    // ── Config-driven split-view logic ────────────────────────────
    // Save BEFORE any setSplitActive call — resizeOnly() inside it clears canvases
    saveCurrentAnnotations();

    // Load config for slide we're LEAVING to check onLeave directives
    const leavingObj = state.slideStructure[state.currentSlide];
    const leavingCfg = leavingObj?.type === 'pdf'
        ? await loadSlideConfig(leavingObj.pdfIndex) : null;

    // Handle leave actions — always, regardless of navigation method
    const onLeave = leavingCfg?.onLeave;
    if (onLeave) {
        if (onLeave.closeSplit && state.splitView) {
            await setSplitActive(false);
        }
        // Only redirect to onLeave.goToSlide when using next-slide (forward), not when clicking a slide directly
        if (onLeave.goToSlide != null && direction === 'forward') {
            i = resolvePdfRef(onLeave.goToSlide) ?? Math.max(0, Math.min(state.slideStructure.length - 1, onLeave.goToSlide));
        }
    }

    // Guard AFTER onLeave may have redirected i away from the right pane
    if (state.splitView && i === state.rightSlideIndex) return;

    // Load config for slide we're ENTERING to check onEnter directives
    const enteringObj = state.slideStructure[i];
    const enteringCfg = enteringObj?.type === 'pdf'
        ? await loadSlideConfig(enteringObj.pdfIndex) : null;

    // Handle enter actions
    const onEnter = enteringCfg?.onEnter;
    const prevRightIndex = state.rightSlideIndex;
    if (onEnter?.split != null) {
        const rightIndex = resolvePdfRef(onEnter.split) ?? Math.max(0, Math.min(state.slideStructure.length - 1, onEnter.split));
        if (!state.splitView || state.rightSlideIndex !== rightIndex) {
            // About to enter split — also cover the right pane immediately
            _slideOverlay(true)?.classList.add('visible');
            await setSplitActive(true, rightIndex, onEnter.splitRatio ?? null);
        }
    }
    // ─────────────────────────────────────────────────────────────

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
    emitSlideState();
    bus.emit('slide:changed', i);
}

async function setSplitActive(active, rightIndex = null, splitRatio = null) {
    const annContainer2 = document.getElementById('ann-canvas-2');
    const pdfContainer2 = document.getElementById('pdf-canvas-2');
    const btn           = document.getElementById('split-toggle');
    const moveBtn       = document.getElementById('move-left-to-right-btn');

    if (active === state.splitView && (rightIndex === null || rightIndex === state.rightSlideIndex)) return;

    state.splitView = active;
    document.body.classList.toggle('split-view-active', active);
    if (btn) btn.classList.toggle('btn_selected', active);
    if (moveBtn) moveBtn.style.display = active ? 'flex' : 'none';

    if (active) {
        if (!state.annCvs2) {
            state.annCvs2 = new Canvas(annContainer2, true);
            state.pdfCvs2 = new Canvas(pdfContainer2, false);
            state.annCvs2.setPointerMode('hand');
        }
        state.rightSlideIndex = rightIndex ?? Math.min(state.currentSlide + 1, state.slideStructure.length - 1);
        applySplitRatio(splitRatio ?? state.splitRatio);
        await renderLogicalSlide(state.rightSlideIndex, true);
    }

    await new Promise(resolve => setTimeout(resolve, 100));
    state.annCvs.resizeOnly?.();
    state.pdfCvs.resizeOnly?.();
    if (state.annCvs2) state.annCvs2.resizeOnly?.();
    if (state.pdfCvs2) state.pdfCvs2.resizeOnly?.();
    populateSlideNavigator();
}

function emitSlideState() {
    const annData = state.annCvs?.canvas?.toDataURL('image/png') || null;
    state.socket.emit('slide_change', {
        slideIndex: state.currentSlide,
        rightSlideIndex: state.rightSlideIndex,
        splitView: state.splitView,
        splitRatio: state.splitRatio,
        annotations: annData,
        slideStructure: state.slideStructure,
    });
}

function updateSlideNavigator() {
    document.querySelectorAll('.slide-nav-item').forEach((el, idx) => {
        el.classList.toggle('active', idx === state.currentSlide);
        el.classList.toggle('current-slide', idx === state.currentSlide);
        el.classList.toggle('bookmarked', !!state.bookmarks[idx]);
        // Disable interaction with right slide in split view
        const isRightSlide = state.splitView && idx === state.rightSlideIndex;
        el.style.pointerEvents = isRightSlide ? 'none' : 'auto';
        el.style.opacity = isRightSlide ? '0.5' : '1';
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

async function renderLogicalSlide(logicalIndex, isRight = false, suppressOverlay = false) {
    const obj = state.slideStructure[logicalIndex];
    if (!obj) return;

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

    const loading = suppressOverlay ? null : _slideOverlay(isRight);
    if (loading) loading.classList.add('visible');

    if (obj.type === 'pdf') {
        if (cvs.canvas) cvs.canvas.style.visibility = 'visible';
        if (annContainer) annContainer.style.background = '';
        await renderPdfSlide(obj.pdfIndex, logicalIndex, isRight);
    } else if (obj.type === 'blank') {
        if (cvs.canvas) cvs.canvas.style.visibility = 'hidden';
        annCvs.clear();
        if (annotsMap[logicalIndex]) {
            await annCvs.loadAnnotations(annotsMap[logicalIndex]);
        } else {
            annCvs.resetHistory?.();
        }
        if (annContainer) annContainer.style.background = 'white';
    }

    if (loading) loading.classList.remove('visible');
    updateHistoryBtns();
}

async function renderPdfSlide(pdfIndex, logicalIndex, isRight = false) {
    if (!state.zipFile) return;

    const pdfFile = state.zipFile.file('slides.pdf');
    if (!pdfFile) { console.error('No slides.pdf in ZIP'); return; }

    const pdfData = await pdfFile.async('arraybuffer');
    const pdfDoc  = await pdfjsLib.getDocument({ data: pdfData }).promise;
    const page    = await pdfDoc.getPage(pdfIndex + 1);

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

    // Remove old media
    container?.querySelectorAll('video,audio,model-viewer').forEach(el => el.remove());
    cleanupWidgets(container);

    const config = await loadSlideConfig(pdfIndex);
    if (!config) return;

    const rect = container.getBoundingClientRect();
    await renderMedia(config, container, rect, isRight);
}

async function renderMedia(config, container, rect, isRight) {
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
            // Expand-on-play logic
            let _expandTimer = null;
            function _expandVideo() {
                const cr = container.getBoundingClientRect();
                Object.assign(video.style, { left: '0px', top: '0px', width: `${cr.width}px`, height: `${cr.height}px`, zIndex: '500' });
                state.socket.emit('video_action', { id: video.dataset.videoId, action: 'expand' });
            }
            function _collapseVideo() {
                clearTimeout(_expandTimer); _expandTimer = null;
                const cr = container.getBoundingClientRect();
                const vz = video.dataset.videoZIndex;
                Object.assign(video.style, { left: `${v.x*cr.width}px`, top: `${v.y*cr.height}px`, width: `${v.width*cr.width}px`, height: `${v.height*cr.height}px`, zIndex: vz });
                state.socket.emit('video_action', { id: video.dataset.videoId, action: 'collapse' });
            }
            // Emit play/pause/seek to viewers from the interacted pane.
            video.addEventListener('play', () => {
                state.socket.emit('video_action', { id: video.dataset.videoId, action: 'play', time: video.currentTime });
                if (!isRight && v.expandDelay != null && _expandTimer === null) {
                    _expandTimer = setTimeout(_expandVideo, v.expandDelay * 1000);
                }
            });
            video.addEventListener('pause', () => {
                state.socket.emit('video_action', { id: video.dataset.videoId, action: 'pause', time: video.currentTime });
                if (!isRight && v.expandDelay != null) _collapseVideo();
            });
            video.addEventListener('ended', () => {
                if (!isRight && v.expandDelay != null) _collapseVideo();
            });
            video.addEventListener('seeked', () => state.socket.emit('video_action', { id: video.dataset.videoId, action: 'seek',  time: video.currentTime }));
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
            mv.dataset.modelId = m.id;
            Object.assign(mv.style, { position:'absolute', left:`${m.x*rect.width}px`, top:`${m.y*rect.height}px`, width:`${m.width*rect.width}px`, height:`${m.height*rect.height}px`, zIndex: m.zIndex ?? 5 });
            mv.style.setProperty('--progress-bar-height', '0px');
            const progressBarSlot = document.createElement('div');
            progressBarSlot.slot = 'progress-bar';
            mv.appendChild(progressBarSlot);
            container.appendChild(mv);
            if (!isRight) {
                let cameraTimer = null;
                mv.addEventListener('camera-change', () => {
                    clearTimeout(cameraTimer);
                    cameraTimer = setTimeout(() => {
                        state.socket.emit('model_interaction', {
                            id: m.id,
                            cameraOrbit: mv.getCameraOrbit().toString(),
                            fieldOfView: mv.getFieldOfView() + 'deg',
                        });
                    }, 150);
                });
            }
        }
    }
    if (config.widgets) {
        await renderWidgets(config, container, state.zipFile);
        setWidgetInteractivityForSpotlight(state.annotationTool === 'spotlight');
    }
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

async function loadMedia(path) {
    if (state.mediaCache[path]) return state.mediaCache[path];
    const f = state.zipFile?.file(path);
    if (!f) return null;
    const url = URL.createObjectURL(await f.async('blob'));
    state.mediaCache[path] = url;
    return url;
}

/* ─── annotation sync ─────────────────────────────────────────── */
let annotationSyncTimer = null;
function syncAnnotations() {
    clearTimeout(annotationSyncTimer);
    const idx = state.currentSlide;
    annotationSyncTimer = setTimeout(() => {
        const data = state.annCvs.canvas.toDataURL('image/png');
        state.annotations[idx] = data;
        state.socket.emit('annotation_update', { annotations: data, slideIndex: idx });
    }, 100);
}

function saveCurrentAnnotations() {
    clearTimeout(annotationSyncTimer);
    if (!state.annCvs) return;
    const data = state.annCvs.canvas.toDataURL('image/png');
    state.annotations[state.currentSlide] = data;
    state.socket.emit('annotation_update', { annotations: data, slideIndex: state.currentSlide });
    // Also save the right pane when in split view
    if (state.splitView && state.annCvs2) {
        state.annotations[state.rightSlideIndex] = state.annCvs2.canvas.toDataURL('image/png');
    }
}

/* ─── populate slide navigator ────────────────────────────────── */
function populateSlideNavigator() {
    const labels = getSlideLabels(state.slideStructure);
    bus.emit('slides:loaded', state.slideStructure.map((obj, i) => ({
        kind: obj.type,
        label: labels[i],
        title: obj.type === 'blank' ? labels[i] : `Slide ${labels[i]}`,
        thumbUrl: obj.type === 'pdf' ? (state.slideThumbnailCache[obj.pdfIndex] ?? null) : null,
    })));
    updateSlideNavigator();
}

/* ─── slide label helper ──────────────────────────────────────── */
function getSlideLabels(structure) {
    const labels = [];
    let pdfCount = 0;
    let blankCount = 0;
    for (const obj of structure) {
        if (obj.type !== 'blank') {
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

/* ─── blank slide management ──────────────────────────────────── */
document.getElementById('add-blank-btn')?.addEventListener('click', () => insertBlankAfterCurrent());
document.getElementById('delete-blank-btn')?.addEventListener('click', () => deleteCurrentBlank());

function insertBlankAfterCurrent() {
    const ins = state.currentSlide + 1;
    state.slideStructure.splice(ins, 0, { type: 'blank', parent: null });

    // Shift thumbnail cache entries above insertion point up by one so they
    // stay aligned with the new logical slide indices.
    const lastIdx = state.slideStructure.length - 1; // new length after splice
    for (let i = lastIdx; i > ins; i--) {
        state.slideThumbnailCache[i] = state.slideThumbnailCache[i - 1];
    }
    delete state.slideThumbnailCache[ins]; // blank has no thumbnail

    goToSlide(ins);
    populateSlideNavigator();
}

function deleteCurrentBlank() {
    const obj = state.slideStructure[state.currentSlide];
    if (obj?.type !== 'blank') return;
    const del = state.currentSlide;
    state.slideStructure.splice(del, 1);
    state.totalSlides = state.slideStructure.length;

    // Shift thumbnail cache entries above the deleted position down by one.
    for (let i = del; i < state.slideStructure.length; i++) {
        state.slideThumbnailCache[i] = state.slideThumbnailCache[i + 1];
    }
    delete state.slideThumbnailCache[state.slideStructure.length];

    const next = Math.min(del, state.slideStructure.length - 1);
    state.currentSlide = next;
    goToSlide(next);
    populateSlideNavigator();
}

/* ─── resize / fullscreen ─────────────────────────────────────── */
function wireResizeAndFullscreen() {
    window.addEventListener('resize', () => {
        state.annCvs?.resize?.();
        if (state.splitView) state.annCvs2?.resize?.();
        if (state.splitView) applySplitRatio(state.splitRatio);
        if (state.zipFile && state.slideConfigs[state.currentSlide]) {
            updateWidgetPositions(document.getElementById('pdf-canvas'));
        }
    });
    document.addEventListener('fullscreenchange', () => {
        setTimeout(() => {
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
let spotlightEmitFrame = null;

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
        scheduleSpotlightEmit();
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

function hideSpotlight(emit = false) {
    if (!state.spotlight.visible && !emit) return;
    state.spotlight = { ...state.spotlight, visible: false };
    renderSpotlight();
    if (emit) scheduleSpotlightEmit();
}

function scheduleSpotlightEmit() {
    if (!state.socket || spotlightEmitFrame) return;
    spotlightEmitFrame = requestAnimationFrame(() => {
        spotlightEmitFrame = null;
        state.socket.emit('spotlight_update', state.spotlight);
    });
}

/* ─── socket events ───────────────────────────────────────────── */
function wireSocketEvents() {
    state.socket.on('annotation_update', async (data) => {
        if (data.slideIndex !== state.currentSlide) return;
        state.annotations[data.slideIndex] = data.annotations;
        await state.annCvs.loadAnnotations(data.annotations);
    });

    state.socket.on('slide_change', async (data) => {
        await goToSlide(data.slideIndex);
    });

    state.socket.on('survey_response', (data) => {
        if (!state.surveyData || data.survey_id !== state.surveyData.survey_id) return;
        if (typeof data.total === 'number') {
            state.surveyResponseCount = data.total;
            state.surveyCountSubscribers.forEach(cb => { try { cb(state.surveyResponseCount); } catch(e) {} });
        }
    });

    state.socket.on('spotlight_update', (data) => {
        state.spotlight = { ...state.spotlight, ...data };
        renderSpotlight();
    });
}

/* ─── editor: slide reorder ───────────────────────────────────── */
bus.on('slides:reordered', async () => {
    populateSlideNavigator();
    await renderLogicalSlide(state.currentSlide);
    updateSlideNavigator();
    updateBlankSlideButtons();
    emitSlideState();
});

/* ─── thumbnail generation ────────────────────────────────────── */
async function generateThumbnails() {
    if (!state.zipFile) return;
    const pdfFile = state.zipFile.file('slides.pdf');
    if (!pdfFile) return;
    const pdfData = await pdfFile.async('arraybuffer');
    const pdfDoc  = await pdfjsLib.getDocument({ data: pdfData }).promise;
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

        state.zipFile        = zip;
        state.totalSlides    = slideStructure.length;
        state.slideStructure = slideStructure;
        state.currentSlide   = 0;
        state.slideConfigs   = {}; state.mediaCache = {};
        state.annotations    = {}; state.annotationsRight = {};
        state.bookmarks      = {}; state.collapsedParents = new Set();
        if (state.editorNewFiles) state.editorNewFiles = {};

        await renderLogicalSlide(0);
        await generateThumbnails();
        populateSlideNavigator();
        updateBlankSlideButtons();
        await locateSurveyWidgetSlide();

        state.socket.emit('presentation_loaded', { totalSlides: slideStructure.length, splitView: false, rightSlideIndex: 0, splitRatio: state.splitRatio });
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
        const pdfDoc = await pdfjsLib.getDocument({ data }).promise;
        const total  = pdfDoc.numPages;

        const zip = new JSZip();
        zip.file('slides.pdf', data);
        state.zipFile = zip;
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
        state.socket.emit('presentation_loaded', { totalSlides: total, splitView: false, rightSlideIndex: 0, splitRatio: state.splitRatio });
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
    document.getElementById('screen-share-btn')?.removeAttribute('disabled');
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
