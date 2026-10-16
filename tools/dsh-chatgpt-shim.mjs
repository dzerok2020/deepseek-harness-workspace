#!/usr/bin/env node
// dsh-chatgpt-shim.mjs — OpenAI Responses adapter for the codex-chatgpt-web bridge.
//
// WHY THIS EXISTS
// The bridge (miuuyy/codex-chatgpt-web) is written for Codex as its client and
// requires Codex's own transport envelope. DeepSeek Harness does not produce it,
// so this adapter adds the minimum the bridge actually demands, per mode:
//   browser-only (verified 2026-10-17): stable turn metadata plus a typed user
//     message carrying that turn_id. ChatGPT answers text only; DSH keeps
//     executing its own tools. No environment_context is injected — the bridge
//     accepts the turn without it, and the envelope would be an untrue claim
//     about a local Codex workspace.
//   full (kept for fallback; NOT reliable with DSH): the bridge additionally
//     requires a trusted `<environment_context>` block naming a cwd, or it fails
//     with "ChatGPT web turn is missing cwd in trusted Codex environment
//     context". Full-mode tool continuations were observed to fail upstream with
//     "ChatGPT opened another user turn while the bound assistant response was
//     detached" even after the answer completed, so browser-only is the default.
//
// WHAT IT IS NOT
// It grants no capability. The envelope describes the local execution environment;
// every tool call in the reply is executed by DSH under DSH's own sandbox policy,
// never by ChatGPT. This adapter does not read cookies, tokens, or browser state,
// and it never writes request or response bodies to disk.
//
// CONFIG (environment)
//   CGW_BRIDGE_URL  default http://127.0.0.1:17841
//   CGW_SHIM_PORT   default 17842
//   CGW_CWD         default $DSH_WORKSPACE or process.cwd()
//   CGW_MODELS      comma-separated model ids; default = verified catalog
//   CGW_BRIDGE_MODE "browser-only" (default) or "full"; must match the bridge's
//                   own mode in ~/.codex-chatgpt-web/config.json or the envelope
//                   shape will be wrong for it.

import http from "node:http";
import { randomUUID } from "node:crypto";

// The bridge validates turn metadata with an all-or-nothing rule: if thread_id
// or turn_id looks like a native Codex identifier (a bare RFC-4122 UUID,
// cli.js regex ff), BOTH must. DSH's prompt_cache_key can itself be a bare
// UUID, so prefix every id we generate with a marker the UUID regex can never
// match. Both-non-native is the documented skip path in the bridge.
const NON_NATIVE = (value) => `dsh-${value}`;
import { Readable } from "node:stream";

/** Bridge v6.1.9 verified model catalog. */
export const DEFAULT_MODELS = Object.freeze([
  "chatgpt-web/gpt-6-sol-instant",
  "chatgpt-web/gpt-6-sol",
  "chatgpt-web/gpt-6-pro",
  "chatgpt-web/gpt-5.6-sol-instant",
  "chatgpt-web/gpt-5.6-sol",
  "chatgpt-web/gpt-5.6-pro",
  "chatgpt-web/gpt-5.6-luna",
]);

// Only value the bridge is verified to accept. Kept explicit (not a tunable) so a
// wrong setting cannot silently weaken what the bridge is told.
const SANDBOX = "none";

const hex = () => randomUUID().replaceAll("-", "");

/** The `<environment_context>` block the bridge demands on every turn. */
export function buildEnvironmentContext(cwd) {
  return `<environment_context>
  <cwd>${cwd}</cwd>
  <filesystem><workspace_roots><root>${cwd}</root></workspace_roots><permission_profile type="disabled"><file_system type="unrestricted" /></permission_profile></filesystem>
</environment_context>`;
}

/** `x-codex-turn-metadata`: turn identity plus the trusted workspace root. */
export function buildTurnMetadata({ threadId, turnId, cwd }) {
  return {
    thread_id: threadId,
    turn_id: turnId,
    request_kind: "turn",
    sandbox: SANDBOX,
    workspaces: { [cwd]: {} },
  };
}

/**
 * Resolve the cwd the adapters announce, refusing anything outside the allowed
 * roots (so a caller cannot make the envelope describe an unrelated directory).
 */
export function resolveWorkspaceCwd(requested, allowedRoots, fallback) {
  const roots = allowedRoots.length ? allowedRoots : [fallback];
  const candidate = requested || fallback;
  const ok = roots.some((r) => candidate === r || candidate.startsWith(r.replace(/\/+$/, "") + "/"));
  if (!ok) throw new Error(`cwd ${candidate} is outside allowed roots: ${roots.join(", ")}`);
  return candidate;
}

