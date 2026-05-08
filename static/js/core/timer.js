// Timer pill — click to start/pause, double-click to reset.
import { bus } from './events.js';

export function initTimer() {
    const el = document.querySelector('.timer_display');
    if (!el) return;

    let elapsed = 0;
    let running = false;
    let last = 0;
    let raf = 0;

    const fmt = (ms) => {
        const total = Math.floor(ms / 1000);
        const m = String(Math.floor(total / 60)).padStart(2, '0');
        const s = String(total % 60).padStart(2, '0');
        return `${m}:${s}`;
    };

    const render = () => { el.querySelector('.timer-text').textContent = fmt(elapsed); };

    const tick = (now) => {
        if (!running) return;
        elapsed += now - last;
        last = now;
        render();
        raf = requestAnimationFrame(tick);
    };

    el.addEventListener('click', () => {
        running = !running;
        el.classList.toggle('timer_running', running);
        if (running) { last = performance.now(); raf = requestAnimationFrame(tick); }
        else { cancelAnimationFrame(raf); }
    });

    el.addEventListener('dblclick', () => {
        running = false; elapsed = 0;
        el.classList.remove('timer_running');
        cancelAnimationFrame(raf);
        render();
    });

    bus.on('timer:reset', () => { running = false; elapsed = 0; el.classList.remove('timer_running'); render(); });
    render();
}
