/**
 * Beamer+ main orchestrator.
 * Wires up socket.io, canvas, and all feature modules.
 */
import { bus, initEvents, addHoldListener } from './core/events.js';
import { initButtons } from './core/button.js';
import { initTimer } from './core/timer.js';
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
import { initShare } from './screen-share/share.js';
import { initSurveyBridge } from './surveys/survey-bridge.js';

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
    initTimer(state);

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
    initShare(state);
    initSurveyBridge(state);

    // pen + hand defaults
    applyDefaultPen();
    wireHandButton();
    wireEraserButton();
    wireSplitViewButton(annContainer2, pdfContainer2);
    wireNavButtons();
    wireBookmarkButton();
    wireUndoRedo();
    wireAnnotationClear();
    wireKeyboardNav();
    wireResizeAndFullscreen();
    wireSocketEvents();
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
bus.on('tool:change', (tool) => {
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
        if (e.key === 'ArrowLeft'  || e.key === 'PageUp')   goToSlide(state.currentSlide - 1);
        if (e.key === 'ArrowRight' || e.key === 'PageDown')  goToSlide(state.currentSlide + 1);
        if (e.key === 'Escape') { bus.emit('ui:escape'); BeamerModal?.close(); }
        if (e.key === 'b') toggleBookmark(state.currentSlide);
    });
}

/* ─── nav prev/next buttons ───────────────────────────────────── */
function wireNavButtons() {
    document.getElementById('prev-btn')?.addEventListener('click', () => goToSlide(state.currentSlide - 1));
    document.getElementById('next-btn')?.addEventListener('click', () => goToSlide(state.currentSlide + 1));
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

/* ─── split-view ──────────────────────────────────────────────── */
function wireSplitViewButton(annContainer2, pdfContainer2) {
    const btn = document.getElementById('split-toggle');
    if (!btn) return;
    btn.addEventListener('click', async () => {
        state.splitView = !state.splitView;
        document.body.classList.toggle('split-view-active', state.splitView);
        btn.classList.toggle('btn_selected', state.splitView);

        const moveBtn = document.getElementById('move-left-to-right-btn');
        if (moveBtn) moveBtn.style.display = state.splitView ? 'flex' : 'none';

        if (state.splitView) {
            if (!state.annCvs2) {
                state.annCvs2 = new Canvas(annContainer2, true);
                state.pdfCvs2 = new Canvas(pdfContainer2, false);
                state.annCvs2.setPointerMode('hand');
            }
            state.rightSlideIndex = Math.min(state.currentSlide + 1, state.slideStructure.length - 1);
            applySplitRatio(state.splitRatio);
            await renderLogicalSlide(state.rightSlideIndex, true);
        }

        setTimeout(async () => {
            saveCurrentAnnotations();
            state.annCvs.resizeOnly?.();
            state.pdfCvs.resizeOnly?.();
            if (state.annCvs2) state.annCvs2.resizeOnly?.();
            if (state.pdfCvs2) state.pdfCvs2.resizeOnly?.();
            if (state.zipFile) {
                await renderLogicalSlide(state.currentSlide);
                if (state.splitView) await renderLogicalSlide(state.rightSlideIndex, true);
            }
            populateSlideNavigator();
            emitSlideState();
        }, 100);
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
            
            await renderLogicalSlide(state.currentSlide);
            await renderLogicalSlide(state.rightSlideIndex, true);
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
            isDragging = false; 
            divider.classList.remove('active');
            // Re-render widgets, videos, and models after resizing
            if (state.splitView) {
                setTimeout(() => {
                    updateWidgetPositions();
                    state.pdfCvs.resizeOnly?.();
                    state.pdfCvs2.resizeOnly?.();
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
bus.on('slide:next', () => goToSlide(state.currentSlide + 1));
bus.on('slide:prev', () => goToSlide(state.currentSlide - 1));

async function goToSlide(i) {
    if (i < 0 || i >= state.slideStructure.length) return;
    // Prevent navigating to the right slide when in split view
    if (state.splitView && i === state.rightSlideIndex) return;
    hideSpotlight(true);
    
    saveCurrentAnnotations();
    state.currentSlide = i;
    const obj = state.slideStructure[i];
    if (obj?.type === 'blank') state.collapsedParents.delete(obj.parent);

    await renderLogicalSlide(i);
    updateSlideNavigator();
    updateBlankSlideButtons();
    emitSlideState();
    bus.emit('slide:changed', i);
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
async function renderLogicalSlide(logicalIndex, isRight = false) {
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
    const annotsMap = isRight ? state.annotationsRight : state.annotations;

    if (!cvs || !annCvs) return;

    const loading = slideContainer?.querySelector('.slide-loading-overlay');
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
    const annotsMap = isRight ? state.annotationsRight : state.annotations;
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
            Object.assign(video.dataset, { videoX: v.x, videoY: v.y, videoWidth: v.width, videoHeight: v.height, videoId: baseVideoId + (isRight ? '-r' : '') });
            Object.assign(video.style, { position:'absolute', left:`${v.x*rect.width}px`, top:`${v.y*rect.height}px`, width:`${v.width*rect.width}px`, height:`${v.height*rect.height}px`, objectFit:'contain', zIndex: v.zIndex ?? 5 });
            if (v.playMode === 'once' || v.playMode === 'auto') { video.autoplay = true; video.muted = true; }
            if (v.playMode === 'loop') { video.autoplay = true; video.loop = true; video.muted = true; }
            if (v.playMode === 'manual') { video.controls = true; }
            // Emit play/pause/seek to viewers from the interacted pane.
            video.addEventListener('play',  () => state.socket.emit('video_action', { id: video.dataset.videoId, action: 'play',  time: video.currentTime }));
            video.addEventListener('pause', () => state.socket.emit('video_action', { id: video.dataset.videoId, action: 'pause', time: video.currentTime }));
            video.addEventListener('seeked', () => state.socket.emit('video_action', { id: video.dataset.videoId, action: 'seek',  time: video.currentTime }));
            video.addEventListener('click', (e) => { video.paused ? video.play() : video.pause(); e.stopPropagation(); });
            container.appendChild(video);
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
            mv.dataset.modelId = m.id;
            Object.assign(mv.style, { position:'absolute', left:`${m.x*rect.width}px`, top:`${m.y*rect.height}px`, width:`${m.width*rect.width}px`, height:`${m.height*rect.height}px`, zIndex: m.zIndex ?? 5 });
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
        renderWidgets(config, container, state.zipFile);
        setWidgetInteractivityForSpotlight(state.annotationTool === 'spotlight');
    }
}

/* ─── slide config / media cache ─────────────────────────────── */
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
}

/* ─── populate slide navigator ────────────────────────────────── */
function populateSlideNavigator() {
    const labels = getSlideLabels(state.slideStructure);
    bus.emit('slides:loaded', state.slideStructure.map((obj, i) => ({
        kind: obj.type,
        label: labels[i],
        title: obj.type === 'blank' ? labels[i] : `Slide ${labels[i]}`,
        thumbUrl: state.slideThumbnailCache[i] || null,
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
        await locateSurveyWidgetSlide();

        state.socket.emit('presentation_loaded', { totalSlides: total, splitView: false, rightSlideIndex: 0, splitRatio: state.splitRatio });
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
