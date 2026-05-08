// Survey bridge — exposes window.beamerSurvey for embedded survey widgets.
import { bus } from '../core/events.js';

export function initSurveyBridge(state) {
    window.beamerSurvey = {
        getAvailableModels: () => [...(state.availableModels || [])],

        getState: () => ({
            survey: state.surveyData,
            responseCount: state.surveyResponseCount,
            results: state.surveyResults,
        }),

        subscribeResponseCount(cb) {
            if (typeof cb !== 'function') return () => {};
            state.surveyCountSubscribers.add(cb);
            cb(state.surveyResponseCount);
            return () => state.surveyCountSubscribers.delete(cb);
        },

        async createSurvey({ question, model, num_summaries }) {
            if (!state.zipFile) throw new Error('Please upload a presentation first.');
            if (!model) throw new Error('No model selected.');

            const resp = await fetch('/api/survey/create', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ question, model, num_summaries }),
            });
            const data = await resp.json();
            if (!resp.ok) throw new Error(data.error || 'Failed to create survey');

            state.surveyData = { ...data, question, model, num_summaries };
            state.surveyResults = null;
            state.surveyResponseCount = 0;
            state.surveyCountSubscribers.forEach(cb => { try { cb(0); } catch(e) {} });
            state.socket.emit('survey_show', data);

            return { ...data, full_url: `${window.location.origin}${data.url}` };
        },

        async generateSummaries() {
            if (!state.surveyData) throw new Error('No survey exists. Create one first.');

            try {
                await fetch(`/api/survey/${state.surveyData.survey_id}/close`, { method: 'POST' });
                state.socket.emit('survey_close', { survey_id: state.surveyData.survey_id });
            } catch (e) {}

            const resResp = await fetch(`/api/survey/${state.surveyData.survey_id}/responses`);
            const resData = await resResp.json();
            if (!resResp.ok) throw new Error(resData.error || 'Failed to load responses');
            if (!resData.responses?.length) throw new Error('No responses yet.');

            const analyzeResp = await fetch(`/api/survey/${state.surveyData.survey_id}/analyze`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
            });
            const analysis = await analyzeResp.json();
            if (!analyzeResp.ok) throw new Error(analysis.error || 'Analysis failed');

            state.surveyResults = {
                summaries: analysis.summaries,
                model: analysis.model,
                num_responses: analysis.num_responses,
            };
            return state.surveyResults;
        },

        async reset() {
            if (state.surveyData?.survey_id) {
                try { await fetch(`/api/survey/${state.surveyData.survey_id}/close`, { method: 'POST' }); } catch (e) {}
            }
            state.surveyData = null;
            state.surveyResults = null;
            state.surveyResponseCount = 0;
            state.surveyCountSubscribers.forEach(cb => { try { cb(0); } catch(e) {} });
        },

        getCurrentSlide: () => state.currentSlide,
    };

    // Word cloud helper
    window.beamerWordCloud = {
        goToNextPdfSlide: async () => {
            const curPdf = state.slideStructure[state.currentSlide]?.pdfIndex;
            if (curPdf == null) return;
            const next = state.slideStructure.findIndex(s => s.type === 'pdf' && s.pdfIndex === curPdf + 1);
            if (next !== -1) bus.emit('slide:goto', next);
        },
        goToPdfSlide: async (pdfIndex) => {
            const i = state.slideStructure.findIndex(s => s.type === 'pdf' && s.pdfIndex === pdfIndex);
            if (i !== -1) bus.emit('slide:goto', i);
        },
        getCurrentPdfIndex: () => state.slideStructure[state.currentSlide]?.pdfIndex ?? null,
    };
}
