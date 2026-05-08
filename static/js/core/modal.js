// Modal manager — paper card with backdrop blur.
// Public API: BeamerModal.show({ kind, title, message, buttons, body })
const Modal = {
    open: null,
    show({ kind = 'info', title = '', message = '', body = null, buttons = [{ label: 'OK', kind: 'ok' }] } = {}) {
        this.close();
        const overlay = document.createElement('div');
        overlay.className = `custom-modal-overlay modal-${kind}`;
        const content = document.createElement('div');
        content.className = 'custom-modal-content';

        if (kind === 'loading') {
            overlay.classList.add('modal-loading');
            content.innerHTML = `
                <svg class="custom-modal-squiggle" viewBox="0 0 120 40">
                    <path d="M5 20 Q 15 5, 25 20 T 45 20 T 65 20 T 85 20 T 105 20" />
                </svg>
                <h3 class="custom-modal-title">${title || 'Loading…'}</h3>
                <p class="custom-modal-message">${message}</p>
            `;
        } else {
            const icon = { error: '✕', success: '✓', warning: '!', info: 'i' }[kind] || '';
            content.innerHTML = `
                ${icon ? `<div class="custom-modal-icon">${icon}</div>` : ''}
                ${title ? `<h3 class="custom-modal-title">${title}</h3>` : ''}
                ${message ? `<p class="custom-modal-message">${message}</p>` : ''}
                <div class="custom-modal-body"></div>
                <div class="custom-modal-buttons"></div>
            `;
            const bodySlot = content.querySelector('.custom-modal-body');
            if (body instanceof Node) bodySlot.appendChild(body);
            else if (typeof body === 'string') bodySlot.innerHTML = body;

            const btnRow = content.querySelector('.custom-modal-buttons');
            buttons.forEach(b => {
                const btn = document.createElement('button');
                btn.className = `custom-modal-btn custom-modal-btn-${b.kind || 'cancel'}`;
                btn.textContent = b.label;
                btn.addEventListener('click', () => { b.onClick?.(); this.close(); });
                btnRow.appendChild(btn);
            });
        }

        overlay.appendChild(content);
        overlay.addEventListener('click', (e) => { if (e.target === overlay && kind !== 'loading') this.close(); });
        document.body.appendChild(overlay);
        this.open = overlay;
    },
    close() {
        if (this.open) { this.open.remove(); this.open = null; }
    },
};

export function initModal() {
    window.BeamerModal = Modal;
}
