"""Loading of survey-summarization models.

Two sources:
- Built-ins: `ai/*.py` files shipped with the server (see paths.AI_MODELS_DIR).
- ZIP models: `ai/*.py` files inside an uploaded presentation ZIP; these
  supplement the built-ins and can override them by name.

A model file must expose `summarize(responses, n, api_key=None)` returning a
list of exactly n (summary_text, num_respondents) tuples.
"""
import importlib.util
import os
import shutil
import sys
import tempfile
import time
import zipfile

from .paths import AI_MODELS_DIR

_builtin_models: dict = {}
_builtin_available: list = []

# sys.modules entries registered for the currently loaded ZIP, removed when the
# next ZIP is loaded so repeated uploads don't accumulate dead modules.
_zip_module_names: list = []


def init_builtin_models():
    global _builtin_models, _builtin_available
    _builtin_models, _builtin_available = load_builtin_models()


def get_builtin_models():
    """Return (models dict, available name list) for new session initialization."""
    return _builtin_models, _builtin_available


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
    # the cooperative-LAN assumption documented at the socketio setup in core.py.
    global _zip_module_names
    models = {}
    available_models = []
    for stale in _zip_module_names:
        sys.modules.pop(stale, None)
    _zip_module_names = []
    temp_dir = None
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
                    _zip_module_names.append(unique_name)
                    spec.loader.exec_module(module)
                    if hasattr(module, 'summarize'):
                        models[model_name] = getattr(module, 'summarize')
                        available_models.append(model_name)
                except Exception as e:
                    print(f"Error loading model {ai_file}: {e}")
    except Exception as e:
        print(f"Error extracting models: {e}")
    finally:
        # The module code is fully loaded into memory by exec_module, so the
        # extracted source files are no longer needed.
        if temp_dir:
            shutil.rmtree(temp_dir, ignore_errors=True)
    return models, available_models


def merge_zip_models(zip_path):
    """Load models from a ZIP and merge them over the built-ins.

    Returns (merged_models, merged_available_names).
    """
    zip_models, zip_available = extract_and_load_models(zip_path)
    merged = dict(_builtin_models)
    merged.update(zip_models)
    merged_available = list(_builtin_available) + [m for m in zip_available if m not in _builtin_models]
    return merged, merged_available
