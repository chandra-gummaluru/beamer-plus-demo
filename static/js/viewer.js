import { Canvas } from './core/canvas.js';
import { initModal } from './core/modal.js';
import { renderWidgets, cleanupWidgets } from './core/iframe-widget-renderer.js';

const state = {
    socket: null,
    zipFile: null,
    pdfDoc: null,
    slideStructure: [],
    currentSlide: 0,
    rightSlideIndex: 0,
    splitView: false,
    splitRatio: 50,
    mediaCache: {},
    slideConfigs: {},
    annCvs: null,
    pdfCvs: null,
    annCvs2: null,
    pdfCvs2: null,
    viewerMuted: true,
    spotlight: { visible: false, pane: 'left', x: 0.5, y: 0.5 },
    spotlightOverlays: {},
};

const pendingVideoActions = new Map();

function applyVideoAction(video, data) {
    if (data.action === 'play') {
        video.currentTime = data.time;
        const p = video.play();
        if (p && typeof p.catch === 'function') {
            p.catch(() => {
                // Fallback for autoplay policies that block unmuted remote play.
                video.muted = true;
                video.play().catch(() => {});
            });
        }
    } else if (data.action === 'pause') {
        video.currentTime = data.time;
        video.pause();
    } else if (data.action === 'seek') {
        video.currentTime = data.time;
    } else if (data.action === 'expand') {
        const cr = video.parentElement.getBoundingClientRect();
        Object.assign(video.style, { left: '0px', top: '0px', width: `${cr.width}px`, height: `${cr.height}px`, zIndex: '500' });
    } else if (data.action === 'collapse') {
        const x  = parseFloat(video.dataset.videoX);
        const y  = parseFloat(video.dataset.videoY);
        const w  = parseFloat(video.dataset.videoWidth);
        const h  = parseFloat(video.dataset.videoHeight);
        const z  = video.dataset.videoZIndex || '5';
        const cr = video.parentElement.getBoundingClientRect();
        Object.assign(video.style, { left: `${x*cr.width}px`, top: `${y*cr.height}px`, width: `${w*cr.width}px`, height: `${h*cr.height}px`, zIndex: z });
    }
}

