from flask import Flask, render_template, jsonify, request, send_file, send_from_directory, Response
import io
import inspect
import mimetypes
from flask_socketio import SocketIO, emit, join_room
import uuid
import time
import os
import importlib.util
import sys
import tempfile
import traceback
import zipfile
from collections import defaultdict
import urllib.request

def get_base_path():
    if getattr(sys, 'frozen', False):
        return sys._MEIPASS
    return os.path.dirname(os.path.abspath(__file__))

BASE_PATH = get_base_path()

app = Flask(
    "Beamer+",
    static_folder=os.path.join(BASE_PATH, 'static'),
    template_folder=os.path.join(BASE_PATH, 'templates'),
)
# cors_allowed_origins='*' lets any page on the LAN open a socket. That's
# deliberate — widget iframes connect from assorted origins — but it means the
# widget_state relay trusts its senders. Beamer+ assumes a cooperative local
# network; do not expose this server to the public internet.
socketio = SocketIO(app, cors_allowed_origins='*', async_mode='threading')

surveys = {}
survey_responses = defaultdict(list)

UPLOAD_FOLDER = os.path.join(BASE_PATH, 'uploads')
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

WIDGETS_DIR = os.path.join(BASE_PATH, 'widgets')
os.makedirs(WIDGETS_DIR, exist_ok=True)

AI_MODELS_DIR = os.path.join(BASE_PATH, 'ai')

current_presentation = {
    'file': None,
    'models': {},
    'available_models': [],
}

# Temporary in-memory store for files uploaded via the editor but not yet
# saved into the ZIP.  Cleared each time a new presentation is loaded.
_temp_assets: dict[str, bytes] = {}

_builtin_models: dict = {}
_builtin_available: list = []

def _init_builtin_models():
    global _builtin_models, _builtin_available
    _builtin_models, _builtin_available = load_builtin_models()
    current_presentation['models'] = dict(_builtin_models)
    current_presentation['available_models'] = list(_builtin_available)

def load_builtin_models():
    models = {}
    available_models = []
    if not os.path.isdir(AI_MODELS_DIR):
        return models, available_models
    for filename in sorted(os.listdir(AI_MODELS_DIR)):
        if not filename.endswith('.py') or filename.startswith('_'):
            continue
        model_name = filename[:-3]
        model_path = os.path.join(AI_MODELS_DIR, filename)
        try:
            spec = importlib.util.spec_from_file_location(model_name, model_path)
            module = importlib.util.module_from_spec(spec)
            sys.modules[f'builtin_ai_{model_name}'] = module
            spec.loader.exec_module(module)
            if hasattr(module, 'summarize'):
                models[model_name] = getattr(module, 'summarize')
                available_models.append(model_name)
        except Exception as e:
            print(f'Error loading built-in model {filename}: {e}')
    return models, available_models


def extract_and_load_models(zip_path):
    # SECURITY: this executes the `ai/*.py` files found inside an uploaded ZIP
    # (spec.loader.exec_module). Loading a presentation therefore runs arbitrary
    # Python from whoever produced it — only open ZIPs you trust. This mirrors
    # the cooperative-LAN assumption documented at the socketio setup above.
    models = {}
    available_models = []
    try:
        with zipfile.ZipFile(zip_path, 'r') as zip_ref:
            ai_files = [f for f in zip_ref.namelist() if f.startswith('ai/') and f.endswith('.py')]
            if not ai_files:
                return models, available_models
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
                    unique_name = f"ai_model_{model_name}_{int(time.time())}"
                    sys.modules[unique_name] = module
                    spec.loader.exec_module(module)
                    if hasattr(module, 'summarize'):
                        models[model_name] = getattr(module, 'summarize')
                        available_models.append(model_name)
                except Exception as e:
                    print(f"Error loading model {ai_file}: {e}")
    except Exception as e:
        print(f"Error extracting models: {e}")
    return models, available_models


# ── Pages ──────────────────────────────────────────────────────────────────────

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/survey/<survey_id>')
def survey_page(survey_id):
    if survey_id not in surveys:
        return render_template('survey_not_found.html'), 404
    return render_template('survey_response.html', survey_id=survey_id)

@app.route('/wordcloud/<survey_id>')
def wordcloud_page(survey_id):
    if survey_id not in surveys:
        return render_template('survey_not_found.html'), 404
    return render_template('survey_response.html', survey_id=survey_id)

@app.route('/mcq/<survey_id>')
def mcq_page(survey_id):
    if survey_id not in surveys:
        return render_template('survey_not_found.html'), 404
    return render_template('mcq_response.html', survey_id=survey_id)


# ── PWA ────────────────────────────────────────────────────────────────────────

