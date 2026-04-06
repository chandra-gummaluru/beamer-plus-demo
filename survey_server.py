"""
Beamer+ Survey Standalone Server

A standalone server that handles survey creation, response collection,
and AI-powered summarization. Can be run independently or embedded as a widget.

Usage:
    python survey_server.py [--port 5001] [--zip path/to/presentation.zip]
"""

from flask import Flask, render_template_string, jsonify, request, send_from_directory
from flask_socketio import SocketIO, emit, join_room
from flask_cors import CORS
import uuid
import time
import os
import sys
import argparse
import importlib.util
import tempfile
import zipfile
from collections import defaultdict
from typing import List, Tuple

app = Flask(__name__)
CORS(app)
socketio = SocketIO(app, cors_allowed_origins='*', async_mode='threading')

# Store surveys and responses
surveys = {}
survey_responses = defaultdict(list)

# Store loaded models
loaded_models = {}
available_models = []

def extract_and_load_models(zip_path):
    """
    Extract AI models from a ZIP file and load them.
    Models should be in the 'ai/' directory within the ZIP.
    """
    global loaded_models, available_models
    loaded_models = {}
    available_models = []
    
    if not zip_path or not os.path.exists(zip_path):
        print(f"ZIP file not found: {zip_path}")
        return
    
    try:
        with zipfile.ZipFile(zip_path, 'r') as zip_ref:
            ai_files = [f for f in zip_ref.namelist() if f.startswith('ai/') and f.endswith('.py')]
            
            if not ai_files:
                print("No AI models found in ZIP file")
                return
            
            temp_dir = tempfile.mkdtemp()
            
            for ai_file in ai_files:
                try:
                    zip_ref.extract(ai_file, temp_dir)
                    model_name = os.path.splitext(os.path.basename(ai_file))[0]
                    
                    if model_name.startswith('_'):
                        continue
                    
                    model_path = os.path.join(temp_dir, ai_file)
                    spec = importlib.util.spec_from_file_location(model_name, model_path)
                    module = importlib.util.module_from_spec(spec)
                    
                    unique_name = f"survey_model_{model_name}_{int(time.time())}"
                    sys.modules[unique_name] = module
                    spec.loader.exec_module(module)
                    
                    if hasattr(module, 'summarize'):
                        loaded_models[model_name] = getattr(module, 'summarize')
                        available_models.append(model_name)
                        print(f"Loaded model: {model_name}")
                    else:
                        print(f"Warning: {ai_file} does not define a 'summarize' function")
                
                except Exception as e:
                    print(f"Error loading model {ai_file}: {str(e)}")
    
    except Exception as e:
        print(f"Error extracting models from ZIP: {str(e)}")

