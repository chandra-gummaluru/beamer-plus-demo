// Slide navigator — left rail in default view, bottom rail in split-view/mobile.
// State management and slide rendering live in main.js; this module is a thin init hook.
import { bus } from '../core/events.js';

export function initNavigator(state) {
    // Scroll the current slide into view whenever the slide changes
    bus.on('slide:changed', (i) => {
        const item = document.querySelector(`.slide-nav-item[data-index="${i}"]`);
        item?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
}