@app.route('/manifest.json')
def manifest():
    resp = send_file(os.path.join(BASE_PATH, 'manifest.json'), mimetype='application/manifest+json')
    resp.headers['Cache-Control'] = 'no-cache'
    return resp

@app.route('/service-worker.js')
def service_worker():
    resp = send_file(os.path.join(BASE_PATH, 'service-worker.js'), mimetype='application/javascript')
    resp.headers['Cache-Control'] = 'no-cache'
    resp.headers['Service-Worker-Allowed'] = '/'
    return resp

# ── Built-in widgets ───────────────────────────────────────────────────────────

@app.route('/api/widgets')
def list_widgets():
    """Return sorted list of .html filenames from the widgets/ folder."""
    if not os.path.isdir(WIDGETS_DIR):
        return jsonify([])
    names = sorted(f for f in os.listdir(WIDGETS_DIR) if f.lower().endswith('.html'))
    return jsonify(names)

@app.route('/widgets/<path:filename>')
def serve_widget(filename):
    """Serve a widget HTML file from the widgets/ folder."""
    return send_from_directory(WIDGETS_DIR, filename)


# ── Embeddability check ────────────────────────────────────────────────────────

@app.route('/api/check-embeddable')
def check_embeddable():
    """HEAD-request a URL and report whether X-Frame-Options / CSP would block it."""
    url = request.args.get('url', '').strip()
    if not url or not url.startswith(('http://', 'https://')):
        return jsonify({'embeddable': False, 'reason': 'invalid_url'}), 400

    try:
        req = urllib.request.Request(
            url,
            method='HEAD',
            headers={
                'User-Agent': 'Mozilla/5.0 (compatible; BeamerPlusEmbedChecker/1.0)',
            },
        )
        with urllib.request.urlopen(req, timeout=6) as resp:
            xfo = resp.headers.get('X-Frame-Options', '')
            csp = resp.headers.get('Content-Security-Policy', '')

        blocked_by_xfo = xfo.strip().upper() in ('DENY', 'SAMEORIGIN')
        blocked_by_csp = 'frame-ancestors' in csp.lower()

        if blocked_by_xfo or blocked_by_csp:
            reason = 'x-frame-options' if blocked_by_xfo else 'csp-frame-ancestors'
            return jsonify({'embeddable': False, 'reason': reason})
        return jsonify({'embeddable': True})
    except Exception as e:
        # If the request fails we cannot be sure — let the iframe try.
        return jsonify({'embeddable': True, 'note': str(e)})


# ── Upload ─────────────────────────────────────────────────────────────────────

def _save_and_load(file):
    global _temp_assets
    _temp_assets = {}          # wipe editor temp assets when a new ZIP is loaded
    filepath = os.path.join(UPLOAD_FOLDER, 'current.zip')
    file.save(filepath)
    zip_models, zip_available = extract_and_load_models(filepath)
    # Built-ins are always present; ZIP models supplement them (and can override by name).
    merged = dict(_builtin_models)
    merged.update(zip_models)
    merged_available = list(_builtin_available) + [m for m in zip_available if m not in _builtin_models]
    current_presentation['file'] = filepath
    current_presentation['models'] = merged
    current_presentation['available_models'] = merged_available
    return filepath, merged_available

# Both routes hit the same handler: `/upload` is the original name still used by
# the presenter UI; `/api/presentation/upload` is the REST-style alias that pairs
# with `/api/presentation/current`. The response carries both shapes' fields so
# either client keeps working.
@app.route('/upload', methods=['POST'])
@app.route('/api/presentation/upload', methods=['POST'])
def upload():
    if 'file' not in request.files:
        return jsonify({'error': 'No file'}), 400
    _, available_models = _save_and_load(request.files['file'])
    return jsonify({
        'success': True,
        'models': available_models,
        'models_found': len(available_models),
    })

@app.route('/api/presentation/current')
def get_current_presentation():
    if current_presentation['file'] and os.path.exists(current_presentation['file']):
        return send_file(current_presentation['file'], as_attachment=True, download_name='presentation.zip')
    return jsonify({'error': 'No presentation loaded'}), 404


# ── Demo ZIP ──────────────────────────────────────────────────────────────────
# Packages the entire demo/ folder as a ZIP so the tour can auto-load it.

@app.route('/api/demo-zip')
def serve_demo_zip():
    demo_dir = os.path.join(BASE_PATH, 'demo')
    if not os.path.isdir(demo_dir):
        return jsonify({'error': 'Demo not found'}), 404
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as zf:
        for root, dirs, files in os.walk(demo_dir):
            for fname in files:
                fpath = os.path.join(root, fname)
                arcname = os.path.relpath(fpath, demo_dir)
                zf.write(fpath, arcname)
    buf.seek(0)
    return send_file(buf, mimetype='application/zip', download_name='demo.zip')


