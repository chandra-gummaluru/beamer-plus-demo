// Annotation toolbar — owns tool selection (pen/eraser/laser/shape/select).
import { bus } from '../core/events.js';

export function initToolbar(state) {
    const tools = document.querySelectorAll('#tool-container .tool-btn');
    tools.forEach(btn => {
        btn.addEventListener('click', () => {
            // Clear selection across the whole rail, not just the buttons this
            // module queried at init — pen slots are added afterwards (by
            // initPenSlots) and have their own 'btn_selected' class to clear too.
            document.querySelectorAll('#tool-container .btn').forEach(b => b.classList.remove('btn_selected'));
            btn.classList.add('btn_selected');
            state.annotationTool = btn.dataset.tool;
            const shapeSidebar = document.getElementById('shape-sidebar');
            if (shapeSidebar) shapeSidebar.style.display =
                btn.dataset.tool === 'shape' ? 'flex' : 'none';
            const textSidebar = document.getElementById('text-size-sidebar');
            if (textSidebar) textSidebar.style.display =
                btn.dataset.tool === 'text' ? 'flex' : 'none';
            bus.emit('tool:change', btn.dataset.tool);
        });
    });
    // Note: undo / redo / clear buttons are wired directly to the canvas in
    // main.js (wireUndoRedo / wireAnnotationClear), so they're not handled here.
}
