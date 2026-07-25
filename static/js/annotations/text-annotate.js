// Text-box annotation tool.
//
// Click anywhere on the slide with the text tool active and a small,
// borderless textbox opens right there. Font is fixed (one simple sans),
// size is one of three dots (small/regular/large) in the flyout sidebar.
// Segments wrapped in $$...$$ are rendered as LaTeX (via a vendored,
// offline copy of MathJax's SVG output) and baked onto the annotation
// canvas bitmap alongside the plain text when the box is committed.
import { bus } from '../core/events.js';

const FONT_FAMILY = 'Arial, Helvetica, sans-serif';
const SIZE_PX = { small: 16, regular: 22, large: 32 };
const TEXT_COLOR = '#242424';
const MATHJAX_SRC = '/static/vendor/mathjax/tex-svg.js';

/* ─── MathJax (lazy-loaded, offline, SVG output) ──────────────────────── */
// SVG output is used (rather than KaTeX's HTML+webfont output) specifically
// because it's self-contained vector paths — no font metrics/loading race to
// worry about when we serialize the <svg> and rasterize it onto the canvas.
let _mjReadyPromise = null;
function ensureMathJax() {
    if (window.MathJax?.tex2svg) return Promise.resolve(window.MathJax);
    if (_mjReadyPromise) return _mjReadyPromise;

    window.MathJax = {
        tex: { inlineMath: [['$$', '$$']] },
        svg: { fontCache: 'local' },   // each <svg> carries its own glyph defs
        startup: { typeset: false },
    };
    _mjReadyPromise = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = MATHJAX_SRC;
        script.onload = () => {
            const p = window.MathJax?.startup?.promise;
            if (p) p.then(() => resolve(window.MathJax)).catch(reject);
            else resolve(window.MathJax);
        };
        script.onerror = () => reject(new Error('Failed to load MathJax'));
        document.head.appendChild(script);
    });
    return _mjReadyPromise;
}

// Render a single TeX expression to a ready-to-draw <img>, sized in real
// px (not MathJax's ambient `ex` units) and with the baseline offset needed
// to line it up with surrounding canvas text.
async function texToImage(tex, fontSizePx) {
    let MathJax;
    try {
        MathJax = await ensureMathJax();
    } catch {
        return null;
    }

    let container;
    try {
        container = MathJax.tex2svg(tex, { display: false });
    } catch {
        return null;
    }
    const svg = container?.querySelector?.('svg');
    if (!svg) return null;

    const viewBox = (svg.getAttribute('viewBox') || '').trim().split(/\s+/).map(Number);
    if (viewBox.length !== 4 || viewBox.some(Number.isNaN)) return null;
    const [, minY, vbW, vbH] = viewBox;
    if (!vbW || !vbH) return null;

    // MathJax's SVG viewBox is 1000 units per em, baseline at y=0.
    const scale = fontSizePx / 1000;
    const width = Math.max(1, vbW * scale);
    const height = Math.max(1, vbH * scale);
    const baselineFromTop = Math.max(0, -minY * scale);

    svg.setAttribute('width', String(width));
    svg.setAttribute('height', String(height));
    svg.removeAttribute('style');

    const xml = new XMLSerializer().serializeToString(svg);
    const dataUrl = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml);

    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve({ img, width, height, baselineFromTop });
        img.onerror = () => resolve(null);
        img.src = dataUrl;
    });
}

/* ─── per-slide box bookkeeping (for "reclick to edit") ───────────────── */
// The rendered pixels for a committed box live only in the canvas bitmap (same
// as every other annotation tool), but we keep lightweight metadata — where it
// is, how big, and its raw text — so a later tap in that spot can reopen it
// instead of stamping a new box on top. This is in-memory only (not part of
// the saved ZIP), so it survives navigation within a session but a box is no
// longer separately editable after a fresh reload — it's just baked-in ink at
// that point, like anything else drawn on the canvas.
function boxesForSlide(state, slideIdx) {
    if (!state.textBoxes) state.textBoxes = {};
    if (!state.textBoxes[slideIdx]) state.textBoxes[slideIdx] = [];
    return state.textBoxes[slideIdx];
}

