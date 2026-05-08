// Wires up generic .btn elements and selected-state toggles.
export function initButtons() {
    document.querySelectorAll('.btn[data-toggle]').forEach(btn => {
        btn.addEventListener('click', () => btn.classList.toggle('btn_selected'));
    });

    // Radio groups: data-radio-group="<name>"
    const groups = new Map();
    document.querySelectorAll('.btn[data-radio-group]').forEach(btn => {
        const g = btn.dataset.radioGroup;
        if (!groups.has(g)) groups.set(g, []);
        groups.get(g).push(btn);
    });
    groups.forEach(btns => {
        btns.forEach(btn => btn.addEventListener('click', () => {
            btns.forEach(b => b.classList.toggle('btn_selected', b === btn));
        }));
    });
}
