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

    const _ZIP_SVG    = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="12" x2="12" y2="18"/><polyline points="9 15 12 18 15 15"/></svg>`;
    const _FOLDER_SVG = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`;
    const _PDF_SVG    = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="12" y2="17"/></svg>`;

    const options = [
        { type: 'zip',    svg: _ZIP_SVG,    label: 'Upload ZIP File' },
        { type: 'folder', svg: _FOLDER_SVG, label: 'Select Folder' },
        { type: 'pdf',    svg: _PDF_SVG,    label: 'Upload PDF' },
    ];

    options.forEach(({ type, svg, label }) => {
        const btn = document.createElement('button');
        btn.className = 'custom-modal-btn upload-option-btn';
        btn.innerHTML = `${svg} ${label}`;
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
