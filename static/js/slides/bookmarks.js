// Bookmarks — pin/unpin slides; pinned slides also appear in #bookmark-pins.
import { bus } from '../core/events.js';

export function initBookmarks(state) {
    bus.on('bookmark:toggle', (i) => toggle(i, state));
    bus.on('slide:changed', () => render(state));
}

function toggle(i, state) {
    if (state.bookmarks[i]) delete state.bookmarks[i];
    else state.bookmarks[i] = true;
    render(state);
    bus.emit('bookmarks:changed', state.bookmarks);
}

function render(state) {
    document.querySelectorAll('.slide-nav-item').forEach((el, idx) => {
        el.classList.toggle('bookmarked', !!state.bookmarks[idx]);
    });
    const pins = document.getElementById('bookmark-pins');
    if (!pins) return;
    const indices = Object.keys(state.bookmarks).map(Number).filter(i => state.bookmarks[i]);
    pins.style.display = indices.length ? 'flex' : 'none';
    pins.innerHTML = '';
    indices.sort((a, b) => a - b).forEach(i => {
        const original = document.querySelector(`.slide-nav-item[data-index="${i}"] .slide-preview`);
        if (!original) return;
        const item = document.createElement('div');
        item.className = 'slide-nav-item bookmarked';
        item.dataset.index = String(i);
        const preview = original.cloneNode(true);
        preview.classList.add('bookmark-preview');
        item.appendChild(preview);
        item.addEventListener('click', () => bus.emit('slide:goto', i));
        pins.appendChild(item);
    });
}