# HTML template for the survey response page
SURVEY_RESPONSE_HTML = """
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Survey Response</title>
    <link href="https://fonts.googleapis.com/css2?family=Computer+Modern+Sans:wght@300;400;500&display=swap" rel="stylesheet">
    <style>
        * { box-sizing: border-box; }
        body {
            font-family: 'Computer Modern Sans', -apple-system, BlinkMacSystemFont, sans-serif;
            margin: 0;
            padding: 20px;
            min-height: 100vh;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            background: #f5f5f5;
        }
        .container {
            max-width: 600px;
            width: 100%;
            background: white;
            padding: 2rem;
            border-radius: 8px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        h1 {
            font-weight: 300;
            color: #333;
            margin-bottom: 1.5rem;
            text-align: center;
        }
        textarea {
            width: 100%;
            min-height: 150px;
            padding: 1rem;
            border: 2px solid #ddd;
            border-radius: 4px;
            font-size: 1rem;
            font-family: inherit;
            resize: vertical;
            margin-bottom: 1rem;
        }
        textarea:focus {
            outline: none;
            border-color: #333;
        }
        button {
            width: 100%;
            padding: 1rem;
            background: #333;
            color: white;
            border: none;
            border-radius: 4px;
            font-size: 1rem;
            font-family: inherit;
            cursor: pointer;
            transition: background 0.2s;
        }
        button:hover { background: #555; }
        button:disabled {
            background: #ccc;
            cursor: not-allowed;
        }
        .success {
            text-align: center;
            color: #2e7d32;
            font-size: 1.2rem;
        }
        .closed {
            text-align: center;
            color: #c62828;
            font-size: 1.2rem;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1 id="question">{{ question }}</h1>
        <div id="form-container">
            <textarea id="response" placeholder="Type your response here..."></textarea>
            <button id="submit-btn" onclick="submitResponse()">Submit Response</button>
        </div>
        <div id="success-message" class="success" style="display: none;">
            Thank you for your response!
        </div>
        <div id="closed-message" class="closed" style="display: none;">
            This survey has been closed.
        </div>
    </div>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/socket.io/4.5.4/socket.io.min.js"></script>
    <script>
        const surveyId = '{{ survey_id }}';
        const socket = io();
        
        socket.on('connect', () => {
            socket.emit('join_survey', { survey_id: surveyId });
        });
        
        socket.on('survey_closed', (data) => {
            if (data.survey_id === surveyId) {
                document.getElementById('form-container').style.display = 'none';
                document.getElementById('closed-message').style.display = 'block';
            }
        });
        
        async function submitResponse() {
            const response = document.getElementById('response').value.trim();
            if (!response) {
                alert('Please enter a response');
                return;
            }
            
            document.getElementById('submit-btn').disabled = true;
            
            try {
                const res = await fetch('/api/survey/' + surveyId + '/respond', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ response: response })
                });
                
                if (res.ok) {
                    document.getElementById('form-container').style.display = 'none';
                    document.getElementById('success-message').style.display = 'block';
                } else {
                    const data = await res.json();
                    alert(data.error || 'Failed to submit response');
                    document.getElementById('submit-btn').disabled = false;
                }
            } catch (error) {
                alert('Failed to submit response');
                document.getElementById('submit-btn').disabled = false;
            }
        }
    </script>
</body>
</html>
"""