# ── Static demo-folder file serving ───────────────────────────────────────────
# Serves files from the demo/ directory (e.g. PDFs for the textbook widget).
# URL: /api/demo/<relative-path-within-demo>

@app.route('/api/demo/<path:filename>')
def serve_demo_file(filename):
    demo_dir = os.path.realpath(os.path.join(BASE_PATH, 'demo'))
    requested = os.path.realpath(os.path.join(demo_dir, filename))
    # Guard against path traversal
    if not requested.startswith(demo_dir + os.sep):
        return jsonify({'error': 'Forbidden'}), 403
    if not os.path.isfile(requested):
        return jsonify({'error': 'Not found'}), 404
    resp = send_file(requested)
    resp.headers['Access-Control-Allow-Origin'] = '*'
    return resp


# ── ZIP asset serving ──────────────────────────────────────────────────────────

@app.route('/api/zip-asset/<path:filepath>')
def serve_zip_asset(filepath):
    """Serve a file from temp uploads or the current presentation ZIP."""
    if filepath in _temp_assets:
        mime = mimetypes.guess_type(filepath)[0] or 'application/octet-stream'
        resp = Response(_temp_assets[filepath], mimetype=mime)
        resp.headers['Access-Control-Allow-Origin'] = '*'
        return resp
    if not current_presentation.get('file') or not os.path.exists(current_presentation['file']):
        return jsonify({'error': 'No presentation loaded'}), 404
    try:
        with zipfile.ZipFile(current_presentation['file'], 'r') as z:
            if filepath not in z.namelist():
                return jsonify({'error': f'File not found: {filepath}'}), 404
            data = z.read(filepath)
            mime = mimetypes.guess_type(filepath)[0] or 'application/octet-stream'
            resp = Response(data, mimetype=mime)
            resp.headers['Access-Control-Allow-Origin'] = '*'
            return resp
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/upload-asset', methods=['POST'])
def upload_asset():
    """Temporarily store a file so widgets can render it before the ZIP is saved."""
    if 'file' not in request.files:
        return jsonify({'error': 'No file'}), 400
    f = request.files['file']
    folder = request.form.get('folder', 'assets')
    path = f'{folder}/{f.filename}'
    _temp_assets[path] = f.read()
    return jsonify({'path': path, 'url': f'/api/zip-asset/{path}'})


# ── Models ─────────────────────────────────────────────────────────────────────

@app.route('/api/models')
def get_models():
    return jsonify({'models': current_presentation.get('available_models', [])})


# ── Surveys ────────────────────────────────────────────────────────────────────

@app.route('/api/survey/create', methods=['POST'])
def create_survey():
    data = request.json
    survey_id = str(uuid.uuid4())[:8]
    model_name = data.get('model')
    if model_name and model_name not in current_presentation.get('models', {}):
        return jsonify({'error': f'Model "{model_name}" not found'}), 400
    surveys[survey_id] = {
        'question': data.get('question', 'What do you think?'),
        'created_at': time.time(),
        'active': True,
        'model': model_name,
        'api_key': data.get('api_key') or None,
        'num_summaries': data.get('num_summaries', 3),
        'options': data.get('options'),  # list of strings for MCQ
    }
    is_wordcloud = data.get('is_wordcloud', False)
    is_mcq = bool(data.get('options'))
    url = f'/mcq/{survey_id}' if is_mcq else (f'/wordcloud/{survey_id}' if is_wordcloud else f'/survey/{survey_id}')
    return jsonify({
        'survey_id': survey_id,
        'url': url,
    })

@app.route('/api/survey/<survey_id>')
def get_survey(survey_id):
    if survey_id not in surveys:
        return jsonify({'error': 'Survey not found'}), 404
    # This endpoint is public — every audience member hits it to load the
    # question. Only expose fields the respondent page actually needs; in
    # particular never leak the presenter's `api_key` (or the internal model).
    s = surveys[survey_id]
    return jsonify({
        'survey_id': survey_id,
        'question': s.get('question'),
        'options': s.get('options'),
        'active': s.get('active', False),
    })

@app.route('/api/survey/<survey_id>/respond', methods=['POST'])
def respond_survey(survey_id):
    if survey_id not in surveys:
        return jsonify({'error': 'Survey not found'}), 404
    if not surveys[survey_id]['active']:
        return jsonify({'error': 'Survey is closed'}), 403
    data = request.json
    response = {'text': data.get('response', ''), 'timestamp': time.time()}
    survey_responses[survey_id].append(response)
    payload = {'survey_id': survey_id, 'response': response, 'total': len(survey_responses[survey_id])}
    socketio.emit('survey_response', payload, room='presenter')
    socketio.emit('survey_response', payload, room=f'survey_{survey_id}')
    return jsonify({'success': True})

