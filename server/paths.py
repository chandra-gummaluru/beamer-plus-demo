"""Filesystem locations for the Beamer+ server.

Everything is resolved relative to BASE_PATH, which is the repository root
when running from source and the PyInstaller bundle root when frozen.
"""
import os
import sys


def get_base_path():
    if getattr(sys, 'frozen', False):
        return sys._MEIPASS
    # This file lives in server/, so the repo root is one level up.
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


BASE_PATH = get_base_path()

UPLOAD_FOLDER = os.path.join(BASE_PATH, 'uploads')
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

WIDGETS_DIR = os.path.join(BASE_PATH, 'widgets')
os.makedirs(WIDGETS_DIR, exist_ok=True)

AI_MODELS_DIR = os.path.join(BASE_PATH, 'ai')