document.addEventListener('DOMContentLoaded', () => {
    initModal();

    state.annCvs = new Canvas(document.getElementById('ann-canvas'), true);
    state.pdfCvs = new Canvas(document.getElementById('pdf-canvas'), false);
    state.annCvs2 = new Canvas(document.getElementById('ann-canvas-2'), true);
    state.pdfCvs2 = new Canvas(document.getElementById('pdf-canvas-2'), false);
    state.annCvs.setPointerMode('hand');
    state.annCvs2.setPointerMode('hand');

    state.socket = io();
    state.socket.emit('join_viewer');
    setViewerMuted(true);
    initSpotlight();

    // Catch up when joining a live session
    state.socket.on('viewer_catchup', async (data) => {
        setViewerMuted(data.viewer_muted !== false);
        applySpotlight(data.spotlight);
        if (!data.zip_loaded) return;
        await loadPresentation();
        if (!state.zipFile) return;
        if (data.slide_structure && data.slide_structure.length > 0) {
            state.slideStructure = data.slide_structure;
        }
        await goToSlide(data.slide_index ?? 0, {
            splitView: !!data.split_view,
            rightSlideIndex: data.right_slide_index ?? 0,
            splitRatio: data.split_ratio ?? 50,
        });
        if (data.annotations) await state.annCvs.loadAnnotations(data.annotations);
        showStage();
    });

    // Presenter loaded a new presentation
    state.socket.on('presentation_loaded', async (data) => {
        await loadPresentation();
        if (state.zipFile) {
            await goToSlide(0, {
                splitView: !!data?.splitView,
                rightSlideIndex: data?.rightSlideIndex ?? 0,
                splitRatio: data?.splitRatio ?? 50,
            });
            showStage();
        }
    });

    state.socket.on('screen_share_start', () => {
        setViewerMuted(false);
    });

    state.socket.on('screen_share_stop', () => {
        setViewerMuted(true);
    });

    // Presenter changed slide
    state.socket.on('slide_change', async (data) => {
        if (!state.zipFile) {
            await loadPresentation();
            if (!state.zipFile) return;
            showStage();
        }
        if (data.slideStructure && data.slideStructure.length > 0) {
            state.slideStructure = data.slideStructure;
        }
        await goToSlide(data.slideIndex, {
            splitView: !!data.splitView,
            rightSlideIndex: data.rightSlideIndex ?? 0,
            splitRatio: data.splitRatio ?? 50,
        });
        if (data.annotations) await state.annCvs.loadAnnotations(data.annotations);
        else state.annCvs.clear();
    });

    // Annotation updates
    state.socket.on('annotation_update', async (data) => {
        if (data.slideIndex !== state.currentSlide) return;
        await state.annCvs.loadAnnotations(data.annotations);
    });

    state.socket.on('clear_annotations', () => state.annCvs.clear());

    // Video sync
    state.socket.on('video_action', (data) => {
        const video = document.querySelector(`[data-video-id="${data.id}"]`);
        if (!video) {
            pendingVideoActions.set(data.id, data);
            return;
        }
        applyVideoAction(video, data);
    });

    // 3D model camera sync
    state.socket.on('model_interaction', (data) => {
        const mv = document.querySelector(`model-viewer[data-model-id="${data.id}"]`);
        if (!mv) return;
        if (data.cameraOrbit) mv.cameraOrbit = data.cameraOrbit;
        if (data.fieldOfView) mv.fieldOfView = data.fieldOfView;
    });

    state.socket.on('spotlight_update', (data) => {
        applySpotlight(data);
    });

    // Survey overlay
    state.socket.on('survey_show', (data) => {
        hideSurveyOverlay();
        const url = data.url || (data.survey_id ? `/survey/${data.survey_id}` : null);
        if (!url) return;
        const overlay = document.createElement('div');
        overlay.id = 'survey-overlay';
        overlay.innerHTML = `
            <div class="viewer-survey-card">
                <iframe src="${url}" title="Survey"></iframe>
            </div>`;
        document.body.appendChild(overlay);
    });

    state.socket.on('survey_close', () => hideSurveyOverlay());

    window.addEventListener('resize', () => {
        state.annCvs?.resize?.();
        state.pdfCvs?.resize?.();
        state.annCvs2?.resize?.();
        state.pdfCvs2?.resize?.();
        if (state.splitView) applyViewerSplitRatio(state.splitRatio);
        renderSpotlight();
    });
});

