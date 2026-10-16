---
name: dsh-with-chatgpt
description: Set up or diagnose the miuuyy/codex-chatgpt-web bridge for DeepSeek Harness. The earlier C2C planner/reviewer workflow is retired.
---

# DSH with ChatGPT Web

## Active direction

Use https://github.com/miuuyy/codex-chatgpt-web, not XiaoDuoYa C2C.
C2C is retired at the user's request. Do not open its browser, start its tunnel,
pair its connector, or resume its PLAN/REVIEW loop. The native control plugin
has been removed from the web profile; a running DSH process may retain the
old tool until restart. Browser login data and checkpoints are preserved.
`tools/dsh-c2c` permits only `status` and `stop` for shutdown/inspection.

## Compatibility boundary

Upstream is built for Codex, not a generic OpenAI-compatible server.
The extracted CLI runtime is at
`/home/dzerok/.local/opt/codex-chatgpt-web-6.1.9`.
The official desktop launcher supplies its own Electron browser/login.
Do not import cookies, reuse another browser profile, or bypass login/CAPTCHA.

DSH integration is not yet verified. A successful launcher install is not a
working DSH provider. Inspect upstream request metadata, browser ownership,
Responses streaming and tool broker contracts before enabling a route.
Browser-only mode explicitly has no local tools; do not advertise it as a
coding-agent replacement. Full mode needs a compatible, permission-preserving
tool execution bridge, not fabricated Codex trust markers.

## Setup discipline

Keep current DSH provider/model unchanged until a separate synthetic smoke test
proves a real response and, separately, permitted tool execution. Use isolated
application/Codex homes for setup so upstream cannot overwrite real Codex routes.
Never send the real workspace without explicit consent to share its data.
Human owns login and connector grants. Respect account quotas and policies;
never rotate accounts or promise API savings before measurement.

Report installation, account login, local bridge readiness, DSH response and
DSH tool execution separately. Missing stages remain unverified. Do not return
to the old C2C workflow as a fallback.
