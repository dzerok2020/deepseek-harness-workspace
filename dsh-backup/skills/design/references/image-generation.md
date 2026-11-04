# Image generation (local 9Router)

The design skill renders real images through the user's **local 9Router** gateway
(OpenAI-compatible image endpoint). No cloud key is needed — 9Router forwards to
the DeepSeek Media Service model and returns a signed image.

Everything below was verified on 2026-10-28 against a live gateway; the two
images referenced were generated and inspected, not assumed.

## Credentials

Stored once in `~/.dsh/9router-image.env` (mode `600`, read automatically):

```dotenv
NINEROUTER_IMAGE_BASE=http://localhost:20129/v1
NINEROUTER_IMAGE_KEY=sk-...
NINEROUTER_IMAGE_MODEL=cx/gpt-6-sol-image
```

Priority: CLI flag > environment variable > that file. Never echo the key.

## The one renderer

`scripts/image/generate.py` is the single entry point for every image the skill
produces — logo, icon, banner, poster, social photo, CIP mockup, image restyle.
It is both a CLI and an importable module (`render()`).

```bash
# square mark
python3 scripts/image/generate.py "minimal H mark, ink background, amber accent" -o out.png

# 3:4 poster
python3 scripts/image/generate.py "editorial poster for a dev conference" -o poster.png -r 3:4

# image-to-image (URL or local path)
python3 scripts/image/generate.py "recolor to dusk palette" -o dusk.png --image https://example.com/in.png
```

Flags: `-r/--aspect-ratio` (`1:1`, `16:9`, `9:16`, `4:3`, `3:4`), `--size WxH`
(explicit, overrides ratio), `--quality`, `--background`, `--image-detail`,
`--image` (reference), `--model`, `--base`, `--timeout`.

Aspect ratio → wire size hint: `1:1`→`1024x1024`, `16:9`→`1536x1024`,
`9:16`→`1024x1536`, `4:3`→`1408x1056`, `3:4`→`1056x1408`.

**`size` is advisory only.** The upstream model derives the frame from the
prompt text and overwrites the requested size — verified twice on 2026-10-28:
a neutral prompt sent as `16:9` came back `1024x1536` (portrait), while the same
prompt prefixed `horizontal landscape 16:9 widescreen composition` came back
`1672x941` (1.777 — correct). **Put the frame in the prompt**, then treat `-r`
as a hint.

## Wire contract

```
POST {base}/images/generations
Authorization: Bearer $NINEROUTER_IMAGE_KEY
Content-Type: application/json
Accept: application/json

{ "model": "cx/gpt-6-sol-image", "prompt": "...", "n": 1,
  "size": "1024x1024", "quality": "auto", "background": "auto",
  "image_detail": "high", "output_format": "png",
  "watermark": false, "prompt_extend": true,
  "image": "<url or data:image/...;base64,...>" }   // image → image-to-image
```

The response is JSON with the bytes in `data[0].b64_json`; an `http(s)` URL may
appear instead and is downloaded. The renderer also accepts `images[]` /
`output[]` buckets and `b64` / `image_base64` field aliases, so a gateway change
does not immediately break it. `Accept: text/event-stream` is supported by the
gateway but this renderer asks for plain JSON.

## Measured behaviour

| Case | Result |
| --- | --- |
| `1:1` logo/mark prompt | HTTP 200, ~44–49 s, PNG |
| Requested `1024x1024` | server returns `1254x1254` |
| Requested `16:9`, neutral prompt | server returns `1024x1536` — **wrong frame** |
| `16:9` + "horizontal landscape 16:9 widescreen" in prompt | server returns `1672x941` (1.777) |
| Prompt "wide banner" | server returns `2172x724` (3:1) |
| Flat mark, dark bg | ~1.7 MB PNG |
| Logo with wordmark | ~370 KB PNG |
| Output signing | images carry C2PA metadata from the media service |

Three consequences for prompts: **budget ~1 minute per image** (batch mode is
slow, say so before promising N variants); **state the frame in the prompt**
(see above) — `-r` alone does not constrain it; and **read the real pixel size
from the written file**, never from your request.