function slideIndexForCvs(cvs, state) {
    return cvs === state.annCvs2 ? state.rightSlideIndex : state.currentSlide;
}

function findBoxAt(state, slideIdx, pos) {
    const boxes = boxesForSlide(state, slideIdx);
    // Search newest-first so overlapping boxes resolve to the most recent one.
    for (let i = boxes.length - 1; i >= 0; i--) {
        const b = boxes[i];
        if (pos.x >= b.x && pos.x <= b.x + b.w && pos.y >= b.y && pos.y <= b.y + b.h) return b;
    }
    return null;
}

/* ─── $$...$$ parsing ──────────────────────────────────────────────────── */
function parseLineSegments(line) {
    const segments = [];
    const re = /\$\$([\s\S]+?)\$\$/g;
    let lastIndex = 0, m;
    while ((m = re.exec(line))) {
        if (m.index > lastIndex) segments.push({ type: 'text', value: line.slice(lastIndex, m.index) });
        segments.push({ type: 'math', value: m[1].trim() });
        lastIndex = re.lastIndex;
    }
    if (lastIndex < line.length) segments.push({ type: 'text', value: line.slice(lastIndex) });
    if (segments.length === 0) segments.push({ type: 'text', value: '' });
    return segments;
}

/* ─── rasterize the finished box onto the annotation canvas ──────────── */
// If `oldBox` is given (editing an existing box), its old footprint is erased
// first. Returns the new box's measured {width, height} so the caller can
// update the hit-test metadata, or null if nothing was drawn (empty text).
async function commitTextAnnotation(cvs, x, y, rawText, size, oldBox) {
    const ctx = cvs.ctx;
    const text = rawText.replace(/\r\n/g, '\n');

    if (oldBox) {
        ctx.clearRect(oldBox.x, oldBox.y, oldBox.w, oldBox.h);
    }
    if (!text.trim()) {
        if (oldBox) cvs.commitHistory();   // editing down to empty = delete
        return null;
    }

    const fontSizePx = SIZE_PX[size] || SIZE_PX.regular;
    const lineHeight = fontSizePx * 1.35;
    const linesSegments = text.split('\n').map(parseLineSegments);

    // Pre-render every math segment before touching the canvas — drawImage
    // needs the images decoded, and we don't want a half-drawn box on screen.
    for (const segs of linesSegments) {
        for (const seg of segs) {
            if (seg.type === 'math' && seg.value) {
                seg.rendered = await texToImage(seg.value, fontSizePx);
            }
        }
    }

    ctx.save();
    ctx.textBaseline = 'alphabetic';

    let maxWidth = 0;
    let baselineY = y + fontSizePx * 0.95;
    for (const segs of linesSegments) {
        let cursorX = x;
        for (const seg of segs) {
            if (seg.type === 'text') {
                if (!seg.value) continue;
                ctx.font = `${fontSizePx}px ${FONT_FAMILY}`;
                ctx.fillStyle = TEXT_COLOR;
                ctx.fillText(seg.value, cursorX, baselineY);
                cursorX += ctx.measureText(seg.value).width;
            } else if (seg.rendered) {
                const { img, width, height, baselineFromTop } = seg.rendered;
                ctx.drawImage(img, cursorX, baselineY - baselineFromTop, width, height);
                cursorX += width + 2;
            } else if (seg.value) {
                // MathJax failed to load/parse — fall back to the raw markup
                // rather than silently dropping it.
                const fallback = `$$${seg.value}$$`;
                ctx.font = `${fontSizePx}px ${FONT_FAMILY}`;
                ctx.fillStyle = TEXT_COLOR;
                ctx.fillText(fallback, cursorX, baselineY);
                cursorX += ctx.measureText(fallback).width;
            }
        }
        maxWidth = Math.max(maxWidth, cursorX - x);
        baselineY += lineHeight;
    }
    ctx.restore();
    cvs.commitHistory();

    const totalHeight = linesSegments.length * lineHeight + fontSizePx * 0.4;
    return { width: Math.max(1, maxWidth), height: Math.max(1, totalHeight) };
}

