---
name: dsh-with-chatgpt
description: Set up, verify, or diagnose the miuuyy/codex-chatgpt-web bridge and its DSH adapter shim (provider `cgw`). Replaces the retired XiaoDuoYa C2C workflow.
---

# DSH with ChatGPT Web

Route DSH agent turns through the user's logged-in ChatGPT Web session instead of
the API, so those turns are covered by the ChatGPT subscription. Two pieces:

| Piece | What it is | Where |
|---|---|---|
| bridge | upstream `codex-chatgpt-web` launcher; owns the browser + login | `127.0.0.1:17841` |
| adapter | `tools/dsh-chatgpt-shim.mjs`; normalizes DSH turns for the bridge | `127.0.0.1:17842` |

DSH reaches them through provider `cgw` in `~/.dsh/profiles/web/cordis.patch.yml`
(api `openai-responses`, baseURL `http://127.0.0.1:17842/v1`). The route is
additive: provider `or` and the default model are untouched, and nothing routes
to it until a session explicitly picks a `chatgpt-web/*` model. A config change
only takes effect after DSH restarts.

## Modes and why the adapter exists

The adapter runs in the mode set by `CGW_BRIDGE_MODE` (default
**`browser-only`**; the other value is `full`). The bridge's own mode must match:
`~/.codex-chatgpt-web/config.json` `mode` plus a bridge restart (`/admin/drain`
then relaunch `serve`).

**browser-only (current, verified):** ChatGPT answers plain text; DSH keeps
executing its own tools natively. The adapter does not forge Codex trust; it only
normalizes what the bridge needs from any client:

1. Every input item gets a `type` and a stable `id` (DSH sends bare
   `{role, content}` — bridge v6.1.9 rejects items without an id).
2. The last user message is stamped with
   `internal_chat_message_metadata_passthrough.turn_id`.
3. `prompt_cache_key` is reused as the bridge `thread_id`, so all DSH sessions of
   one conversation share one ChatGPT thread; each request gets a fresh `turn_id`.
4. Any `role:"system"` item is lifted into `instructions` (see A/B note below).

**full (retired as default, kept as an option):** required Codex's own envelope —
`client_metadata["x-codex-turn-metadata"]` JSON with `{thread_id, turn_id,
request_kind:"turn", sandbox:"none", workspaces:{[cwd]:{}}}` plus a first user
message prefixed with `<environment_context>` (cwd + workspace root). The adapter
can still emit it (`CGW_BRIDGE_MODE=full`). Two hard-won findings:

- **`input` must contain no `role: "system"` item.** With it present the bridge
  answers *"ChatGPT web turn is missing cwd in trusted Codex environment
  context"* even when the envelope and ids are correct. Isolated by A/B against
  the real bridge: system+env fails, env alone passes.
- Full mode drove the ChatGPT DOM through a connector-mention/attachment broker
  whose continuation guard repeatedly threw
  `ChatGPT opened another user turn while the bound assistant response was
  detached` — five traces, assistant fully rendered at failure. Upstream is
  minified; do not patch `cli.js`. That brittleness is why tool-bearing ChatGPT
  turns were retired in favor of browser-only + native DSH execution.

## Credential

DSH refuses a route without a credential reference. The adapter ignores
`Authorization`, so the value is arbitrary — but one must exist, or every turn
fails with `MISSING_CREDENTIAL: llm-pi-ai: no credential for provider route "cgw"`.
Either store any placeholder on the web **Models** page for *ChatGPT Web
(codex-chatgpt-web)*, or export `CGW_API_KEY` before starting DSH.

## Verified state (2026-10-17, bridge v6.1.9, mode `browser-only`)

`node tools/dsh-chatgpt-check.mjs` — real adapter, real bridge, real ChatGPT Web
turns (five browser turns; `--text-only` runs only the cheap ones):

```
ĐẠT  bridge /healthz — HTTP 200 mode=browser-only v6.1.9 accepting_turns=true
ĐẠT  shim serves the model catalog — HTTP 200 models=7
ĐẠT  text turn — reply contains "DSH-CHATGPT-OK", tokens=8878
ĐẠT  DSH declares tools; bridge answers text without faking a call — fakeCall=false
ĐẠT  continuation: model recalls the previous turn's context — "GREEN-HERON-7"
5/5 stage(s) passed
```

Note: the bridge prefixes **every** browser-only reply with an advisory block
("> **Local tools unavailable** …") as its first text event. Harmless, but it
costs output tokens on each turn.

