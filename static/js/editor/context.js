// Shared editor context — the presenter-state handle, current selections,
// and small helpers used by every editor module.

export const ctx = {
    state: null,            // shared presenter state (set by initEditor)
    selectedOverlay: null,  // { div, arrKey, index } or null
    selectedViewIdx: null,  // structure index of the view slide being configured, or null
};

export function getSlideEl() { return document.getElementById('pdf-canvas'); }

export function getCurrentPdfIndex() {
    const obj = ctx.state.slideStructure[ctx.state.currentSlide];
    return obj?.type === 'pdf' ? obj.pdfIndex : null;
}

export function getOrCreateConfig() {
    const obj = ctx.state.slideStructure[ctx.state.currentSlide];
    if (!obj) return null;
    // PDF slides use their stable pdfIndex; blank slides use their stable blankId.
    const key = obj.type === 'pdf' ? obj.pdfIndex
              : obj.type === 'blank' ? obj.blankId
              : null;
    if (key === null || key === undefined) return null;
    if (!ctx.state.slideConfigs[key]) ctx.state.slideConfigs[key] = {};
    return ctx.state.slideConfigs[key];
}

export function arrKeyForType(type) {
    return type === 'video' ? 'videos' : type === 'audio' ? 'audios' : type === 'model' ? 'models' : 'widgets';
}

export function getConfigItems(cfg) {
    return [
        ...(cfg.videos  || []).map((v, i) => ({ type: 'video',  arrKey: 'videos',  item: v, index: i })),
        ...(cfg.audios  || []).map((a, i) => ({ type: 'audio',  arrKey: 'audios',  item: a, index: i })),
        ...(cfg.models  || []).map((m, i) => ({ type: 'model',  arrKey: 'models',  item: m, index: i })),
        ...(cfg.widgets || []).map((w, i) => ({ type: 'widget', arrKey: 'widgets', item: w, index: i })),
    ];
}

/* ─── HTML escaping for panel markup ────────────────────────── */

export function escAttr(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function escHtml(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Safe element-id fragment for a custom field key (avoids CSS.escape dependency)
export function fieldId(key) {
    return 'prop-custom-' + key.replace(/[^a-zA-Z0-9_-]/g, '_');
}

/* ─── file picking ──────────────────────────────────────────── */

export function pickFile(accept) {
    return new Promise(resolve => {
        const inp = document.createElement('input');
        inp.type = 'file';
        inp.accept = accept || '*';
        inp.addEventListener('change', () => resolve(inp.files?.[0] ?? null));
        inp.addEventListener('cancel',  () => resolve(null));
        inp.click();
    });
}
