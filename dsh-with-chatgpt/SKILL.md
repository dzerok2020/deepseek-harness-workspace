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
| adapter | `tools/dsh-chatgpt-shim.mjs`; adds the envelope the bridge requires | `127.0.0.1:17842` |

DSH reaches them through provider `cgw` in `~/.dsh/profiles/web/cordis.patch.yml`
(api `openai-responses`, baseURL `http://127.0.0.1:17842/v1`). The route is
additive: provider `or` and the default model are untouched, and nothing routes
to it until a session explicitly picks a `chatgpt-web/*` model. A config change
only takes effect after DSH restarts.

## Why the adapter exists

The bridge is written for Codex as its client. On a **tool-bearing** turn it
demands Codex's own transport envelope and otherwise fails with:

```
ChatGPT web turn is missing cwd in trusted Codex environment context
```

DSH does not produce it. Verified requirements against bridge v6.1.9
(`cli.js`, function `zT` / `Bg`):

1. `client_metadata["x-codex-turn-metadata"]` = JSON
   `{thread_id, turn_id, request_kind:"turn", sandbox:"none", workspaces:{[cwd]:{}}}`.
2. A user message whose content starts with the `<environment_context>` block
   (cwd + workspace root) and carries
   `internal_chat_message_metadata_passthrough.turn_id` equal to the metadata's.
3. **Every message item needs an `id`.** Without one the turn is rejected at the
   cwd gate even though the context is present. DSH sends items as bare
   `{role, content}` with no `type` and no `id` (captured 2026-10-16: 1 system +
   4 user, 24 tools); the adapter adds both.
4. **`input` must contain no `role: "system"` item.** DSH puts its agent prompt
   there. With it present the bridge still answers *"missing cwd in trusted Codex
   environment context"*, even though the envelope and ids are correct. Moving it
   to `instructions` fixes it. Isolated by A/B against the real bridge:
   system+env fails, env alone passes, and the env message's `turn_id` is not the
   deciding factor.

## Credential

DSH refuses a route without a credential reference. The adapter ignores
`Authorization`, so the value is arbitrary — but one must exist, or every turn
fails with `MISSING_CREDENTIAL: llm-pi-ai: no credential for provider route "cgw"`.
Either store any placeholder on the web **Models** page for *ChatGPT Web
(codex-chatgpt-web)*, or export `CGW_API_KEY` before starting DSH.

## Verified state (2026-10-16, bridge v6.1.9, mode `full`)

`node tools/dsh-chatgpt-check.mjs` — real bridge, real ChatGPT Web turns:

```
ĐẠT bridge /healthz reachable and accepting turns — HTTP 200 mode=full accepting_turns=true
ĐẠT shim serves the model catalog — HTTP 200 models=7
ĐẠT text turn through shim -> bridge -> ChatGPT Web — HTTP 200 reply="DSH-CHATGPT-OK" tokens=9322
ĐẠT tool-bearing turn returns a real function_call — calls=[{"name":"dsh_read_file","arguments":"{\"path\":\"NOTES.md\"}"}]
4/4 stage(s) passed
```

Historical transport smoke above is not current acceptance evidence. Its adapter
also included a DEV-only assertion that tool effects were simulated; that false
assertion has now been removed. Revalidate the full flow without it.

`node --test test/` — 53 pass, 0 fail after that correction.
`dsh --profile web --dump-config` accepts the `cgw` route.

Earlier DSH requests reached the browser stage, but that does not prove the
complete envelope contract. The current synthetic check (cwd `/tmp`, 60s timeout)
passes only 2/4 stages: text fails with `locator.click: Timeout 3000ms exceeded`;
tool generation fails with `ChatGPT browser DOM observation did not respond within
3ms`. DSH text, tool execution, and tool-result continuation are **not yet verified**.
Random per-request thread/turn ids also require retry/continuation validation before
activation. Re-run an isolated headless DSH test only after browser transport works.

A returned `function_call` proves only tool-call generation, not execution or
successful continuation. DSH tool execution and receipt-to-final-answer remain
**not yet verified**. The adapter must describe the real execution environment;
never add DEV simulation assertions or fabricated Codex trust markers to pass a
gate. Never read cookies/tokens or reuse another browser profile.

## Operating it

```bash
systemctl --user status dsh-chatgpt-shim.service       # adapter
curl -s localhost:17841/healthz                        # bridge (launcher)
node tools/dsh-chatgpt-check.mjs                       # 4-stage proof
node --test test/dsh-chatgpt-shim.test.mjs             # adapter unit tests
```

Start order: bridge (launcher) → adapter. The adapter stays up even if the bridge
is down; turns then fail with `bridge unreachable` instead of hanging.

Two wedged-tab symptoms, both browser-state and neither an envelope problem:
*"ChatGPT stopped responding after the task started"*, and `locator.click: Timeout
3000ms exceeded` on the model-switcher button (the element resolves but never
becomes clickable). Ask the human to revive the ChatGPT tab in the launcher. The
bridge uses embedded Electron WebContentsView surfaces, not the user's ordinary
Chromium. Source inspection shows persistent partition
`persist:codex-web-gpt-chatgpt` under the launcher user-data directory (default
`~/.config/Codex Web GPT`). Active turn views already disable background throttling;
adding Chromium launch flags is not a proven repair. Do not reload or close the
user's tabs yourself. Never substitute a browser process, cookie scraping, or an alternate
automation path; per `browser-skill` those require the injected `bsk_*` tools, and
if they are absent, say so instead. The adapter appends that remedy to the streamed
error text, so a wedged turn now names the fix instead of surfacing a bare
Playwright timeout.

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