/* ─── the floating DOM editor ──────────────────────────────────────────── */
function autoGrow(box) {
    box.style.height = 'auto';
    box.style.height = `${box.scrollHeight}px`;

    const lines = box.value.split('\n');
    const longest = lines.reduce((a, b) => (b.length > a.length ? b : a), '');
    const probe = document.createElement('span');
    probe.style.cssText = 'visibility:hidden;position:fixed;left:-9999px;white-space:pre;';
    probe.style.font = `${box.style.fontSize} ${FONT_FAMILY}`;
    probe.textContent = longest || box.placeholder || '';
    document.body.appendChild(probe);
    box.style.width = `${Math.max(120, probe.offsetWidth + 24)}px`;
    probe.remove();
}

function openTextEditor(cvs, state, pos) {
    // Starting a new box while one is already open commits the old one first
    // (rather than discarding it) — clicking around to drop several text
    // boxes shouldn't lose whatever was already typed.
    closeActiveEditor(state, true);

    const container = cvs.canvas.parentElement;
    if (!container) return;

    // Tapping inside an existing box's footprint reopens it for editing
    // (pre-filled) instead of stamping a new box on top of it.
    const slideIdx = slideIndexForCvs(cvs, state);
    const editingBox = findBoxAt(state, slideIdx, pos);

    const size = editingBox ? editingBox.size : (state.textSize || 'regular');
    const startX = editingBox ? editingBox.x : pos.x;
    const startY = editingBox ? editingBox.y : pos.y;

    const box = document.createElement('textarea');
    box.className = 'text-annotation-editor';
    box.rows = 1;
    box.spellcheck = false;
    box.placeholder = 'Type… $$x^2$$ for math';
    if (editingBox) box.value = editingBox.text;

    // Keep the box from opening mostly off the edge of the slide when the
    // user clicks near the right/bottom border.
    const rect = cvs.canvas.getBoundingClientRect();
    const clampedX = Math.max(0, Math.min(startX, Math.max(0, rect.width - 130)));
    const clampedY = Math.max(0, Math.min(startY, Math.max(0, rect.height - 32)));
    box.style.left = `${clampedX}px`;
    box.style.top = `${clampedY}px`;
    box.style.fontSize = `${SIZE_PX[size] || SIZE_PX.regular}px`;

    container.appendChild(box);

    const entry = { box, cvs, size, editingBox, slideIdx };
    state._textEditor = entry;

    autoGrow(box);
    box.focus();
    if (editingBox) {
        const len = box.value.length;
        box.setSelectionRange(len, len);   // cursor at end, ready to append/fix
    }

    box.addEventListener('input', () => autoGrow(box));

    box.addEventListener('keydown', (e) => {
        // Keep typing (including letters that double as tool shortcuts) from
        // leaking to the document-level keyboard-shortcut handler.
        e.stopPropagation();
        if (e.key === 'Escape') {
            e.preventDefault();
            closeActiveEditor(state, false, true);
        }
    });

    box.addEventListener('blur', (e) => {
        // Picking a size dot also blurs the textarea — that's an in-tool
        // interaction, not "leaving" the box, so don't close it. The sidebar
        // click handler refocuses the box right after.
        const next = e.relatedTarget;
        if (next && next.closest && next.closest('#text-size-sidebar')) return;
        // Only fires here if the pointerdown-capture listener below didn't
        // already handle this (e.g. Tab-key or programmatic focus changes,
        // rather than a click).
        if (state._textEditor === entry) closeActiveEditor(state, true, true);
    });

    bus.emit('textbox:opened');
}

