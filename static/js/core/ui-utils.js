// ui-utils.js — control state helpers
export function setControlsEnabled(enabled, controls) {
    (controls || []).forEach(btn => {
        if (!btn?.el) return;
        btn.el.disabled = !enabled;
        btn.el.style.opacity = enabled ? '1' : '0.5';
        btn.el.style.cursor = enabled ? 'pointer' : 'not-allowed';
        btn.el.style.pointerEvents = enabled ? 'auto' : 'none';
    });
}

export function disableControls(disable, controls, surveyResultsBtn) {
    (controls || []).forEach(btn => {
        if (!btn?.el) return;
        btn.el.disabled = disable;
        btn.el.style.opacity = disable ? '0.5' : '1';
        btn.el.style.cursor = disable ? 'not-allowed' : 'pointer';
        btn.el.style.pointerEvents = disable ? 'none' : 'auto';
    });
    if (surveyResultsBtn?.el) {
        surveyResultsBtn.el.disabled = false;
        surveyResultsBtn.el.style.opacity = '1';
        surveyResultsBtn.el.style.cursor = 'pointer';
        surveyResultsBtn.el.style.pointerEvents = 'auto';
    }
}