function initSpotlight() {
    ensureSpotlightOverlay('left');
    ensureSpotlightOverlay('right');
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

function applySpotlight(data) {
    if (!data) return;
    state.spotlight = { ...state.spotlight, ...data };
    renderSpotlight();
}

/* ─── presentation loading ────────────────────────────────────────── */

async function loadPresentation() {
    try {
        const resp = await fetch('/api/presentation/current');
        if (!resp.ok) return;
        const data = await (await resp.blob()).arrayBuffer();
        const zip = await JSZip.loadAsync(data);
        const pdfFile = zip.file('slides.pdf');
        if (!pdfFile) return;
        const pdfData = await pdfFile.async('arraybuffer');
        state.pdfDoc = await pdfjsLib.getDocument({ data: pdfData }).promise;
        state.zipFile = zip;
        state.slideStructure = Array.from(
            { length: state.pdfDoc.numPages },
            (_, i) => ({ type: 'pdf', pdfIndex: i })
        );
        state.slideConfigs = {};
        state.mediaCache = {};
    } catch (e) {
        console.error('Viewer: failed to load presentation', e);
    }
}

/* ─── slide rendering ─────────────────────────────────────────────── */

async function goToSlide(i, options = {}) {
    if (!state.zipFile || i < 0 || i >= state.slideStructure.length) return;
    pendingVideoActions.clear();

    state.splitView = !!options.splitView;
    state.rightSlideIndex = options.rightSlideIndex ?? state.rightSlideIndex;
    state.splitRatio = options.splitRatio ?? state.splitRatio;
    document.body.classList.toggle('viewer-split-active', state.splitView);
    if (state.splitView) applyViewerSplitRatio(state.splitRatio);

    state.currentSlide = i;
    const loading = document.querySelector('.slide-loading-overlay');

    if (loading) loading.classList.add('visible');
    await renderIntoPane(i, false);

    if (state.splitView && state.rightSlideIndex >= 0 && state.rightSlideIndex < state.slideStructure.length) {
        await renderIntoPane(state.rightSlideIndex, true);
    } else {
        clearPane(true);
    }

    if (loading) loading.classList.remove('visible');
}

function getViewerSplitRatioBounds() {
    const stage = document.getElementById('viewer-stage');
    if (!stage) return { min: 20, max: 80 };

    const rect = stage.getBoundingClientRect();
    const totalWidth = rect.width;
    const totalHeight = rect.height;
    if (!totalWidth || !totalHeight) return { min: 20, max: 80 };

    const maxContainerWidth = totalHeight * (4 / 3);
    const maxPercent = (maxContainerWidth / totalWidth) * 100;
    const min = Math.max(100 - maxPercent, 20);
    const max = Math.min(maxPercent, 80);

    if (min > max) return { min: 50, max: 50 };
    return { min, max };
}

function applyViewerSplitRatio(ratioPercent) {
    const leftContainer = document.getElementById('pdf-container');
    const rightContainer = document.getElementById('pdf-container-2');
    if (!leftContainer || !rightContainer) return;

    const bounds = getViewerSplitRatioBounds();
    const clamped = Math.max(bounds.min, Math.min(bounds.max, ratioPercent));
    state.splitRatio = clamped;
    leftContainer.style.flex = `1 1 ${clamped}%`;
    rightContainer.style.flex = `1 1 ${100 - clamped}%`;
}

function clearPane(isRight = false) {
    const container = isRight ? document.getElementById('pdf-canvas-2') : document.getElementById('pdf-canvas');
    const pdfCvs = isRight ? state.pdfCvs2 : state.pdfCvs;
    const annCvs = isRight ? state.annCvs2 : state.annCvs;
    if (!container || !pdfCvs || !annCvs) return;
    pdfCvs.canvas.style.visibility = 'hidden';
    annCvs.clear();
    container.querySelectorAll('video,audio,model-viewer').forEach(el => el.remove());
    cleanupWidgets(container);
    container.style.background = '';
}

async function renderIntoPane(i, isRight = false) {
    const obj = state.slideStructure[i];
    const container = isRight ? document.getElementById('pdf-canvas-2') : document.getElementById('pdf-canvas');
    const pdfCvs = isRight ? state.pdfCvs2 : state.pdfCvs;
    const annCvs = isRight ? state.annCvs2 : state.annCvs;
    if (!container || !pdfCvs || !annCvs || !obj) return;

    if (obj.type === 'pdf') {
        // Fetch the page first (async) before touching the DOM, so we can
        // abort if a newer navigation has already superseded this one.
        const page = await state.pdfDoc.getPage(obj.pdfIndex + 1);
        // If the current slide changed while we were waiting, OR if the slide
        // at this index is no longer the same PDF page (e.g. a blank was
        // inserted at this index), bail out so we don't clobber the new slide.
        const latestObj = state.slideStructure[i];
        if (!isRight && (state.currentSlide !== i || !latestObj || latestObj.type !== 'pdf' || latestObj.pdfIndex !== obj.pdfIndex)) return;
        container.style.background = '';
        pdfCvs.canvas.style.visibility = 'visible';
        await pdfCvs.renderPDFPage(page);
        annCvs.clear();
        container?.querySelectorAll('video,audio,model-viewer').forEach(el => el.remove());
        cleanupWidgets(container);
        const config = await loadSlideConfig(obj.pdfIndex);
        if (config) await renderMedia(config, container, isRight);
    } else if (obj.type === 'blank') {
        container?.querySelectorAll('video,audio,model-viewer').forEach(el => el.remove());
        cleanupWidgets(container);
        pdfCvs.canvas.style.visibility = 'hidden';
        annCvs.clear();
        container.style.background = 'white';
    }
}

async function loadSlideConfig(pdfIndex) {
    if (state.slideConfigs[pdfIndex] !== undefined) return state.slideConfigs[pdfIndex];
    try {
    const f = state.zipFile.file(`config/s${pdfIndex}.json`)
           || state.zipFile.file(`configs/slide_${pdfIndex}.json`)
           || state.zipFile.file(`slide_${pdfIndex}_config.json`);
        state.slideConfigs[pdfIndex] = f ? JSON.parse(await f.async('string')) : null;
    } catch { state.slideConfigs[pdfIndex] = null; }
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

async function renderMedia(config, container, isRight = false) {
    const rect = container.getBoundingClientRect();
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
            video.dataset.videoId = `${baseVideoId}${isRight ? '-r' : ''}`;
            Object.assign(video.dataset, { videoX: v.x, videoY: v.y, videoWidth: v.width, videoHeight: v.height, videoZIndex: v.zIndex ?? 5 });
            Object.assign(video.style, {
                position: 'absolute',
                left: `${v.x * rect.width}px`, top: `${v.y * rect.height}px`,
                width: `${v.width * rect.width}px`, height: `${v.height * rect.height}px`,
                objectFit: 'contain', zIndex: v.zIndex ?? 5,
                transition: 'left 0.45s ease, top 0.45s ease, width 0.45s ease, height 0.45s ease',
            });
            if (v.playMode === 'loop') { video.loop = true; }
            if (v.playMode === 'once' || v.playMode === 'auto') { video.muted = true; }
            container.appendChild(video);
            const pending = pendingVideoActions.get(video.dataset.videoId);
            if (pending) {
                applyVideoAction(video, pending);
                pendingVideoActions.delete(video.dataset.videoId);
            }
        }
    }
    if (config.models) {
        for (const m of config.models) {
            const url = await loadMedia(m.path);
            if (!url) continue;
            const mv = document.createElement('model-viewer');
            mv.src = url; mv.alt = m.alt ?? '3D model';
            mv.setAttribute('shadow-intensity', '1');
            if (m.autoRotate) mv.setAttribute('auto-rotate', '');
            if (m.animate !== false) mv.setAttribute('autoplay', '');
            if (m.animationName) mv.setAttribute('animation-name', m.animationName);
            mv.dataset.modelId = m.id;
            Object.assign(mv.style, {
                position: 'absolute',
                left: `${m.x * rect.width}px`, top: `${m.y * rect.height}px`,
                width: `${m.width * rect.width}px`, height: `${m.height * rect.height}px`,
                zIndex: m.zIndex ?? 5,
            });
            container.appendChild(mv);
        }
    }
    if (config.widgets) renderWidgets(config, container, state.zipFile, true);
}

/* ─── UI helpers ──────────────────────────────────────────────────── */

function showStage() {
    document.getElementById('viewer-stage')?.classList.add('loaded');
}

function setViewerMuted(muted) {
    state.viewerMuted = muted;
    const splash = document.getElementById('splash-screen');
    if (!splash) return;

    if (muted) {
        splash.style.display = 'flex';
        splash.style.pointerEvents = 'auto';
    } else {
        splash.style.pointerEvents = 'none';
        splash.style.display = 'none';
    }
}

function hideSurveyOverlay() {
    document.getElementById('survey-overlay')?.remove();
}
