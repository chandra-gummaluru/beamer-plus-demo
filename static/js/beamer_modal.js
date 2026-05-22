// beamer_modal.js
export const Modal = {
    show(type, title, message, onConfirm = null) {
        const existingModal = document.querySelector('.custom-modal-overlay');
        if (existingModal) existingModal.remove();
        
        const overlay = document.createElement('div');
        overlay.className = 'custom-modal-overlay';
        
        const iconSvg = {
            info:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
            error:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`,
            warning: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
            success: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`,
            confirm: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
        }[type] || `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`;

        const checkSvg = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>`;

        overlay.innerHTML = `
            <div class="custom-modal-content">
                <div class="custom-modal-icon">
                    ${iconSvg}
                </div>
                <h2 class="custom-modal-title">${title}</h2>
                <p class="custom-modal-message">${message}</p>
                <div class="custom-modal-buttons">
                    ${type === 'confirm' ? '<button class="custom-modal-btn custom-modal-btn-cancel">Cancel</button>' : ''}
                    <button class="custom-modal-btn custom-modal-btn-ok">${type === 'confirm' ? 'Okay' : checkSvg}</button>
                </div>
            </div>
        `;
        
        // Add type class for styling
        overlay.classList.add(`modal-${type}`);
        
        document.body.appendChild(overlay);
        
        const okBtn = overlay.querySelector('.custom-modal-btn-ok');
        const cancelBtn = overlay.querySelector('.custom-modal-btn-cancel');
        
        const close = (confirmed = false) => {
            overlay.remove();
            if (confirmed && onConfirm) onConfirm();
        };
        
        okBtn.onclick = () => close(true);
        if (cancelBtn) cancelBtn.onclick = () => close(false);
        overlay.onclick = (e) => {
            if (e.target === overlay) close(false);
        };
        
        okBtn.focus();
        
        const escHandler = (e) => {
            if (e.key === 'Escape') {
                close(false);
                document.removeEventListener('keydown', escHandler);
            }
        };
        document.addEventListener('keydown', escHandler);
    },
    
    loading(title, message) {
        const existingModal = document.querySelector('.custom-modal-overlay');
        if (existingModal) existingModal.remove();
        
        const overlay = document.createElement('div');
        overlay.className = 'custom-modal-overlay modal-loading';
        overlay.innerHTML = `
            <div class="custom-modal-content">
                <svg class="custom-modal-squiggle" viewBox="0 0 120 40" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                    <path d="M2 20 C20 2, 40 38, 58 20 C76 2, 96 38, 118 20" />
                </svg>
                <h2 class="custom-modal-title">${title}</h2>
                <p class="custom-modal-message">${message}</p>
            </div>
        `;
        
        document.body.appendChild(overlay);
        
        return {
            close: () => overlay.remove()
        };
    },
    
    info(title, message) { this.show('info', title, message); },
    error(title, message) { this.show('error', title, message); },
    warning(title, message) { this.show('warning', title, message); },
    success(title, message) { this.show('success', title, message); },
    confirm(title, message, onConfirm) { this.show('confirm', title, message, onConfirm); }
};
