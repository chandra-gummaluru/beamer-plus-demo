// Upload — shows modal with PDF / ZIP / folder options.
// Uses bus events to decouple from main.js.
import { bus } from '../core/events.js';

export function initUploader(state) {
    document.getElementById('upload-presentation-btn')?.addEventListener('click', showUploadModal);

    document.getElementById('upload-zip')?.addEventListener('change', async (e) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        bus.emit('upload:zip', file);
    });

    document.getElementById('upload-folder')?.addEventListener('change', async (e) => {
        const files = Array.from(e.target.files || []);
        e.target.value = '';
        if (!files.length) return;
        bus.emit('upload:folder', files);
    });

    document.getElementById('upload-pdf')?.addEventListener('change', async (e) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        bus.emit('upload:pdf', file);
    });
}

function showUploadModal() {
    const body = document.createElement('div');
    body.style.cssText = 'display:flex;flex-direction:column;gap:10px;';

    const options = [
        { type: 'zip',    icon: 'fa-file-zipper', label: 'Upload ZIP File' },
        { type: 'folder', icon: 'fa-folder-open',  label: 'Select Folder' },
        { type: 'pdf',    icon: 'fa-file-pdf',      label: 'Upload PDF' },
    ];

    options.forEach(({ type, icon, label }) => {
        const btn = document.createElement('button');
        btn.className = 'custom-modal-btn upload-option-btn';
        btn.innerHTML = `<i class="fa-solid ${icon}"></i> ${label}`;
        btn.addEventListener('click', () => {
            window.BeamerModal?.close();
            document.getElementById(`upload-${type}`)?.click();
        });
        body.appendChild(btn);
    });

    window.BeamerModal?.show({
        kind: 'info',
        title: 'Upload Presentation',
        message: 'Choose how you want to upload your presentation',
        body,
        buttons: [{ label: 'Cancel', kind: 'cancel' }],
    });
}
