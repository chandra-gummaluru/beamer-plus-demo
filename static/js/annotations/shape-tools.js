// Shape sidebar — line / rect / circle / triangle.
import { bus } from '../core/events.js';

export function initShapeTools(state) {
    const sidebar = document.getElementById('shape-sidebar');
    if (!sidebar) return;
    sidebar.querySelectorAll('.btn').forEach(btn => {
        btn.addEventListener('click', () => {
            sidebar.querySelectorAll('.btn').forEach(b => b.classList.toggle('btn_selected', b === btn));
            state.shape = btn.dataset.shape;
            bus.emit('shape:select', state.shape);
        });
    });
}