export function isKnownModel(model, models = DEFAULT_MODELS) {
  return models.includes(model);
}

export function listModels(models = DEFAULT_MODELS) {
  return models.map((id) => ({ id, object: "model", created: 0, owned_by: "codex-chatgpt-web" }));
}

/**
 * The bridge resolves a turn's cwd from item ids, so every message item must
 * carry one. DSH sends `{role, content}` items with no `type` and no `id`
 * (captured 2026-10-16: 1 system + 4 user, 24 tools), so match on either shape,
 * add the missing id, and leave genuinely non-message items untouched.
 */
export function normalizeInput(input) {
  return input.map((item) => {
    if (!item || typeof item !== "object") return item;
    const isMessage = item.type === "message" || (item.type === undefined && typeof item.role === "string");
    if (!isMessage) return item;
    const next = { ...item, type: "message" };
    if (!next.id) next.id = `msg_${hex()}`;
    return next;
  });
}

/**
 * Lift `role: "system"` messages out of `input` into `instructions`.
 *
 * DSH puts its agent prompt in `input` as a system-role message, but the bridge
 * only resolves the trusted cwd when `input` holds no system-role item; with one
 * present the real bridge answers "missing cwd in trusted Codex environment
 * context" (isolated 2026-10-16: system+env fails, env alone passes). Moving it
 * to `instructions` is also where the Responses API expects it.
 */
export function liftSystemMessages(input) {
  const kept = [];
  const texts = [];
  for (const item of input) {
    if (item?.type === "message" && item.role === "system") {
      const text =
        typeof item.content === "string"
          ? item.content
          : Array.isArray(item.content)
            ? item.content.map((part) => part?.text).filter((t) => typeof t === "string").join("\n")
            : "";
      if (text.trim()) texts.push(text.trim());
    } else {
      kept.push(item);
    }
  }
  return { input: kept, systemText: texts.join("\n\n") };
}

/**
 * Mark the current-turn user message with the native turn id the metadata names.
 * The bridge scans input backwards for it; without it the turn is rejected with
 * "ChatGPT web requires a current-turn user message for browser-session replay"
 * (verified 2026-10-17 against bridge v6.1.9 browser-only mode).
 */
export function stampCurrentTurnId(input, turnId) {
  let last = -1;
  input.forEach((item, i) => {
    if (item?.type === "message" && item.role === "user") last = i;
  });
  if (last === -1) throw new Error("no user message to stamp turn_id on");
  return input.map((item, i) =>
    i === last ? { ...item, internal_chat_message_metadata_passthrough: { turn_id: turnId } } : item,
  );
}

/**
 * Native Codex turn shape for full mode: the `<environment_context>` fragment
 * sits IMMEDIATELY BEFORE the current (last) user message, not at the head of
 * the history. A journal-activated serve scans backwards from the last user
 * item and rejects with "missing cwd" when the fragment precedes older turns
 * (verified 2026-10-17: stage 5 history replay failed head-placed, single-user
 * stages passed either way).
 */
export function withEnvironmentContext(input, cwd, turnId) {
  const environment = {
    type: "message",
    id: `msg_environment_${hex()}`,
    role: "user",
    content: [{ type: "input_text", text: buildEnvironmentContext(cwd) }],
    internal_chat_message_metadata_passthrough: { turn_id: turnId },
  };
  let last = -1;
  input.forEach((item, i) => {
    if (item?.type === "message" && item.role === "user") last = i;
  });
  if (last === -1) return [environment, ...input];
  return [...input.slice(0, last), environment, ...input.slice(last)];
}

/**
 * Rewrite a DSH Responses request into one the bridge accepts.
 * Pure apart from the generated ids. No I/O.
 */
export function adaptRequestBody(dshBody, { cwd, models = DEFAULT_MODELS, threadId, turnId, mode = "browser-only" }) {
  const model = dshBody?.model;
  if (!isKnownModel(model, models)) {
    throw new Error(`unknown model ${JSON.stringify(model)}; known: ${models.join(", ")}`);
  }
  const normalized = normalizeInput(Array.isArray(dshBody.input) ? dshBody.input : []);
  const { input, systemText } = liftSystemMessages(normalized);
  const instructions = [dshBody.instructions, systemText]
    .filter((t) => typeof t === "string" && t.trim())
    .join("\n\n");
  const finalInput =
    mode === "full"
      ? withEnvironmentContext(input, cwd, turnId)
      : stampCurrentTurnId(input, turnId);
  return {
    ...dshBody,
    model,
    ...(instructions ? { instructions } : {}),
    input: finalInput,
    client_metadata: {
      ...(dshBody.client_metadata ?? {}),
      "x-codex-turn-metadata": JSON.stringify(buildTurnMetadata({ threadId, turnId, cwd })),
    },
  };
}

