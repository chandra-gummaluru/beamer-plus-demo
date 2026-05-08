// Thumbnails — render slide-nav items, attach click handlers.
import { bus } from '../core/events.js';

export function initThumbnails(state) {
    bus.on('slides:loaded', (slides) => render(slides, state));
}

function render(slides, state) {
    const host = document.getElementById('slide-nav-slides');
    if (!host) return;
    host.innerHTML = '';
    state.totalSlides = slides.length;

    slides.forEach((s, i) => {
        const item = document.createElement('div');
        item.className = 'slide-nav-item';
        item.dataset.index = String(i);
        const preview = document.createElement('div');
        preview.className = 'slide-preview' + (s.kind === 'widget' ? ' slide-preview-widget' : s.kind === 'label' ? ' slide-preview-label' : '');
        const lbl = s.label || String(i + 1);
        preview.dataset.slideNumber = lbl;
        if (s.thumbUrl) {
            const img = document.createElement('img');
            img.src = s.thumbUrl;
            img.alt = s.title || `Slide ${lbl}`;
            preview.appendChild(img);
        } else {
            const span = document.createElement('span');
            span.textContent = s.title || `Slide ${lbl}`;
            preview.appendChild(span);
        }
        item.appendChild(preview);
        item.addEventListener('click', () => bus.emit('slide:goto', i));
        host.appendChild(item);
    });
    if (state.currentSlide < slides.length) {
        host.children[state.currentSlide]?.classList.add('current-slide');
    }
}
