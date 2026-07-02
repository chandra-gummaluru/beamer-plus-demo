"""Shared server constants.

Per-session mutable state lives in server.sessions.SessionState. This module
keeps response limits so tests can monkeypatch them via attribute access.
"""
from . import sessions as _sessions_mod

# Re-export limits for backward-compatible test monkeypatching (state.MAX_*).
MAX_RESPONSES_PER_SURVEY = _sessions_mod.MAX_RESPONSES_PER_SURVEY
MAX_RESPONSE_LENGTH = _sessions_mod.MAX_RESPONSE_LENGTH