export function buildModelsPayload(models = DEFAULT_MODELS) {
  return { object: "list", data: listModels(models) };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > 32 * 1024 * 1024) reject(new Error("request body too large"));
      else chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sendJson(res, status, payload) {
  const text = JSON.stringify(payload);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(text) });
  res.end(text);
}

export function createServer({ bridgeUrl, cwd, models, mode = "browser-only" }) {
  const base = bridgeUrl.replace(/\/+$/, "");
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (req.method === "GET" && url.pathname === "/healthz") {
      return sendJson(res, 200, { status: "ok", service: "dsh-chatgpt-shim", bridge: base, cwd, models, mode });
    }
    if (req.method === "GET" && url.pathname === "/v1/models") {
      return sendJson(res, 200, buildModelsPayload(models));
    }
    if (req.method !== "POST" || !url.pathname.startsWith("/v1/responses")) {
      return sendJson(res, 404, { error: { message: `no route for ${req.method} ${url.pathname}`, type: "invalid_request_error" } });
    }
    let body;
    try {
      const dshBody = JSON.parse(await readBody(req));
      // DSH keeps prompt_cache_key stable per session; reuse it so the bridge's
      // retry budget and thread mapping see one thread across turns.
      const rawThread = typeof dshBody.prompt_cache_key === "string" && dshBody.prompt_cache_key ? dshBody.prompt_cache_key : randomUUID();
      const threadId = NON_NATIVE(rawThread);
      body = adaptRequestBody(dshBody, { cwd, models, threadId, turnId: NON_NATIVE(randomUUID()), mode });
    } catch (err) {
      return sendJson(res, 400, { error: { message: String(err.message ?? err), type: "invalid_request_error" } });
    }
    let upstream;
    try {
      upstream = await fetch(`${base}${url.pathname}${url.search}`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: req.headers.accept ?? "text/event-stream" },
        body: JSON.stringify(body),
      });
    } catch (err) {
      return sendJson(res, 502, { error: { message: `bridge unreachable at ${base}: ${String(err.message ?? err)}`, type: "api_error" } });
    }
    const headers = { "content-type": upstream.headers.get("content-type") ?? "text/event-stream", "cache-control": "no-cache" };
    res.writeHead(upstream.status, headers);
    if (!upstream.body) return res.end();
    // Preserve upstream bytes, including errors: transport symptoms alone cannot
    // establish a browser diagnosis or justify telling the user to reload a tab.
    Readable.fromWeb(upstream.body).pipe(res);
  });
}

export function loadConfig(env = process.env) {
  const cwd = env.CGW_CWD || env.DSH_WORKSPACE || process.cwd();
  const models = env.CGW_MODELS ? env.CGW_MODELS.split(",").map((m) => m.trim()).filter(Boolean) : [...DEFAULT_MODELS];
  const mode = env.CGW_BRIDGE_MODE || "browser-only";
  if (mode !== "browser-only" && mode !== "full") throw new Error(`invalid CGW_BRIDGE_MODE ${JSON.stringify(mode)}; use "browser-only" or "full"`);
  return {
    bridgeUrl: env.CGW_BRIDGE_URL || "http://127.0.0.1:17841",
    port: Number(env.CGW_SHIM_PORT || 17842),
    cwd,
    allowedRoots: (env.CGW_ALLOWED_ROOTS || cwd).split(":").filter(Boolean),
    models,
    mode,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const cfg = loadConfig();
  const cwd = resolveWorkspaceCwd(null, cfg.allowedRoots, cfg.cwd);
  createServer({ bridgeUrl: cfg.bridgeUrl, cwd, models: cfg.models, mode: cfg.mode }).listen(cfg.port, "127.0.0.1", () => {
    console.log(`dsh-chatgpt-shim on http://127.0.0.1:${cfg.port} -> ${cfg.bridgeUrl} (cwd ${cwd}, mode ${cfg.mode})`);
  });
}
