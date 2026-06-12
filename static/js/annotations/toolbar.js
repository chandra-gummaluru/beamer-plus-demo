// Annotation toolbar — owns tool selection (pen/eraser/laser/shape/select).
import { bus } from '../core/events.js';

export function initToolbar(state) {
    const tools = document.querySelectorAll('#tool-container .tool-btn');
    tools.forEach(btn => {
        btn.addEventListener('click', () => {
            tools.forEach(b => b.classList.toggle('btn_selected', b === btn));
            state.annotationTool = btn.dataset.tool;
            const shapeSidebar = document.getElementById('shape-sidebar');
            if (shapeSidebar) shapeSidebar.style.display =
                btn.dataset.tool === 'shape' ? 'flex' : 'none';
            bus.emit('tool:change', btn.dataset.tool);
        });
    });
    // Note: undo / redo / clear buttons are wired directly to the canvas in
    // main.js (wireUndoRedo / wireAnnotationClear), so they're not handled here.
}
