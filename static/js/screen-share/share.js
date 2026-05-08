export function initShare(state) {
    const btn = document.getElementById('screen-share-btn');
    if (!btn) return;

    state.viewerMuted = true;
    syncButtonState();

    btn.addEventListener('click', async () => {
        state.viewerMuted = !state.viewerMuted;
        syncButtonState();
        state.socket?.emit(state.viewerMuted ? 'screen_share_stop' : 'screen_share_start');
    });

    function syncButtonState() {
        btn.classList.toggle('is-sharing', !state.viewerMuted);
        btn.title = state.viewerMuted ? 'Unmute viewer' : 'Mute viewer';
    }
}
