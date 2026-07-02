"""Built-in widget serving and the iframe-embeddability probe."""
import os
import urllib.request

from flask import Blueprint, jsonify, request, send_from_directory

from .paths import WIDGETS_DIR

widgets_bp = Blueprint('widgets', __name__)


@widgets_bp.route('/api/widgets')
def list_widgets():
    """Return sorted list of .html filenames from the widgets/ folder."""
    if not os.path.isdir(WIDGETS_DIR):
        return jsonify([])
    names = sorted(f for f in os.listdir(WIDGETS_DIR) if f.lower().endswith('.html'))
    return jsonify(names)


@widgets_bp.route('/widgets/<path:filename>')
def serve_widget(filename):
    """Serve a widget HTML file from the widgets/ folder."""
    return send_from_directory(WIDGETS_DIR, filename)


@widgets_bp.route('/api/check-embeddable')
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
    except Exception:
        # If the request fails we cannot be sure — let the iframe try. Don't
        # echo the exception text: this endpoint can be pointed at internal
        # addresses, and error details would leak what's listening there.
        return jsonify({'embeddable': True, 'note': 'unreachable'})
