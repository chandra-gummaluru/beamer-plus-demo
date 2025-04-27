from flask import Flask, abort, render_template, send_from_directory, jsonify, request, redirect, url_for
from flask_socketio import SocketIO, emit
import socket
import os, zipfile
import logging

app = Flask(__name__, static_folder='static', template_folder='templates')
socketio = SocketIO(app, cors_allowed_origins='*')

lan_enabled = False

@app.route('/')
def index():
    # only allow true localhost to see the editor
    # request.remote_addr is '127.0.0.1' for IPv4 and '::1' for IPv6
    #if request.remote_addr not in ('127.0.0.1', '::1'):
    #    return redirect(url_for('viewer'))
    return render_template('main.html')

@app.route('/viewer')
def viewer():
    global lan_enabled
    if not lan_enabled:
        # viewer is disabled → return 404
        abort(404)
    return render_template('viewer.html')

@app.route('/enable_lan', methods=['POST'])
def enable_lan():
    global lan_enabled
    lan_enabled = True
    socketio.emit('lan_status', {'enabled': True}, broadcast=True)
    return ('', 204)

@app.route('/disable_lan', methods=['POST'])
def disable_lan():
    global lan_enabled
    lan_enabled = False
    socketio.emit('lan_status', {'enabled': False}, broadcast=True)
    return ('', 204)

@app.route('/local_ip')
def local_ip():
    # open a dummy UDP socket to discover the outbound interface IP
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        # doesn't actually send packets, just uses the OS routing table
        s.connect(('8.8.8.8', 80))
        ip = s.getsockname()[0]
    except Exception:
        ip = '127.0.0.1'
    finally:
        s.close()
    return jsonify({'ip': ip})

@app.route('/config')
def get_config():
    return send_from_directory('.', 'config.json')

@app.route('/pdf/<path:filename>')
def serve_pdf(filename):
    return send_from_directory('pdf', filename)

@app.route('/videos/<path:filename>')
def serve_video(filename):
    return send_from_directory('videos', filename)

# WebSocket events
@socketio.on('slide_update')
def on_slide_update(data):
    emit('slide_update', data, broadcast=True, include_self=False)

@socketio.on('stroke_update')
def on_stroke_update(data):
    emit('stroke_update', data, broadcast=True, include_self=False)

@socketio.on('stroke_stream')
def on_stroke_stream(data):
    # broadcast the in‐flight stroke to all other clients
    emit('stroke_stream', data, broadcast=True, include_self=False)

@socketio.on('clear_slide')
def handle_clear(data):
    # broadcast to everyone else
    emit('clear_slide', data, broadcast=True, include_self=False)

@socketio.on('update_html')
def handle_update(data):
    # Broadcast update to all clients except sender
    emit('update_html', data, broadcast=True, include_self=False)


@app.route('/upload', methods=['POST'])
def upload_zip():
    """
    POST a single ZIP containing:
      - config.json at the root
      - one or more .pdf under any path (we'll flatten to /pdfs)
      - any number of video files under any path (flatten to /videos)
    """
    zfile = request.files.get('zipfile')
    app.logger.info("hi")
    if not zfile:
        abort(400, "No zipfile provided")

    app.logger.info("hi2")
    with zipfile.ZipFile(zfile.stream) as archive:
        # first, read config.json
        try:
            with archive.open('config.json') as cfg_src, open('config.json','wb') as cfg_dst:
                cfg_dst.write(cfg_src.read())
        except KeyError:
            abort(400, "ZIP must contain config.json at its root")

        # then extract PDFs & videos
        for member in archive.namelist():
            name = os.path.basename(member)
            if not name:
                continue  # skip directories
            lower = name.lower()
            if lower.endswith('.pdf'):
                out = os.path.join('pdfs', name)
                with archive.open(member) as src, open(out, 'wb') as dst:
                    dst.write(src.read())
            elif lower.endswith(('.mp4','webm','ogg')):
                out = os.path.join('videos', name)
                with archive.open(member) as src, open(out, 'wb') as dst:
                    dst.write(src.read())
            # else: ignore other files (we already handled config.json)

    return ('', 204)

if __name__ == '__main__':
    socketio.run(app, host='0.0.0.0', port=5000, debug=True)