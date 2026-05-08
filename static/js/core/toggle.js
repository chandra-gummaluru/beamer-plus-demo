// Generic toggle helper — kept thin; legacy .toggle_on/.toggle_off classes.
export function initToggle() {
    document.querySelectorAll('[data-toggle-pair]').forEach(el => {
        el.addEventListener('click', () => {
            el.classList.toggle('toggle_on');
            el.classList.toggle('toggle_off');
        });
    });
}
