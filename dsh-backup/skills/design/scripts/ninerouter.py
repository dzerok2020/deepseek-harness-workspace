"""Local 9Router gateway client shared by the design skill's generators.

Two capabilities behind one credential file:

  chat()          text models   POST /v1/chat/completions    -> SVG icon markup
  render_image()  image models  POST /v1/images/generations  -> logo / CIP / banner

Config precedence: explicit argument > environment variable > ~/.dsh/9router-image.env

Note: the gateway serves its image model without listing it in /v1/models, so
never probe for availability there — check that a key resolved instead.
"""
import base64
import importlib.util
import json
import os
import urllib.error
import urllib.request
from pathlib import Path

ENV_FILE = Path.home() / ".dsh" / "9router-image.env"
DEFAULTS = {
    "base": "http://localhost:20129/v1",
    "key": "",
    "image_model": "cx/gpt-6-sol-image",
    "text_model": "cx/gpt-6-sol",
}

_cache = {}


def _env():
    """Read KEY=VALUE lines once; ignore blanks and # comments."""
    if "file" in _cache:
        return _cache["file"]
    out = {}
    if ENV_FILE.is_file():
        for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            out[k.strip()] = v.strip().strip('"').strip("'")
    _cache["file"] = out
    return out


def resolve(value, env_name, file_key, fallback):
    if value:
        return value
    if os.environ.get(env_name):
        return os.environ[env_name]
    return _env().get(file_key) or fallback


def base(override=None):
    return resolve(override, "NINEROUTER_IMAGE_BASE", "NINEROUTER_IMAGE_BASE",
                   DEFAULTS["base"]).rstrip("/")


def key(override=None):
    return resolve(override, "NINEROUTER_IMAGE_KEY", "NINEROUTER_IMAGE_KEY", DEFAULTS["key"])


def image_model(override=None):
    return resolve(override, "NINEROUTER_IMAGE_MODEL", "NINEROUTER_IMAGE_MODEL",
                   DEFAULTS["image_model"])


def text_model(override=None):
    return resolve(override, "NINEROUTER_TEXT_MODEL", "NINEROUTER_TEXT_MODEL",
                   DEFAULTS["text_model"])


def available():
    """True when a usable key is configured — the only reliable readiness check."""
    return bool(key())


# Alias kept short for call sites that read better as a question.
is_configured = available


def _post(path, payload, timeout, override_base=None, override_key=None):
    token = key(override_key)
    if not token:
        raise RuntimeError("missing API key: set NINEROUTER_IMAGE_KEY or ~/.dsh/9router-image.env")
    req = urllib.request.Request(
        base(override_base) + path,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": "Bearer " + token,
            "Accept": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        raise RuntimeError("HTTP %s: %s" % (e.code, e.read()[:800].decode("utf-8", "replace")))
    except urllib.error.URLError as e:
        raise RuntimeError("cannot reach %s: %s" % (base(override_base), e.reason))
    except json.JSONDecodeError as e:
        raise RuntimeError("response is not JSON: %s" % e)


def chat(prompt, system=None, model=None, max_tokens=16384, temperature=0.7,
         timeout=240.0, image=None):
    """Return the assistant's text. `image` adds a reference image (url or data URI)."""
    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    if image:
        messages.append({
            "role": "user",
            "content": [
                {"type": "text", "text": prompt},
                {"type": "image_url", "image_url": {"url": image}},
            ],
        })
    else:
        messages.append({"role": "user", "content": prompt})

    payload = {
        "model": text_model(model),
        "messages": messages,
        "max_tokens": max_tokens,
        "temperature": temperature,
    }
    data = _post("/chat/completions", payload, timeout)

    if "error" in data:
        raise RuntimeError(str(data["error"])[:600])
    try:
        content = data["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError):
        raise RuntimeError("unexpected chat response keys: %s" % (sorted(data)[:10],))

    if isinstance(content, list):  # some gateways return content parts
        content = "".join(p.get("text", "") for p in content if isinstance(p, dict))
    finish = (data["choices"][0].get("finish_reason") or "")
    if finish == "length":
        raise RuntimeError(
            "output hit max_tokens (%d) and was truncated; raise max_tokens" % max_tokens)
    return content or ""


def render_image(prompt, output_path, **kwargs):
    """Delegate to scripts/image/generate.py so there is exactly one image path."""
    renderer = Path(__file__).resolve().parent / "image" / "generate.py"
    spec = importlib.util.spec_from_file_location("ninerouter_image_renderer", renderer)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.render(prompt, output_path, **kwargs)


def data_uri(path):
    """Read a local image file into a data: URI for chat()/render_image(reference=...)."""
    p = Path(path)
    return "data:image/%s;base64,%s" % (
        p.suffix.lstrip(".").lower() or "png",
        base64.b64encode(p.read_bytes()).decode(),
    )