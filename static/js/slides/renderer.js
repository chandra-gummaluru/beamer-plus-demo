// Renderer — slot for PDF.js / image / video / widget rendering pipeline.
// In the existing app this is where canvas.js + iframe-widget-renderer.js are coordinated.
import { bus } from '../core/events.js';

export function initRenderer(state) {
    bus.on('slide:changed', (i) => {
        // showLoading(); pdf.render(i).then(hideLoading);
    });
}
