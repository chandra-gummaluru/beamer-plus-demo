import { createSession, saveLastSession } from './session.js';

const createBtn = document.getElementById('welcome-create-btn');
const statusEl = document.getElementById('welcome-status');

function setStatus(msg, isError = false) {
    if (!statusEl) return;
    statusEl.textContent = msg;
    statusEl.classList.toggle('is-error', isError);
}

function goToSession(sessionId) {
    saveLastSession(sessionId);
    window.location.href = `/s/${sessionId}/`;
}

async function handleCreate() {
    setStatus('Creating session…');
    createBtn.disabled = true;
    try {
        const data = await createSession();
        goToSession(data.session_id);
    } catch {
        setStatus('Could not create a session. Try again.', true);
        createBtn.disabled = false;
    }
}

createBtn?.addEventListener('click', handleCreate);
