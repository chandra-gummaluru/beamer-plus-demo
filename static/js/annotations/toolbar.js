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

    document.getElementById('annotation-undo')?.addEventListener('click', () => bus.emit('annotation:undo'));
    document.getElementById('annotation-redo')?.addEventListener('click', () => bus.emit('annotation:redo'));
    document.getElementById('annotation-clear-btn')?.addEventListener('click', () => bus.emit('annotation:clear'));
}