// Returns a promise that resolves once the annotation (if any) has actually
// been rasterized and committed to the canvas's history — callers that read
// a snapshot right after (goToSlide, split-view toggle, …) need to wait for
// this, since LaTeX segments render asynchronously (MathJax load + typeset).
//
// `revert`, when true, switches back to whichever tool/pen was active before
// Text was selected — Text is a one-shot "place a box, you're done" tool, so
// finishing one (by committing or cancelling) hands control back automatically.
// Internal callers that are about to open another editor right away (e.g.
// re-clicking to place the next box while the previous one is still open)
// pass revert=false so that in-progress hand-off isn't interrupted.
function closeActiveEditor(state, commit, revert = false) {
    const entry = state._textEditor;
    if (!entry) return Promise.resolve();
    state._textEditor = null;

    const { box, cvs, size, editingBox, slideIdx } = entry;
    const text = box.value;
    const x = parseFloat(box.style.left) || 0;
    const y = parseFloat(box.style.top) || 0;
    box.remove();

    // Cancelling an edit (Escape) leaves the original box exactly as it was —
    // nothing was drawn or cleared yet, so there's nothing to undo.
    if (!commit) {
        if (revert) restorePreviousSelection();
        return Promise.resolve();
    }

    return commitTextAnnotation(cvs, x, y, text, size, editingBox).then((dims) => {
        const boxes = boxesForSlide(state, slideIdx);
        if (editingBox) {
            const i = boxes.indexOf(editingBox);
            if (i !== -1) boxes.splice(i, 1);
        }
        if (dims) {
            boxes.push({ x, y, w: dims.width, h: dims.height, size, text });
        }
        bus.emit('textbox:committed');
        if (revert) restorePreviousSelection();
    });
}

/* ─── remember the tool/pen active before Text was selected ──────────── */
// Text is a "place one box and you're done" tool (like Spotlight — see
// slides/spotlight.js for the same pattern): once you click away from it,
// switch back automatically instead of leaving Text selected. Pens don't fire
// 'tool:change' (only 'pen:select'), so both are tracked to restore whichever
// was really active, not just a generic fallback.
let _prevSelection = { kind: 'tool', value: 'hand' };

bus.on('tool:change', (tool) => {
    if (tool !== 'text') _prevSelection = { kind: 'tool', value: tool };
});
bus.on('pen:select', (pen) => {
    _prevSelection = { kind: 'pen', value: pen.slot };
});

// Re-clicks the actual button/pen-slot so its own click handler runs exactly
// as if the user had picked it themselves (selection highlight, canvas mode,
// sidebar visibility, etc. all stay in sync automatically).
function restorePreviousSelection() {
    if (_prevSelection.kind === 'pen') {
        document.querySelectorAll('#pen-slots .pen-slot-btn')[_prevSelection.value]?.click();
    } else {
        document.querySelector(`#tool-container .tool-btn[data-tool="${_prevSelection.value}"]`)?.click();
    }
}