Real-DSH proof (provider `cgw` via the pi-ai transport, not raw fetch):
`dsh --profile headless --patch <overlay-pointing-cgw-at-17842> --json "<prompt>"`
with `CGW_API_KEY=local-placeholder` → **exit 0**, final assistant text exactly
`DSH-REAL-CGW-OK` (`/tmp/dsh-cgw-text-events.jsonl`, temporary).

`node --test test/` — 55 pass, 0 fail.
`dsh --profile web --dump-config` accepts the `cgw` route.

Multi-turn continuation through the shim with full history replay (codeword
recall) also passed live (15s).

### Historical: full mode (do not re-litigate without cause)

- Full-mode headless run proved DSH actually executed a `read` tool call mid-turn
  (`/tmp/dsh-cgw-proof-events.jsonl` lines 4–5, temporary), but the same run
  ended in `chatgpt_submitted_turn_failed`: the continuation/ownership guard above.
  Diagnostics under `~/.codex-chatgpt-web/diagnostics/browser-turns/` (latest
  trace inspected: `c9f580377e8e`); whether DOM reshaping or a competing turn was
  never resolved. Plain string tool results are supported upstream — do not
  JSON-wrap them as a speculative fix.
- In browser-only, ChatGPT cannot drive DSH tool calls at all (by design): DSH
  declares its tools, the bridge ignores them, ChatGPT plans, DSH executes.
- The adapter must never claim tool effects are simulated, add fabricated Codex
  trust markers, or read cookies/tokens to pass a gate.

## Operating it

```bash
systemctl --user status dsh-chatgpt-shim.service       # adapter
curl -s localhost:17841/healthz                        # bridge (launcher)
node tools/dsh-chatgpt-check.mjs                       # 5-stage proof
node --test test/dsh-chatgpt-shim.test.mjs             # adapter unit tests
```

Start order: bridge (launcher) → adapter. The adapter stays up even if the bridge
is down; turns then fail with `bridge unreachable` instead of hanging.

Do not diagnose a wedged tab from a generic submission failure or locator timeout.
Earlier guidance did so incorrectly: upstream `U_` wraps multiple original errors
as `ChatGPT stopped responding after the task started`, and the inspected timeout
log shows the click completed before navigation waiting timed out. The adapter
now forwards upstream response bytes unchanged instead of appending that diagnosis.

For a failure, correlate trace/time with existing `*-turn-failed.json` diagnostics
under `~/.codex-chatgpt-web/diagnostics/browser-turns`. JSON captures the original
browser error without enabling screenshots. `CODEX_CHATGPT_WEB_BROWSER_DIAGNOSTICS=1`
adds PNG captures, which can expose private UI; do not enable it just to read errors.
The bridge uses embedded Electron WebContentsView surfaces, not the user's ordinary
Chromium, with persistent partition `persist:codex-web-gpt-chatgpt` under the
launcher user-data directory (default `~/.config/Codex Web GPT`). Do not reload or
close the user's tabs yourself. Never substitute a browser process, cookie scraping,
or an alternate automation path; use injected `bsk_*` tools per `browser-skill`.
Adding Chromium launch flags or asking for reload is not a proven continuation fix.

## Recommended workflow

ChatGPT plans and reviews as plain text; DSH executes tools natively and feeds
results back as history. To use it: restart DSH so the `cgw` provider loads, then
pick a `ChatGPT Web/*` model in the session's model selector. Every model turn is
then served by the ChatGPT subscription instead of the API, while `read`/`edit`/
`bash` etc. still run in DSH. Caveats: browser turns take ~10–20 s each, and
ChatGPT only sees the conversation text — it has no direct view of the workspace.

## Cost, quota, and honesty

Turns on `cgw` are served by the ChatGPT subscription, so they do not bill the
API that `or` uses. That is the point of the route — but it is a mechanism, not a
measured saving: no before/after token or latency comparison has been recorded
yet. Do not promise savings, and do not defeat rate limits, rotate accounts, or
work around quotas. Browser turns are far slower than API turns; use `cgw` for
work that tolerates that.

## Setup discipline

- Keep isolated application/Codex homes during setup so upstream cannot overwrite
  real Codex config or routes.
- Human owns login, pair, and connector grants.
- Never send the real workspace without explicit consent to share its data.
- Report installation, login, bridge readiness, DSH response, and DSH tool
  execution as separate stages. A missing stage stays **unverified**.

## Retired: XiaoDuoYa C2C

C2C is retired at the user's request; do not open its browser, start its tunnel,
pair its connector, or resume its PLAN/REVIEW loop. The native control plugin has
been removed from the web profile (a running DSH process may retain the old tool
until restart). Browser login data and checkpoints are preserved.
`tools/dsh-c2c` permits only `stop` and `status` for
shutdown/inspection. Do not return to the old workflow as a fallback.
