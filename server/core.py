"""Flask app and Socket.IO instances.

Kept in their own module so blueprints and socket handlers can import them
without going through the package __init__ (which would be circular).
"""
import os

from flask import Flask
from flask_socketio import SocketIO

from .paths import BASE_PATH

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