# HTML template for the widget UI (embedded in presenter's screen)
WIDGET_HTML = """
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Survey Widget</title>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <script src="https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/socket.io/4.5.4/socket.io.min.js"></script>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: 'Computer Modern Sans', -apple-system, BlinkMacSystemFont, sans-serif;
            background: white;
            height: 100vh;
            overflow: hidden;
        }
        .container {
            height: 100%;
            display: flex;
            flex-direction: column;
            padding: 1rem;
        }
        .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 1rem;
            padding-bottom: 0.5rem;
            border-bottom: 1px solid #eee;
        }
        .header h2 {
            font-weight: 300;
            font-size: 1.2rem;
            color: #333;
        }
        .btn {
            background: #333;
            color: white;
            border: none;
            padding: 0.5rem 1rem;
            border-radius: 4px;
            cursor: pointer;
            font-size: 0.9rem;
            display: flex;
            align-items: center;
            gap: 0.5rem;
        }
        .btn:hover { background: #555; }
        .btn:disabled { background: #ccc; cursor: not-allowed; }
        .btn-secondary {
            background: white;
            color: #333;
            border: 1px solid #333;
        }
        .btn-secondary:hover { background: #f5f5f5; }
        .content {
            flex: 1;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            overflow: auto;
        }
        .view { display: none; width: 100%; height: 100%; }
        .view.active { display: flex; flex-direction: column; align-items: center; justify-content: center; }
        
        /* Create view */
        .create-form {
            max-width: 400px;
            width: 100%;
        }
        .form-group {
            margin-bottom: 1rem;
        }
        .form-group label {
            display: block;
            margin-bottom: 0.5rem;
            font-weight: 500;
            color: #555;
        }
        .form-group input, .form-group select {
            width: 100%;
            padding: 0.75rem;
            border: 1px solid #ddd;
            border-radius: 4px;
            font-size: 1rem;
        }
        .form-group small {
            display: block;
            margin-top: 0.25rem;
            color: #888;
            font-size: 0.8rem;
        }
        
        /* Survey view */
        .survey-info {
            text-align: center;
        }
        .survey-info h3 {
            font-weight: 300;
            font-size: 1.5rem;
            margin-bottom: 1rem;
            color: #333;
        }
        #qrcode {
            background: white;
            padding: 1rem;
            border-radius: 4px;
            margin-bottom: 1rem;
        }
        .survey-url {
            width: 100%;
            max-width: 350px;
            padding: 0.5rem;
            border: 1px solid #ddd;
            border-radius: 4px;
            text-align: center;
            font-size: 0.85rem;
            margin-bottom: 1rem;
        }
        .response-count {
            font-size: 1.2rem;
            padding: 0.5rem 1rem;
            background: #f5f5f5;
            border-radius: 4px;
            margin-bottom: 1rem;
        }
        
        /* Results view */
        .results-nav {
            display: flex;
            align-items: center;
            gap: 1rem;
            margin-bottom: 1rem;
        }
        .result-card {
            background: #f8f9fa;
            border: 2px solid #666;
            border-radius: 4px;
            padding: 1.5rem;
            max-width: 600px;
            width: 100%;
            text-align: center;
        }
        .result-summary {
            font-size: 1.1rem;
            line-height: 1.6;
            color: #333;
        }
        .result-respondents {
            margin-top: 1rem;
            font-size: 0.9rem;
            color: #666;
        }
        
        /* No models message */
        .no-models {
            text-align: center;
            color: #666;
        }
        .no-models i {
            font-size: 3rem;
            margin-bottom: 1rem;
            color: #ccc;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h2><i class="fa-solid fa-clipboard-list"></i> Survey Widget</h2>
            <div id="header-buttons">
                <button class="btn btn-secondary" onclick="showView('create')" id="new-survey-btn">
                    <i class="fa-solid fa-plus"></i> New
                </button>
            </div>
        </div>
        
        <div class="content">
            <!-- Create Survey View -->
            <div id="create-view" class="view active">
                <div class="create-form" id="create-form">
                    <div class="form-group">
                        <label>Question</label>
                        <input type="text" id="survey-question" placeholder="What do you think about...?">
                        <small>Leave blank for generic survey</small>
                    </div>
                    <div class="form-group">
                        <label>Summarizer Model</label>
                        <select id="survey-model"></select>
                    </div>
                    <div class="form-group">
                        <label>Number of Summaries</label>
                        <input type="number" id="survey-num-summaries" min="1" max="10" value="3">
                        <small>Generate 1-10 different summary variations</small>
                    </div>
                    <button class="btn" onclick="createSurvey()" style="width: 100%; margin-top: 1rem;">
                        <i class="fa-solid fa-paper-plane"></i> Create Survey
                    </button>
                </div>
                <div class="no-models" id="no-models" style="display: none;">
                    <i class="fa-solid fa-robot"></i>
                    <p>No AI models available.</p>
                    <p><small>Upload a presentation ZIP with models in the ai/ folder.</small></p>
                </div>
            </div>
            
            <!-- Active Survey View -->
            <div id="survey-view" class="view">
                <div class="survey-info">
                    <h3 id="active-question">Survey</h3>
                    <div id="qrcode"></div>
                    <input type="text" class="survey-url" id="survey-url" readonly onclick="this.select()">
                    <div class="response-count">
                        Responses: <strong id="response-count">0</strong>
                    </div>
                    <div style="display: flex; gap: 1rem;">
                        <button class="btn btn-secondary" onclick="closeSurvey()">
                            <i class="fa-solid fa-stop"></i> Close
                        </button>
                        <button class="btn" onclick="analyzeResponses()">
                            <i class="fa-solid fa-chart-simple"></i> Analyze
                        </button>
                    </div>
                </div>
            </div>
            
            <!-- Results View -->
            <div id="results-view" class="view">
                <h3 id="results-question" style="font-weight: 300; margin-bottom: 1rem;">Results</h3>
                <div class="results-nav">
                    <button class="btn btn-secondary" onclick="prevResult()" id="prev-btn">
                        <i class="fa-solid fa-arrow-left"></i>
                    </button>
                    <span id="result-counter">1 / 3</span>
                    <button class="btn btn-secondary" onclick="nextResult()" id="next-btn">
                        <i class="fa-solid fa-arrow-right"></i>
                    </button>
                </div>
                <div class="result-card">
                    <div class="result-summary" id="result-summary"></div>
                    <div class="result-respondents" id="result-respondents"></div>
                </div>
            </div>
            
            <!-- Loading View -->
            <div id="loading-view" class="view">
                <i class="fa-solid fa-spinner fa-spin" style="font-size: 2rem; color: #333;"></i>
                <p style="margin-top: 1rem; color: #666;">Analyzing responses...</p>
            </div>
        </div>
    </div>
    
    <script>
        let currentSurvey = null;
        let currentResults = null;
        let currentResultIndex = 0;
        let socket = null;
        
        // Initialize
        document.addEventListener('DOMContentLoaded', async () => {
            // Connect to socket
            socket = io();
            socket.on('survey_response', (data) => {
                if (currentSurvey && data.survey_id === currentSurvey.survey_id) {
                    document.getElementById('response-count').textContent = data.total;
                }
            });
            
            // Load models
            await loadModels();
        });
        
        async function loadModels() {
            try {
                const res = await fetch('/api/models');
                const data = await res.json();
                
                const select = document.getElementById('survey-model');
                select.innerHTML = '';
                
                if (data.models.length === 0) {
                    document.getElementById('create-form').style.display = 'none';
                    document.getElementById('no-models').style.display = 'block';
                    return;
                }
                
                data.models.forEach(model => {
                    const option = document.createElement('option');
                    option.value = model;
                    option.textContent = model.replace(/_/g, ' ').replace(/\\b\\w/g, l => l.toUpperCase());
                    select.appendChild(option);
                });
            } catch (error) {
                console.error('Error loading models:', error);
            }
        }
        
        function showView(viewName) {
            document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
            document.getElementById(viewName + '-view').classList.add('active');
        }
        
        async function createSurvey() {
            const question = document.getElementById('survey-question').value.trim() || 'Survey';
            const model = document.getElementById('survey-model').value;
            const numSummaries = parseInt(document.getElementById('survey-num-summaries').value);
            
            if (!model) {
                alert('Please select a model');
                return;
            }
            
            try {
                const res = await fetch('/api/survey/create', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ question, model, num_summaries: numSummaries })
                });
                
                const data = await res.json();
                
                if (!res.ok) {
                    alert(data.error || 'Failed to create survey');
                    return;
                }
                
                currentSurvey = { ...data, question, model, num_summaries: numSummaries };
                currentResults = null;
                
                // Show survey view
                document.getElementById('active-question').textContent = question;
                document.getElementById('response-count').textContent = '0';
                
                const surveyUrl = window.location.origin + data.url;
                document.getElementById('survey-url').value = surveyUrl;
                
                // Generate QR code
                const qrContainer = document.getElementById('qrcode');
                qrContainer.innerHTML = '';
                new QRCode(qrContainer, {
                    text: surveyUrl,
                    width: 150,
                    height: 150,
                    colorDark: "#333333",
                    colorLight: "#ffffff"
                });
                
                showView('survey');
            } catch (error) {
                console.error('Error creating survey:', error);
                alert('Failed to create survey');
            }
        }
        
        async function closeSurvey() {
            if (!currentSurvey) return;
            
            try {
                await fetch('/api/survey/' + currentSurvey.survey_id + '/close', { method: 'POST' });
                socket.emit('survey_close', { survey_id: currentSurvey.survey_id });
            } catch (error) {
                console.error('Error closing survey:', error);
            }
        }
        
        async function analyzeResponses() {
            if (!currentSurvey) return;
            
            showView('loading');
            
            try {
                // Close survey first
                await closeSurvey();
                
                // Check for responses
                const respRes = await fetch('/api/survey/' + currentSurvey.survey_id + '/responses');
                const respData = await respRes.json();
                
                if (respData.responses.length === 0) {
                    alert('No responses to analyze');
                    showView('survey');
                    return;
                }
                
                // Analyze
                const analyzeRes = await fetch('/api/survey/' + currentSurvey.survey_id + '/analyze', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' }
                });
                
                if (!analyzeRes.ok) {
                    const errData = await analyzeRes.json();
                    throw new Error(errData.error || 'Analysis failed');
                }
                
                const analysisData = await analyzeRes.json();
                
                currentResults = {
                    summaries: analysisData.summaries,
                    model: analysisData.model,
                    num_responses: analysisData.num_responses
                };
                currentResultIndex = 0;
                
                // Show results
                document.getElementById('results-question').textContent = currentSurvey.question;
                updateResultDisplay();
                showView('results');
                
            } catch (error) {
                console.error('Error analyzing:', error);
                alert('Failed to analyze responses: ' + error.message);
                showView('survey');
            }
        }
        
        function updateResultDisplay() {
            if (!currentResults || !currentResults.summaries.length) return;
            
            const summary = currentResults.summaries[currentResultIndex];
            const total = currentResults.summaries.length;
            
            document.getElementById('result-summary').textContent = summary.summary;
            document.getElementById('result-respondents').textContent = 
                `Based on ${summary.num_respondents} response${summary.num_respondents !== 1 ? 's' : ''}`;
            document.getElementById('result-counter').textContent = `${currentResultIndex + 1} / ${total}`;
            
            document.getElementById('prev-btn').disabled = currentResultIndex === 0;
            document.getElementById('next-btn').disabled = currentResultIndex === total - 1;
        }
        
        function prevResult() {
            if (currentResultIndex > 0) {
                currentResultIndex--;
                updateResultDisplay();
            }
        }
        
        function nextResult() {
            if (currentResults && currentResultIndex < currentResults.summaries.length - 1) {
                currentResultIndex++;
                updateResultDisplay();
            }
        }
    </script>
</body>
</html>
"""

