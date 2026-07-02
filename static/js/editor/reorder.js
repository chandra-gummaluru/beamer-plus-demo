// Slide reordering — drag & drop of navigator thumbnails while in edit mode.
// Reordering remaps every structure-index-keyed piece of state (annotations,
// bookmarks, view pane references, current slide) through the same old→new
// index permutation.
import { bus } from '../core/events.js';
import { ctx } from './context.js';

let _dragSrc = null;
let _slideReorderListeners = [];

export function applySlideReorder() {
    removeSlideReorder();
    // Scoped to #slide-nav-slides: bookmark pins share the `.slide-nav-item`
    // class but live in #bookmark-pins and aren't part of the slide structure.
    // An unscoped query would make pins draggable and shift every real item's
    // index by the pin count, corrupting reorderSlide's from/to indices.
    const items = document.querySelectorAll('#slide-nav-slides .slide-nav-item');
    items.forEach((item, i) => {
        item.setAttribute('draggable', 'true');

        const onDragStart = (e) => { _dragSrc = i; item.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; };
        const onDragOver  = (e) => {
            e.preventDefault();
            if (_dragSrc === null || _dragSrc === i) return;
            items.forEach(el => el.classList.remove('drag-over-before', 'drag-over-after'));
            const rect    = item.getBoundingClientRect();
            const isHoriz = document.body.classList.contains('split-view-active') || window.innerWidth <= 1024;
            item.classList.add(
                (isHoriz ? e.clientX < rect.left + rect.width / 2 : e.clientY < rect.top + rect.height / 2)
                    ? 'drag-over-before' : 'drag-over-after'
            );
            e.dataTransfer.dropEffect = 'move';
        };
        const onDragLeave = () => item.classList.remove('drag-over-before', 'drag-over-after');
        const onDrop = (e) => {
            e.preventDefault();
            if (_dragSrc === null || _dragSrc === i) return;
            const rect    = item.getBoundingClientRect();
            const isHoriz = document.body.classList.contains('split-view-active') || window.innerWidth <= 1024;
            const before  = isHoriz ? e.clientX < rect.left + rect.width / 2 : e.clientY < rect.top + rect.height / 2;
            reorderSlide(_dragSrc, before ? i : i + 1);
            item.classList.remove('drag-over-before', 'drag-over-after');
        };
        const onDragEnd = () => {
            item.classList.remove('dragging');
            items.forEach(el => el.classList.remove('drag-over-before', 'drag-over-after'));
            _dragSrc = null;
        };

        item.addEventListener('dragstart', onDragStart);
        item.addEventListener('dragover',  onDragOver);
        item.addEventListener('dragleave', onDragLeave);
        item.addEventListener('drop',      onDrop);
        item.addEventListener('dragend',   onDragEnd);
        _slideReorderListeners.push({ item, onDragStart, onDragOver, onDragLeave, onDrop, onDragEnd });
    });
}

export function removeSlideReorder() {
    _slideReorderListeners.forEach(({ item, onDragStart, onDragOver, onDragLeave, onDrop, onDragEnd }) => {
        item.removeAttribute('draggable');
        item.removeEventListener('dragstart', onDragStart);
        item.removeEventListener('dragover',  onDragOver);
        item.removeEventListener('dragleave', onDragLeave);
        item.removeEventListener('drop',      onDrop);
        item.removeEventListener('dragend',   onDragEnd);
    });
    _slideReorderListeners = [];
}

function reorderSlide(fromIndex, insertBefore) {
    if (fromIndex === insertBefore || fromIndex === insertBefore - 1) return;
    const struct   = ctx.state.slideStructure;
    const n        = struct.length;
    const oldAnnot = { ...ctx.state.annotations };

    const [moved] = struct.splice(fromIndex, 1);
    const actualInsert = fromIndex < insertBefore ? insertBefore - 1 : insertBefore;
    struct.splice(actualInsert, 0, moved);

    const oldToNew = new Array(n);
    for (let i = 0; i < n; i++) {
        if (i === fromIndex)                                                  oldToNew[i] = actualInsert;
        else if (fromIndex < insertBefore && i > fromIndex && i < insertBefore) oldToNew[i] = i - 1;
        else if (fromIndex >= insertBefore && i >= insertBefore && i < fromIndex) oldToNew[i] = i + 1;
        else                                                                  oldToNew[i] = i;
    }

    ctx.state.annotations = {};
    for (const [k, v] of Object.entries(oldAnnot)) {
        const newI = oldToNew[parseInt(k)];
        if (newI !== undefined && v) ctx.state.annotations[newI] = v;
    }

    // Bookmarks are keyed by structure index too — remap them the same way.
    const oldBookmarks = { ...ctx.state.bookmarks };
    ctx.state.bookmarks = {};
    for (const [k, v] of Object.entries(oldBookmarks)) {
        const newI = oldToNew[parseInt(k)];
        if (newI !== undefined && v) ctx.state.bookmarks[newI] = v;
    }

    // View slides reference their pane slides by structure index — remap those
    // so a saved split view still shows the same two slides after reordering.
    for (const obj of struct) {
        if (obj.type !== 'view') continue;
        if (obj.left  !== undefined && oldToNew[obj.left]  !== undefined) obj.left  = oldToNew[obj.left];
        if (obj.right !== undefined && oldToNew[obj.right] !== undefined) obj.right = oldToNew[obj.right];
    }

    ctx.state.currentSlide = oldToNew[ctx.state.currentSlide] ?? ctx.state.currentSlide;
    ctx.state.totalSlides  = struct.length;
    bus.emit('slides:reordered');
}
