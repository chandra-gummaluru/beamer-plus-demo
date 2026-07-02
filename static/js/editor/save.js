// Save — rebuilds the presentation ZIP from the in-memory state (slide
// configs, slide order, annotations, widget states, newly added files) and
// downloads it.
import { collectWidgetStates } from '../core/iframe-widget-renderer.js';
import { ctx } from './context.js';

export async function savePresentation() {
    if (!ctx.state.zipFile) {
        window.BeamerModal?.show({ kind: 'error', title: 'Nothing to save', message: 'No presentation loaded.' });
        return;
    }
    const modal = window.BeamerModal;
    modal?.show({ kind: 'loading', title: 'Saving…', message: 'Building ZIP…' });
    try {
        // Flush the current canvas so the latest strokes are captured.
        if (ctx.state.annCvs?.canvas) {
            ctx.state.annotations[ctx.state.currentSlide] = ctx.state.annCvs.canvas.toDataURL('image/png');
        }

        const newZip = new JSZip();

        for (const path of Object.keys(ctx.state.zipFile.files)) {
            const f = ctx.state.zipFile.file(path);
            if (!f || f.dir) continue;
            if (path.startsWith('config/s') && path.endsWith('.json')) continue;
            if (path === 'config/slide-order.json') continue;
            if (path === 'config/annotations.json') continue;
            if (path === 'config/widget-states.json') continue;
            newZip.file(path, await f.async('uint8array'));
        }

        for (const [pi, cfg] of Object.entries(ctx.state.slideConfigs)) {
            if (cfg) newZip.file(`config/s${pi}.json`, JSON.stringify(cfg, null, 2));
        }

        const isDefault = ctx.state.slideStructure.every((obj, i) => obj.type === 'pdf' && obj.pdfIndex === i);
        if (!isDefault) newZip.file('config/slide-order.json', JSON.stringify(ctx.state.slideStructure));

        // Save annotations so pen strokes persist across re-uploads.
        const nonEmptyAnnotations = Object.fromEntries(
            Object.entries(ctx.state.annotations).filter(([, v]) => v && v.length > 100)
        );
        if (Object.keys(nonEmptyAnnotations).length > 0) {
            newZip.file('config/annotations.json', JSON.stringify(nonEmptyAnnotations));
        }

        // Save widget states so interactive widgets resume where they left off.
        const widgetStates = await collectWidgetStates(1500);
        if (Object.keys(widgetStates).length > 0) {
            newZip.file('config/widget-states.json', JSON.stringify(widgetStates));
        }

        for (const [path, buffer] of Object.entries(ctx.state.editorNewFiles)) {
            newZip.file(path, buffer);
        }

        const blob = await newZip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
        const url  = URL.createObjectURL(blob);
        const a    = Object.assign(document.createElement('a'), { href: url, download: 'presentation-edited.zip' });
        a.click();
        URL.revokeObjectURL(url);
        modal?.close();
    } catch (err) {
        modal?.close();
        window.BeamerModal?.show({ kind: 'error', title: 'Save failed', message: err.message });
    }
}