@app.route('/')
def index():
    """Serve the widget UI"""
    return WIDGET_HTML

@app.route('/survey/<survey_id>')
def survey_page(survey_id):
    """Serve the survey response page"""
    if survey_id not in surveys:
        return "<h1>Survey not found</h1>", 404
    return render_template_string(SURVEY_RESPONSE_HTML, 
                                  survey_id=survey_id, 
                                  question=surveys[survey_id].get('question', 'Survey'))

@app.route('/wordcloud/<survey_id>')
def wordcloud_page(survey_id):
    """Serve the wordcloud response page (alias of survey)"""
    if survey_id not in surveys:
        return "<h1>Survey not found</h1>", 404
    return render_template_string(SURVEY_RESPONSE_HTML,
                                  survey_id=survey_id,
                                  question=surveys[survey_id].get('question', 'Word Cloud'))

@app.route('/api/models')
def get_models():
    """Get list of available AI models"""
    return jsonify({'models': available_models})

@app.route('/api/models/load', methods=['POST'])
def load_models():
    """Load models from a ZIP file"""
    data = request.json
    zip_path = data.get('zip_path')
    if zip_path:
        extract_and_load_models(zip_path)
    return jsonify({'models': available_models})

@app.route('/api/survey/create', methods=['POST'])
def create_survey():
    """Create a new survey"""
    data = request.json
    survey_id = str(uuid.uuid4())[:8]
    
    model_name = data.get('model')
    
    if model_name and model_name not in loaded_models:
        return jsonify({'error': f'Model "{model_name}" not found'}), 400
    
    surveys[survey_id] = {
        'question': data.get('question', 'Survey'),
        'created_at': time.time(),
        'active': True,
        'model': model_name,
        'num_summaries': data.get('num_summaries', 3)
    }
    is_wordcloud = data.get('is_wordcloud', False)

    return jsonify({
        'survey_id': survey_id,
        'url': f'/wordcloud/{survey_id}' if is_wordcloud else f'/survey/{survey_id}'
    })

