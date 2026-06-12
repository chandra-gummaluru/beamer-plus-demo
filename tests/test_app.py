"""API tests for the Beamer+ Flask server.

Run with: pytest
"""
import io
import zipfile

import pytest

import app as app_module


@pytest.fixture
def client():
    app_module.app.config['TESTING'] = True
    with app_module.app.test_client() as c:
        yield c


def make_presentation_zip(with_model=False):
    """Build an in-memory presentation ZIP."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w') as zf:
        zf.writestr('slides.pdf', b'%PDF-1.4 fake test pdf')
        zf.writestr('assets/note.txt', b'hello from the zip')
        if with_model:
            zf.writestr('ai/testmodel.py', (
                'def summarize(responses, n, api_key=None):\n'
                '    return [(f"theme {i}", len(responses)) for i in range(n)]\n'
            ))
    buf.seek(0)
    return buf


def upload_zip(client, **kwargs):
    resp = client.post('/upload', data={
        'file': (make_presentation_zip(**kwargs), 'presentation.zip'),
    }, content_type='multipart/form-data')
    assert resp.status_code == 200
    return resp.get_json()


def create_survey(client, **payload):
    resp = client.post('/api/survey/create', json=payload)
    assert resp.status_code == 200
    return resp.get_json()


# ── Pages and static endpoints ─────────────────────────────────────────────────

def test_index(client):
    resp = client.get('/')
    assert resp.status_code == 200
    assert b'Beamer+' in resp.data


def test_manifest_and_service_worker(client):
    assert client.get('/manifest.json').status_code == 200
    resp = client.get('/service-worker.js')
    assert resp.status_code == 200
    assert resp.headers['Service-Worker-Allowed'] == '/'


def test_widget_listing_and_serving(client):
    names = client.get('/api/widgets').get_json()
    assert 'timer.html' in names
    assert client.get('/widgets/timer.html').status_code == 200


def test_vendored_libraries_served(client):
    for path in (
        '/static/vendor/socket.io.min.js',
        '/static/vendor/jszip.min.js',
        '/static/vendor/pdfjs/pdf.min.mjs',
        '/static/vendor/pdfjs/pdf.worker.min.mjs',
    ):
        assert client.get(path).status_code == 200, path


# ── Upload and ZIP assets ──────────────────────────────────────────────────────

def test_upload_and_current_presentation(client):
    data = upload_zip(client)
    assert data['success'] is True
    resp = client.get('/api/presentation/current')
    assert resp.status_code == 200
    with zipfile.ZipFile(io.BytesIO(resp.data)) as zf:
        assert 'slides.pdf' in zf.namelist()


def test_upload_loads_zip_models_alongside_builtins(client):
    data = upload_zip(client, with_model=True)
    assert 'testmodel' in data['models']
    models = client.get('/api/models').get_json()['models']
    assert 'testmodel' in models
    # built-ins survive a ZIP upload
    assert 'claude' in models and 'gpt4o' in models


def test_zip_asset_serving(client):
    upload_zip(client)
    resp = client.get('/api/zip-asset/assets/note.txt')
    assert resp.status_code == 200
    assert resp.data == b'hello from the zip'
    assert client.get('/api/zip-asset/assets/missing.txt').status_code == 404


def test_temp_asset_upload(client):
    resp = client.post('/api/upload-asset', data={
        'file': (io.BytesIO(b'temp bytes'), 'pic.png'),
        'folder': 'assets',
    }, content_type='multipart/form-data')
    assert resp.status_code == 200
    path = resp.get_json()['path']
    assert client.get(f'/api/zip-asset/{path}').data == b'temp bytes'


def test_demo_file_traversal_guard(client):
    assert client.get('/api/demo/slides.pdf').status_code == 200
    # traversal attempts must never serve files outside demo/
    resp = client.get('/api/demo/..%2fapp.py')
    assert resp.status_code in (403, 404)
    resp = client.get('/api/demo/..%5capp.py')
    assert resp.status_code in (403, 404)


# ── Surveys ────────────────────────────────────────────────────────────────────

def test_survey_lifecycle(client):
    survey = create_survey(client, question='What did you learn?')
    sid = survey['survey_id']
    assert survey['url'] == f'/survey/{sid}'

    assert client.get(f'/survey/{sid}').status_code == 200
    assert client.get('/survey/nonexistent').status_code == 404

    resp = client.post(f'/api/survey/{sid}/respond', json={'response': 'lots'})
    assert resp.get_json()['success'] is True

    data = client.get(f'/api/survey/{sid}/responses').get_json()
    assert data['total'] == 1
    assert data['responses'][0]['text'] == 'lots'
    # incremental polling
    assert client.get(f'/api/survey/{sid}/responses?after=1').get_json()['responses'] == []

    client.post(f'/api/survey/{sid}/close')
    resp = client.post(f'/api/survey/{sid}/respond', json={'response': 'late'})
    assert resp.status_code == 403


def test_survey_public_endpoint_does_not_leak_api_key(client):
    survey = create_survey(client, question='Q', model='claude', api_key='sk-secret')
    data = client.get(f"/api/survey/{survey['survey_id']}").get_json()
    assert 'api_key' not in data
    assert 'sk-secret' not in str(data)
    assert 'model' not in data


def test_mcq_and_wordcloud_urls(client):
    mcq = create_survey(client, question='Pick one', options=['a', 'b'])
    assert mcq['url'].startswith('/mcq/')
    wc = create_survey(client, question='One word', is_wordcloud=True)
    assert wc['url'].startswith('/wordcloud/')


def test_create_survey_with_unknown_model_rejected(client):
    resp = client.post('/api/survey/create', json={'question': 'Q', 'model': 'nope'})
    assert resp.status_code == 400


def test_response_cap(client, monkeypatch):
    monkeypatch.setattr(app_module, 'MAX_RESPONSES_PER_SURVEY', 2)
    sid = create_survey(client, question='Q')['survey_id']
    for _ in range(2):
        assert client.post(f'/api/survey/{sid}/respond', json={'response': 'x'}).status_code == 200
    resp = client.post(f'/api/survey/{sid}/respond', json={'response': 'overflow'})
    assert resp.status_code == 429


def test_analyze_with_zip_model(client):
    upload_zip(client, with_model=True)
    sid = create_survey(client, question='Q', model='testmodel', num_summaries=2)['survey_id']

    # no responses yet
    assert client.post(f'/api/survey/{sid}/analyze').status_code == 400

    for text in ('alpha', 'beta', 'gamma'):
        client.post(f'/api/survey/{sid}/respond', json={'response': text})

    resp = client.post(f'/api/survey/{sid}/analyze')
    assert resp.status_code == 200
    data = resp.get_json()
    assert data['num_responses'] == 3
    assert len(data['summaries']) == 2
    assert data['summaries'][0] == {'summary': 'theme 0', 'num_respondents': 3}


def test_analyze_rejects_malformed_model_output(client):
    upload_zip(client, with_model=True)
    # model returns n summaries but survey demands a different count
    app_module.current_presentation['models']['badmodel'] = lambda responses, n, **kw: [('only one', 1)]
    app_module.current_presentation['available_models'].append('badmodel')
    sid = create_survey(client, question='Q', model='badmodel', num_summaries=3)['survey_id']
    client.post(f'/api/survey/{sid}/respond', json={'response': 'x'})
    assert client.post(f'/api/survey/{sid}/analyze').status_code == 500


# ── Embeddability check ────────────────────────────────────────────────────────

def test_check_embeddable_rejects_bad_urls(client):
    assert client.get('/api/check-embeddable').status_code == 400
    assert client.get('/api/check-embeddable?url=ftp://x').status_code == 400
    assert client.get('/api/check-embeddable?url=javascript:alert(1)').status_code == 400