/* ─── public API ────────────────────────────────────────────────────── */
// Wires the small size sidebar (small/regular/large dots). Call once at
// startup, same as the other annotation feature modules.
export function initTextAnnotations(state) {
    state.textSize = state.textSize || 'regular';

    const sidebar = document.getElementById('text-size-sidebar');
    if (sidebar) {
        const buttons = sidebar.querySelectorAll('.btn[data-size]');
        buttons.forEach(btn => {
            btn.classList.toggle('btn_selected', btn.dataset.size === state.textSize);
            btn.addEventListener('click', () => {
                buttons.forEach(b => b.classList.toggle('btn_selected', b === btn));
                state.textSize = btn.dataset.size;
                bus.emit('textsize:select', state.textSize);
            });
        });
    }

    // Live-resize the box that's currently being edited (if any) and hand
    // focus straight back to it so typing can continue uninterrupted.
    bus.on('textsize:select', (size) => {
        const entry = state._textEditor;
        if (!entry) return;
        entry.size = size;
        entry.box.style.fontSize = `${SIZE_PX[size] || SIZE_PX.regular}px`;
        autoGrow(entry.box);
        entry.box.focus();
    });

    // Belt-and-suspenders: commit an open box the moment the user interacts
    // with anything else (a toolbar button, the slide navigator, etc.), not
    // just when the textarea itself blurs. Capture phase so it runs before
    // whatever was clicked handles its own click.
    document.addEventListener('pointerdown', (e) => {
        const entry = state._textEditor;
        if (!entry) return;
        if (e.target === entry.box) return;
        if (e.target.closest && e.target.closest('#text-size-sidebar')) return;
        // Text is a one-shot tool: any click away from the box — the canvas,
        // a toolbar button, anywhere — commits it and hands control back to
        // whatever tool/pen was active before Text was selected.
        closeActiveEditor(state, true, true);
    }, true);

    // Clicking an existing text box with the Hand tool reopens it for editing
    // too — you shouldn't have to reselect the Text tool just to fix a typo.
    // The annotation canvas has pointer-events:none in Hand mode (so clicks
    // pass through to widgets/video underneath), so this can't just be a
    // canvas click listener — it has to check every hand-mode pointerdown
    // against the known box positions itself, before anything under it reacts.
    document.addEventListener('pointerdown', (e) => {
        if (state.annotationTool !== 'hand' || state._textEditor) return;

        const panes = [
            { cvs: state.annCvs,  pdf: document.getElementById('pdf-canvas') },
            { cvs: state.annCvs2, pdf: document.getElementById('pdf-canvas-2') },
        ];
        for (const { cvs, pdf } of panes) {
            if (!cvs || !pdf) continue;
            const rect = pdf.getBoundingClientRect();
            if (!rect.width || !rect.height) continue;
            if (e.clientX < rect.left || e.clientX > rect.right ||
                e.clientY < rect.top  || e.clientY > rect.bottom) continue;

            const pos = { x: e.clientX - rect.left, y: e.clientY - rect.top };
            const slideIdx = slideIndexForCvs(cvs, state);
            const hit = findBoxAt(state, slideIdx, pos);
            if (!hit) continue;

            // Keep whatever's underneath (a widget, a video) from also
            // reacting to this same click.
            e.preventDefault();
            e.stopPropagation();
            // Switch into the Text tool so all the usual editing machinery —
            // size sidebar, widget click-through, revert-to-Hand on close —
            // applies exactly as if the user had selected Text themselves.
            document.querySelector('#tool-container .tool-btn[data-tool="text"]')?.click();
            openTextEditor(cvs, state, pos);
            return;
        }
    }, true);
}

// Wires a single annotation Canvas instance (left or right pane) so a click
// while the text tool is active places an editor at that point. Call for
// state.annCvs at startup and again for state.annCvs2 once split view
// creates it.
export function wireTextCanvas(cvs, state) {
    if (!cvs || cvs._textWired) return;
    cvs._textWired = true;
    cvs.onTextPlace = (pos) => openTextEditor(cvs, state, pos);
}

// If a box is open when the user switches away from the text tool via a
// route that doesn't naturally blur it (e.g. a keyboard shortcut), commit it.
// Returns a promise — await it before reading/saving a canvas snapshot.
export function commitOpenTextEditor(state) {
    return closeActiveEditor(state, true);
}

// Forget the reclick-to-edit metadata for one slide — call wherever the
// annotation bitmap itself gets wiped (Clear All, eraser hold-to-clear) so a
// later tap doesn't "find" a box that no longer has any pixels.
export function clearTextBoxes(state, slideIdx) {
    if (state.textBoxes) state.textBoxes[slideIdx] = [];
}

// Forget every slide's metadata — call when a new/different presentation loads.
export function resetAllTextBoxes(state) {
    state.textBoxes = {};
}