@app.route('/api/survey/<survey_id>')
def get_survey(survey_id):
    """Get survey details"""
    if survey_id not in surveys:
        return jsonify({'error': 'Survey not found'}), 404
    return jsonify(surveys[survey_id])

@app.route('/api/survey/<survey_id>/respond', methods=['POST'])
def respond_survey(survey_id):
    """Submit a response to a survey"""
    if survey_id not in surveys:
        return jsonify({'error': 'Survey not found'}), 404
    
    if not surveys[survey_id]['active']:
        return jsonify({'error': 'Survey is closed'}), 403
    
    data = request.json
    response = {
        'text': data.get('response', ''),
        'timestamp': time.time()
    }
    survey_responses[survey_id].append(response)
    
    # Notify widget of new response
    socketio.emit('survey_response', {
        'survey_id': survey_id,
        'response': response,
        'total': len(survey_responses[survey_id])
    })
    
    return jsonify({'success': True})

@app.route('/api/survey/<survey_id>/responses')
def get_responses(survey_id):
    """Get all responses for a survey"""
    if survey_id not in surveys:
        return jsonify({'error': 'Survey not found'}), 404
    return jsonify({
        'responses': survey_responses[survey_id],
        'total': len(survey_responses[survey_id])
    })

@app.route('/api/survey/<survey_id>/analyze', methods=['POST'])
def analyze_survey(survey_id):
    """Analyze survey responses using the specified model"""
    if survey_id not in surveys:
        return jsonify({'error': 'Survey not found'}), 404
    
    survey = surveys[survey_id]
    responses = survey_responses[survey_id]
    
    if len(responses) == 0:
        return jsonify({'error': 'No responses to analyze'}), 400
    
    model_name = survey.get('model')
    num_summaries = survey.get('num_summaries', 3)
    
    if not model_name:
        return jsonify({'error': 'No model specified for this survey'}), 400
    
    model_func = loaded_models.get(model_name)
    
    if not model_func:
        return jsonify({'error': f'Model "{model_name}" not loaded'}), 404
    
    try:
        response_texts = [r['text'] for r in responses]
        summaries = model_func(response_texts, num_summaries)
        
        if not isinstance(summaries, list):
            return jsonify({'error': 'Model must return a list of summaries'}), 500
        
        if len(summaries) != num_summaries:
            return jsonify({
                'error': f'Model returned {len(summaries)} summaries, expected {num_summaries}'
            }), 500
        
        for i, item in enumerate(summaries):
            if not isinstance(item, tuple) or len(item) != 2:
                return jsonify({
                    'error': f'Summary {i} must be a tuple of (summary, num_respondents)'
                }), 500
            if not isinstance(item[0], str) or not isinstance(item[1], int):
                return jsonify({
                    'error': f'Summary {i} has invalid types: expected (str, int)'
                }), 500
        
        summaries_json = [
            {'summary': s[0], 'num_respondents': s[1]}
            for s in summaries
        ]
        
        return jsonify({
            'summaries': summaries_json,
            'model': model_name,
            'num_responses': len(responses)
        })
    
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'error': f'Error analyzing responses: {str(e)}'}), 500