## Wiring into the other scripts

`scripts/logo/generate.py` exposes the renderer as a first-class provider:

```bash
python3 scripts/logo/generate.py -p "a lighthouse" --provider 9router \
  --style luxury --industry tech --brand "Beacon" -r 1:1 -o logo.png
```

`--provider 9router` reuses the skill's own prompt engineering (55 styles, 25
industry guides, color palettes) and then renders locally — this is the default
choice when no cloud key is present. `gemini`, `atlas` and `muapi` still work if
their keys are exported.

`scripts/cip/generate.py` renders every CIP deliverable through the same
renderer, with the brand logo switched on as an image-editing reference:

```bash
python3 scripts/cip/generate.py --brand "Nova" --industry technology \
  --deliverable "business card" --output ./cip --provider 9router
```

`scripts/icon/generate.py` is the one generator that does **not** call the image
endpoint: an icon must stay an editable vector, so it asks a text model
(`chat/completions`) for SVG markup and then runs the skill's own extraction and
`currentColor` / viewBox post-processing.

```bash
python3 scripts/icon/generate.py -p "cloud with upload arrow" -n cloud-upload -o cloud.svg
python3 scripts/icon/generate.py -p "gear settings" --batch 3 --output-dir ./icons
```

### `--provider auto` (default everywhere)

All three generators accept `--provider auto|9router|gemini` and default to
`auto`: the local gateway is used when `NINEROUTER_IMAGE_KEY` resolves, so
nothing has to be exported or switched by hand. Pass `--provider gemini`
explicitly to force the Google SDK path (needs `GEMINI_API_KEY` and the
`google-genai` package).

Shared client: `scripts/ninerouter.py` — `available()`, `chat()`,
`render_image()`, `data_uri()`. Import it instead of re-reading the env file.

### Text-model chat contract

```
POST {base}/chat/completions
Authorization: Bearer $NINEROUTER_IMAGE_KEY

{ "model": "cx/gpt-6-sol", "messages": [{"role": "user", "content": "..."}],
  "max_tokens": 16384, "temperature": 0.7 }
```

Reads `choices[0].message.content` (plain string or content-part list) and
raises on `finish_reason: "length"` so truncated SVG is never silently saved.
The gateway serves this model without listing it in `GET /v1/models` — never
probe that endpoint for readiness, check that a key resolved.

Verified 2026-10-28: `a security shield with a checkmark` → a valid 24×24
`currentColor` SVG on the first try; batch of 2 → 2/2 files.

## Banners and social cards

Never render a finished banner with the image model: it misspells text and
ignores the requested frame (see Measured behaviour). Generate **only the
backdrop**, keep caption / CTA / logo in HTML, and screenshot at exact pixels.

`scripts/backdrop.py` builds that prompt for you:

```bash
python3 scripts/backdrop.py "abstract circuit waves on deep navy" \
  -o art.png -W 1200 -H 630 --style "minimal gradient" \
  --palette "navy #0B1F3A, cyan #22D3EE" --text-zone left
```

It maps the target size to the closest supported ratio (`1200x630` → `16:9`),
appends `no text, no letters, no words, no logos` guards, and reserves a
low-contrast band for the caption. The returned frame rarely matches the target
exactly — crop with CSS `background-size: cover`; never set the banner size from
the image.

Measured 2026-10-28: `1200x630`, `--text-zone left` → `1672x941` (1.777), no
text in the frame, left two thirds dark enough for white caption text.

## Failure modes

| Symptom | Cause | Fix |
| --- | --- | --- |
| `cannot reach ...` | 9Router not running on 20129 | start the gateway; check `curl {base}/models` |
| `HTTP 401` | key missing or rotated | update `NINEROUTER_IMAGE_KEY` in `~/.dsh/9router-image.env` |
| `HTTP 429` / `HTTP 5xx` | upstream quota or transient | wait, retry once, then report |
| `no image in response` | upstream returned text/refusal | read the printed top-level keys and the prompt; shorten or soften it |