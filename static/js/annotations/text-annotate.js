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
async function commitTextAnnotation(cvs, x, y, rawText, size) {
    const text = rawText.replace(/\r\n/g, '\n');
    if (!text.trim()) return;

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

    const ctx = cvs.ctx;
    ctx.save();
    ctx.textBaseline = 'alphabetic';

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
        baselineY += lineHeight;
    }
    ctx.restore();
    cvs.commitHistory();
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

    const size = state.textSize || 'regular';
    const box = document.createElement('textarea');
    box.className = 'text-annotation-editor';
    box.rows = 1;
    box.spellcheck = false;
    box.placeholder = 'Type… $$x^2$$ for math';
    box.style.left = `${pos.x}px`;
    box.style.top = `${pos.y}px`;
    box.style.fontSize = `${SIZE_PX[size] || SIZE_PX.regular}px`;

    container.appendChild(box);

    const entry = { box, cvs, size };
    state._textEditor = entry;

    autoGrow(box);
    box.focus();

    box.addEventListener('input', () => autoGrow(box));

    box.addEventListener('keydown', (e) => {
        // Keep typing (including letters that double as tool shortcuts) from
        // leaking to the document-level keyboard-shortcut handler.
        e.stopPropagation();
        if (e.key === 'Escape') {
            e.preventDefault();
            closeActiveEditor(state, false);
        }
    });

    box.addEventListener('blur', (e) => {
        // Picking a size dot also blurs the textarea — that's an in-tool
        // interaction, not "leaving" the box, so don't close it. The sidebar
        // click handler refocuses the box right after.
        const next = e.relatedTarget;
        if (next && next.closest && next.closest('#text-size-sidebar')) return;
        if (state._textEditor === entry) closeActiveEditor(state, true);
    });

    bus.emit('textbox:opened');
}

// Returns a promise that resolves once the annotation (if any) has actually
// been rasterized and committed to the canvas's history — callers that read
// a snapshot right after (goToSlide, split-view toggle, …) need to wait for
// this, since LaTeX segments render asynchronously (MathJax load + typeset).
function closeActiveEditor(state, commit) {
    const entry = state._textEditor;
    if (!entry) return Promise.resolve();
    state._textEditor = null;

    const { box, cvs, size } = entry;
    const text = box.value;
    const x = parseFloat(box.style.left) || 0;
    const y = parseFloat(box.style.top) || 0;
    box.remove();

    if (commit && text.trim()) {
        return commitTextAnnotation(cvs, x, y, text, size).then(() => bus.emit('textbox:committed'));
    }
    return Promise.resolve();
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
        closeActiveEditor(state, true);
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
