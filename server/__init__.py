"""Beamer+ Flask server package.

Module map:
- core.py          Flask app + Socket.IO instances
- paths.py         BASE_PATH and derived folders (works frozen and from source)
- state.py         shared limits (MAX_RESPONSES_PER_SURVEY, …)
- sessions.py      per-presenter session registry + create API
- ai_models.py     survey-summarization model loading (built-ins + ZIP models)
- pages.py         HTML pages and PWA files
- presentation.py  upload, ZIP assets, demo packaging
- widgets.py       built-in widget serving, embeddability probe
- surveys.py       survey REST API
- sockets.py       Socket.IO handlers

Entry points import `app` and `socketio` from here (see ../app.py, ../launch.py).
"""
from .core import app, socketio

from . import sockets  # noqa: F401  (registers Socket.IO handlers on import)
from .ai_models import init_builtin_models
from .pages import pages_bp
from .presentation import presentation_bp
from .sessions import sessions_bp
from .surveys import surveys_bp
from .widgets import widgets_bp

app.register_blueprint(pages_bp)
app.register_blueprint(presentation_bp)
app.register_blueprint(widgets_bp)
app.register_blueprint(surveys_bp)
app.register_blueprint(sessions_bp)

init_builtin_models()
