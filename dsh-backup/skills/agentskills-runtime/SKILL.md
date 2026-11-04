---
name: agentskills-runtime
description: Python runtime for the Anthropic document/CV skills installed in ~/.dsh/skills. Use whenever running scripts from the pdf, docx, pptx, xlsx, slack-gif-creator, mcp-builder skills or doing computer-vision work with supervision (annotating detections, tracking, datasets, mAP) - this skill tells you the exact venv interpreter path, installed packages, and helper binaries so scripts do not fail with ModuleNotFoundError on system python.
---

# Anthropic skills runtime

This box has the Anthropic skills pack (github.com/anthropics/skills @8a1541c) installed as DSH skills:
`academy-guide, algorithmic-art, brand-guidelines, canvas-design, claude-api, discernment-nudge, doc-coauthoring, docx, frontend-design, internal-comms, mcp-builder, pdf, pptx, skill-creator, slack-gif-creator, theme-factory, web-artifacts-builder, webapp-testing, xlsx`.
Source clone kept at `/home/dzerok/vendor/anthropics-skills` (read its `spec/` for the Agent Skills format and `template/` for authoring new skills — skill-creator skill also guides this).

**Do NOT run skill scripts with system `python3`.** Use the dedicated venv interpreter:

```
/home/dzerok/venvs/agentskills/bin/python <script.py>
```

What is inside that venv (verify with `.../bin/python -c "import ..."`):
- **supervision** (Roboflow CV library, installed from local clone `/home/dzerok/vendor/supervision`, v0.31.0.dev0) + `opencv-python-headless`, `numpy`, `scipy`, `matplotlib`, `pillow`, `av`, `pyyaml`, `requests`, `tqdm`.
- Document-skill deps: `pypdf`, `pdfplumber`, `pdf2image`, `reportlab`, `openpyxl`, `lxml`, `defusedxml`, `Pillow`, `imageio`, `imageio-ffmpeg`.
- API/MCP deps: `anthropic`, `mcp`.
- Not included: `rasterio` (supervision geotiff extra), `pandas` (metrics extra) — install on demand into the same venv: `VIRTUAL_ENV=/home/dzerok/venvs/agentskills uv pip install pandas`.

Helper binaries on PATH already: `pdftoppm` (poppler, required by pdf2image), `soffice`/`libreoffice` (docx/pptx → PDF conversion used by the office skills). `ffmpeg` is reachable through `imageio-ffmpeg` if no system ffmpeg.

Usage patterns:
- Office skills (docx/xlsx/pptx/pdf) ship `scripts/` folders; run their commands but replace `python`/`python3` with the venv interpreter above.
- Supervision tasks: `import supervision as sv`, then annotate `sv.Detections` with `sv.BoxAnnotator`/`LabelAnnotator`/`MaskAnnotator`, use `sv.LineZone`/`sv.PolygonZone` counting, `sv.DetectionTracer`, and `sv.Dataset` format converters (COCO/VOC/YOLO). Docs: `/home/dzerok/vendor/supervision/docs` (mkdocs source; online mirror supervision.roboflow.com). The repo's `AGENTS.md` describes its module layout if the code itself must be consulted. CPU-only inference is fine for annotation/post-processing; model weights (yolo etc.) are NOT installed — this runtime does post-processing/annotation/dataset work.
- webapp-testing skill needs Node Playwright (`npx playwright`); install browsers on demand only.