@app.route('/api/survey/<survey_id>/close', methods=['POST'])
def close_survey(survey_id):
    """Close a survey"""
    if survey_id in surveys:
        surveys[survey_id]['active'] = False
        socketio.emit('survey_closed', {'survey_id': survey_id}, room=f'survey_{survey_id}')
    return jsonify({'success': True})

@socketio.on('join_survey')
def join_survey(data):
    """Join a survey room for real-time updates"""
    survey_id = data.get('survey_id')
    if survey_id:
        join_room(f'survey_{survey_id}')
        emit('joined', {'room': f'survey_{survey_id}'})

@socketio.on('survey_close')
def handle_survey_close(data):
    """Handle survey close event from widget"""
    survey_id = data.get('survey_id')
    if survey_id:
        socketio.emit('survey_closed', {'survey_id': survey_id}, room=f'survey_{survey_id}')

def main():
    parser = argparse.ArgumentParser(description='Beamer+ Survey Server')
    parser.add_argument('--port', type=int, default=5001, help='Port to run the server on')
    parser.add_argument('--zip', type=str, help='Path to presentation ZIP file with AI models')
    parser.add_argument('--host', type=str, default='0.0.0.0', help='Host to bind to')
    args = parser.parse_args()
    
    if args.zip:
        print(f"Loading models from: {args.zip}")
        extract_and_load_models(args.zip)
    
    print(f"\nSurvey server starting on http://{args.host}:{args.port}")
    print("Open this URL in a browser or embed as an iframe widget.\n")
    
    # use_reloader=False prevents the server from spawning a child process
    # allow_unsafe_werkzeug=True allows running without a proper TTY
    socketio.run(app, host=args.host, port=args.port, debug=False, 
                 use_reloader=False, allow_unsafe_werkzeug=True)

if __name__ == '__main__':
    main()
