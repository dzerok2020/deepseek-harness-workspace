#!/usr/bin/env python3
"""Generate images through the local 9Router image API (OpenAI-compatible).

This is the single renderer for every image the `design` skill produces —
logo, icon, banner, poster, social photo, CIP mockup, image-to-image restyle.
Other scripts import `render()`; nothing here prints base64 to stdout.

Config precedence: CLI flag > environment variable > ~/.dsh/9router-image.env.

Usage:
  python3 generate.py "a red cube" -o out.png
  python3 generate.py "poster" -o poster.webp -r 3:4
  python3 generate.py "restyle" -o out.png --image https://example.com/in.png

Exit codes: 0 ok, 2 bad usage, 3 API/transport error, 4 no image in response.
"""
import argparse
import base64
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

ENV_FILE = Path.home() / ".dsh" / "9router-image.env"
DEFAULTS = {
    "base": "http://localhost:20129/v1",
    "key": "",
    "model": "cx/gpt-6-sol-image",
}

# The API accepts these preset sizes; unsupported ratios fall back to square.
ASPECT_SIZES = {
    "1:1": "1024x1024",
    "16:9": "1536x1024",
    "9:16": "1024x1536",
    "4:3": "1408x1056",
    "3:4": "1056x1408",
}


def load_env(path=ENV_FILE):
    """Read simple KEY=VALUE lines; ignore blanks and # comments."""
    out = {}
    if not path.is_file():
        return out
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        out[k.strip()] = v.strip().strip('"').strip("'")
    return out


def resolve(cli_value, env_name, file_key, fallback):
    if cli_value:
        return cli_value
    if os.environ.get(env_name):
        return os.environ[env_name]
    return load_env().get(file_key) or fallback


def extract_image(payload):
    """Return raw image bytes from the first recognizable field."""
    def b64(s):
        return base64.b64decode(s.split(",", 1)[-1])

    for bucket in ("data", "images", "output"):
        items = payload.get(bucket)
        if not isinstance(items, list):
            continue
        for item in items:
            if not isinstance(item, dict):
                continue
            for fld in ("b64_json", "b64", "image_base64", "base64"):
                if isinstance(item.get(fld), str) and item[fld].strip():
                    return b64(item[fld])
            for fld in ("url", "image_url"):
                if isinstance(item.get(fld), str) and item[fld].startswith("http"):
                    with urllib.request.urlopen(item[fld], timeout=120) as r:
                        return r.read()
    return None


def render(prompt, output_path, aspect_ratio="1:1", size=None, quality="auto",
           background="auto", image_detail="high", reference=None,
           model=None, base=None, key=None, timeout=180.0):
    """Generate one image and write it to output_path. Returns the Path.

    Raises RuntimeError on any failure so importers get one exception type.
    """
    base = (base or resolve(None, "NINEROUTER_IMAGE_BASE", "NINEROUTER_IMAGE_BASE",
                            DEFAULTS["base"])).rstrip("/")
    key = key or resolve(None, "NINEROUTER_IMAGE_KEY", "NINEROUTER_IMAGE_KEY", DEFAULTS["key"])
    model = model or resolve(None, "NINEROUTER_IMAGE_MODEL", "NINEROUTER_IMAGE_MODEL",
                             DEFAULTS["model"])
    if not key:
        raise RuntimeError(
            "missing API key: set NINEROUTER_IMAGE_KEY or ~/.dsh/9router-image.env")

    out = Path(output_path)
    fmt = out.suffix.lstrip(".").lower() or "png"
    if fmt == "jpg":
        fmt = "jpeg"

    body = {
        "model": model,
        "prompt": prompt,
        "n": 1,
        "size": size or ASPECT_SIZES.get(aspect_ratio, ASPECT_SIZES["1:1"]),
        "quality": quality,
        "background": background,
        "image_detail": image_detail,
        "output_format": fmt,
        "watermark": False,
        "prompt_extend": True,
    }
    if reference:
        if reference.startswith("http"):
            body["image"] = reference
        else:
            ref = Path(reference)
            body["image"] = "data:image/%s;base64,%s" % (
                ref.suffix.lstrip(".") or "png",
                base64.b64encode(ref.read_bytes()).decode(),
            )

    req = urllib.request.Request(
        base + "/images/generations",
        data=json.dumps(body).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": "Bearer " + key,
            "Accept": "application/json",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read()
    except urllib.error.HTTPError as e:
        raise RuntimeError("HTTP %s: %s" % (e.code, e.read()[:800].decode("utf-8", "replace")))
    except urllib.error.URLError as e:
        raise RuntimeError("cannot reach %s: %s" % (base, e.reason))

    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        raise RuntimeError("response is not JSON (first 200 bytes): %r" % raw[:200])

    data = extract_image(payload if isinstance(payload, dict) else {})
    if not data:
        keys = sorted(payload)[:12] if isinstance(payload, dict) else type(payload).__name__
        raise RuntimeError("no image in response; top-level keys: %s" % (keys,))

    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(data)
    return out


def main():
    p = argparse.ArgumentParser(description="Generate an image via 9Router local API")
    p.add_argument("prompt")
    p.add_argument("-o", "--output", required=True, help="output file path")
    p.add_argument("-r", "--aspect-ratio", default="1:1", choices=sorted(ASPECT_SIZES),
                   help="aspect ratio preset (default: 1:1)")
    p.add_argument("--size", default=None, help="explicit WxH, overrides --aspect-ratio")
    p.add_argument("--quality", default="auto")
    p.add_argument("--background", default="auto")
    p.add_argument("--image-detail", default="high")
    p.add_argument("--image", default=None,
                   help="reference image URL or local path (image-to-image)")
    p.add_argument("--model", default=None)
    p.add_argument("--base", default=None)
    p.add_argument("--timeout", type=float, default=180.0)
    a = p.parse_args()

    try:
        out = render(
            a.prompt, a.output,
            aspect_ratio=a.aspect_ratio, size=a.size, quality=a.quality,
            background=a.background, image_detail=a.image_detail,
            reference=a.image, model=a.model, base=a.base, timeout=a.timeout,
        )
    except RuntimeError as exc:
        sys.exit("%s (exit 3)" % exc)

    size_kb = out.stat().st_size / 1024
    print("OK  wrote %s (%.1f KB)" % (out, size_kb))


if __name__ == "__main__":
    main()