@app.route('/api/survey/<survey_id>/responses')
def get_responses(survey_id):
    if survey_id not in surveys:
        return jsonify({'error': 'Survey not found'}), 404
    try:
        after = int(request.args.get('after', 0))
    except ValueError:
        after = 0
    all_responses = survey_responses[survey_id]
    return jsonify({'responses': all_responses[after:], 'total': len(all_responses)})

@app.route('/api/survey/<survey_id>/analyze', methods=['POST'])
def analyze_survey(survey_id):
    if survey_id not in surveys:
        return jsonify({'error': 'Survey not found'}), 404
    survey = surveys[survey_id]
    responses = survey_responses[survey_id]
    if not responses:
        return jsonify({'error': 'No responses to analyze'}), 400
    model_name = survey.get('model')
    if not model_name:
        return jsonify({'error': 'No model specified'}), 400
    model_func = current_presentation.get('models', {}).get(model_name)
    if not model_func:
        return jsonify({'error': f'Model "{model_name}" not loaded'}), 404
    try:
        num_summaries = survey.get('num_summaries', 3)
        api_key = survey.get('api_key')
        call_kwargs = {'api_key': api_key} if api_key and 'api_key' in inspect.signature(model_func).parameters else {}
        summaries = model_func([r['text'] for r in responses], num_summaries, **call_kwargs)
        if not isinstance(summaries, list) or len(summaries) != num_summaries:
            return jsonify({'error': f'Model must return a list of {num_summaries} summaries'}), 500
        for i, item in enumerate(summaries):
            if not isinstance(item, tuple) or len(item) != 2 or not isinstance(item[0], str) or not isinstance(item[1], int):
                return jsonify({'error': f'Summary {i} must be a (str, int) tuple'}), 500
        return jsonify({
            'summaries': [{'summary': s[0], 'num_respondents': s[1]} for s in summaries],
            'model': model_name,
            'num_responses': len(responses),
        })
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@app.route('/api/survey/<survey_id>/close', methods=['POST'])
def close_survey(survey_id):
    if survey_id in surveys:
        surveys[survey_id]['active'] = False
        socketio.emit('survey_closed', {'survey_id': survey_id}, room=f'survey_{survey_id}')
    return jsonify({'success': True})


# ── Socket.IO ──────────────────────────────────────────────────────────────────
# Two real-time flows remain: survey response counts (server → presenter, see
# respond_survey) and widget-to-widget state sync. The presenter UI is otherwise
# self-contained, so there are no slide/annotation broadcasts here.

@socketio.on('join_presenter')
def join_presenter():
    join_room('presenter')
    emit('joined', {'room': 'presenter'})

@socketio.on('join_survey')
def join_survey(data):
    survey_id = data.get('survey_id')
    if survey_id:
        join_room(f'survey_{survey_id}')
        emit('joined', {'room': f'survey_{survey_id}'})

@socketio.on('widget_state')
def handle_widget_state(data):
    # Generic relay for iframe widgets: a widget broadcasts its state and any
    # other live instance of the same widget applies it. Widgets open their own
    # Socket.IO connection and don't join a specific room, so we broadcast to
    # every socket except the sender to keep the relay widget-agnostic.
    widget_id = data.get('widgetId') if isinstance(data, dict) else None
    state = data.get('state') if isinstance(data, dict) else None
    if not widget_id or state is None:
        return
    emit('widget_state', {'widgetId': widget_id, 'state': state}, broadcast=True, include_self=False)


_init_builtin_models()

# Running `python app.py` directly is the lightweight dev entry point; the
# production launcher is launch.py, which generates a real self-signed cert.
# Here we fall back to Flask-SocketIO's built-in "adhoc" certificate so that
# HTTPS-only browser features (e.g. the camera widget) work on LAN addresses,
# dropping to plain HTTP only when forced or when `cryptography` is missing.
if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=5001)
    parser.add_argument('--http', action='store_true', help='Force plain HTTP (disables camera widget on LAN)')
    args = parser.parse_args()

    def _can_use_adhoc_ssl():
        try:
            from cryptography import x509  # noqa: F401  (required by adhoc SSL)
            return True
        except ImportError:
            return False

    # debug=False: this binds 0.0.0.0, so we must not expose the Werkzeug
    # interactive debugger to the LAN.
    if args.http or not _can_use_adhoc_ssl():
        if not args.http:
            print('[WARN] Could not start HTTPS (cryptography library not found). Falling back to HTTP.')
            print('[WARN] The camera widget requires HTTPS on LAN addresses.')
        socketio.run(app, host='0.0.0.0', port=args.port, debug=False)
    else:
        socketio.run(app, host='0.0.0.0', port=args.port, debug=False, ssl_context='adhoc')
