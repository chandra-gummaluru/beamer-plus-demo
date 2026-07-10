import { createSession, getLastSession, saveLastSession, sessionExists } from './session.js';

const createBtn = document.getElementById('welcome-create-btn');
const continueBtn = document.getElementById('welcome-continue-btn');
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

async function handleContinue() {
    const sessionId = getLastSession();
    if (!sessionId) return;
    setStatus('Checking session…');
    continueBtn.disabled = true;
    if (!(await sessionExists(sessionId))) {
        setStatus('That session is no longer available. Start a new one instead.', true);
        continueBtn.hidden = true;
        continueBtn.disabled = false;
        return;
    }
    goToSession(sessionId);
}

createBtn?.addEventListener('click', handleCreate);
continueBtn?.addEventListener('click', handleContinue);

(async () => {
    const last = getLastSession();
    if (!last || !continueBtn) return;
    if (await sessionExists(last)) {
        continueBtn.hidden = false;
    }
})();
