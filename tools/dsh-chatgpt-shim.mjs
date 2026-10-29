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
//   CGW_BRIDGE_MODE "auto" (default) reads the bridge's own mode from /healthz at
//                   startup; "browser-only" or "full" pin it. The envelope shape
//                   must match the bridge's mode in ~/.codex-chatgpt-web/config.json:
//                   a journal-activated bridge (mode "full") rejects browser-only
//                   turns with "ChatGPT web turn is missing cwd in trusted Codex
//                   environment context" (reproduced 2026-10-25), which is exactly
//                   what the old hard-coded browser-only default caused.

import http from "node:http";
import { createHash, randomUUID } from "node:crypto";

// The bridge validates turn metadata with an all-or-nothing rule: if thread_id
// or turn_id looks like a native Codex identifier (a bare RFC-4122 UUID,
// cli.js regex ff), BOTH must. DSH's prompt_cache_key can itself be a bare
// UUID, so prefix every id we generate with a marker the UUID regex can never
// match. Both-non-native is the documented skip path in the bridge.
const NON_NATIVE = (value) => `dsh-${value}`;
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

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
  const seenCounts = new Map();
  return input.map((item) => {
    if (!item || typeof item !== "object") return item;
    const isMessage = item.type === "message" || (item.type === undefined && typeof item.role === "string");
    if (!isMessage) return item;
    const next = { ...item, type: "message" };
    // The bridge hashes [message id, content] to recognize instruction lineage.
    // Random ids make an overlapping replay look like unrelated steering.
    // Index-based ids break when compaction or truncation drops earlier
    // messages (the same content re-indexes to a new id), so hash
    // [role, content, occurrence]; occurrence still distinguishes repeated
    // identical messages and existing ids stay authoritative.
    if (!next.id) {
      const key = JSON.stringify([next.role, next.content]);
      const occurrence = seenCounts.get(key) ?? 0;
      seenCounts.set(key, occurrence + 1);
      next.id = `msg_${createHash("sha256").update(JSON.stringify([next.role, next.content, occurrence])).digest("hex").slice(0, 32)}`;
    }
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
/**
 * Index of the current-turn user message.
 *
 * Match on `role` alone, never on `type`: DSH sends `{role, content}` items and
 * only `normalizeInput` adds `type: "message"`. The two helpers below run after
 * that normalization in `adaptRequestBody`, but the regression test that first
 * caught this built its input by hand — so keep the lookup shape-agnostic and
 * the envelope can never be misplaced because of an untyped item again.
 */
function lastUserIndex(input) {
  let last = -1;
  input.forEach((item, i) => {
    if (item && typeof item === "object" && item.role === "user") last = i;
  });
  return last;
}

export function stampCurrentTurnId(input, turnId) {
  const last = lastUserIndex(input);
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
  let last = lastUserIndex(input);
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

// DSH's compaction package appends this exact instruction as the last user
// message of a background summarization request (dsh-compaction-basic).
const COMPACTION_PREFIX = "You are now acting as a compaction engine";

function lastUserText(input) {
  if (!Array.isArray(input)) return "";
  for (let i = input.length - 1; i >= 0; i -= 1) {
    const item = input[i];
    if (!item || typeof item !== "object") continue;
    const isMessage = item.type === "message" || (item.type === undefined && typeof item.role === "string");
    if (!isMessage || item.role !== "user") continue;
    if (typeof item.content === "string") return item.content;
    if (Array.isArray(item.content)) return item.content.map((part) => (part && typeof part.text === "string" ? part.text : "")).join("");
    return "";
  }
  return "";
}

function isCompactionRequest(input) {
  return lastUserText(input).startsWith(COMPACTION_PREFIX);
}

export function createServer({ bridgeUrl, cwd, models, mode = "browser-only" }) {
  const base = bridgeUrl.replace(/\/+$/, "");
  return http.createServer(async (req, res) => {
    // Browser/rebinding boundary, not authentication for other local processes.
    const host = /^(?:localhost|127\.0\.0\.1|\[::1\])(?::(\d{1,5}))?$/i.exec(req.headers.host ?? "");
    if (!host || Number(host[1] ?? 80) !== req.socket.localPort) {
      return sendJson(res, 403, { error: { message: "Host must name this loopback listener", type: "invalid_request_error" } });
    }
    if (req.headers.origin !== undefined || req.headers["sec-fetch-site"] === "cross-site") {
      return sendJson(res, 403, { error: { message: "browser-origin requests are not allowed", type: "invalid_request_error" } });
    }
    let url;
    try {
      if (!req.url.startsWith("/") || req.url.startsWith("//")) throw new Error("invalid request target");
      url = new URL(req.url, "http://localhost");
    } catch {
      return sendJson(res, 400, { error: { message: "invalid request target", type: "invalid_request_error" } });
    }
    if (req.method === "GET" && url.pathname === "/healthz") {
      return sendJson(res, 200, { status: "ok", service: "dsh-chatgpt-shim", bridge: base, cwd, models, mode });
    }
    if (req.method === "GET" && url.pathname === "/v1/models") {
      return sendJson(res, 200, buildModelsPayload(models));
    }
    if (req.method !== "POST" || url.pathname !== "/v1/responses") {
      return sendJson(res, 404, { error: { message: `no route for ${req.method} ${url.pathname}`, type: "invalid_request_error" } });
    }
    if (req.headers["content-type"]?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
      return sendJson(res, 415, { error: { message: "application/json is required", type: "invalid_request_error" } });
    }
    let body;
    try {
      const dshBody = JSON.parse(await readBody(req));
      // DSH keeps prompt_cache_key stable per session; reuse it so the bridge's
      // retry budget and thread mapping see one thread across turns.
      const rawThread = typeof dshBody.prompt_cache_key === "string" && dshBody.prompt_cache_key ? dshBody.prompt_cache_key : randomUUID();
      // The bridge registry allows one active instruction per thread: a DSH
      // compaction request sharing the session thread supersedes (HTTP 499)
      // the user turn still streaming there. Route background compaction
      // prompts to their own thread so they never retire a live user turn.
      const threadId = NON_NATIVE(isCompactionRequest(dshBody.input) ? `${rawThread}-compaction` : rawThread);
      body = adaptRequestBody(dshBody, { cwd, models, threadId, turnId: NON_NATIVE(randomUUID()), mode });
    } catch (err) {
      return sendJson(res, 400, { error: { message: String(err.message ?? err), type: "invalid_request_error" } });
    }
    const controller = new AbortController();
    const abortUpstream = () => { if (!res.writableFinished) controller.abort(); };
    req.once("aborted", abortUpstream);
    res.once("close", abortUpstream);
    try {
      if (req.aborted || res.destroyed) return;
      const upstream = await fetch(`${base}${url.pathname}${url.search}`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: req.headers.accept ?? "text/event-stream" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const headers = { "content-type": upstream.headers.get("content-type") ?? "text/event-stream", "cache-control": "no-cache" };
      res.writeHead(upstream.status, headers);
      if (!upstream.body) return res.end();
      // Preserve upstream bytes; pipeline contains errors and cancels the source
      // on downstream disconnect rather than leaving an unhandled stream error.
      await pipeline(Readable.fromWeb(upstream.body), res);
    } catch (err) {
      if (res.destroyed || controller.signal.aborted) return;
      if (res.headersSent) return res.destroy();
      return sendJson(res, 502, { error: { message: `bridge unreachable at ${base}: ${String(err.message ?? err)}`, type: "api_error" } });
    } finally {
      req.off("aborted", abortUpstream);
      res.off("close", abortUpstream);
    }
  });
}

export function loadConfig(env = process.env) {
  const cwd = env.CGW_CWD || env.DSH_WORKSPACE || process.cwd();
  const models = env.CGW_MODELS ? env.CGW_MODELS.split(",").map((m) => m.trim()).filter(Boolean) : [...DEFAULT_MODELS];
  const mode = env.CGW_BRIDGE_MODE || "auto";
  if (!["auto", "browser-only", "full"].includes(mode)) throw new Error(`invalid CGW_BRIDGE_MODE ${JSON.stringify(mode)}; use "auto", "browser-only" or "full"`);
  return {
    bridgeUrl: env.CGW_BRIDGE_URL || "http://127.0.0.1:17841",
    port: Number(env.CGW_SHIM_PORT || 17842),
    cwd,
    allowedRoots: (env.CGW_ALLOWED_ROOTS || cwd).split(":").filter(Boolean),
    models,
    mode,
  };
}

export async function resolveBridgeMode(bridgeUrl, fetchImpl = fetch) {
  try {
    const res = await fetchImpl(`${bridgeUrl.replace(/\/$/, "")}/healthz`);
    if (!res.ok) return null;
    const body = await res.json();
    return body?.mode === "browser-only" || body?.mode === "full" ? body.mode : null;
  } catch {
    return null;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const cfg = loadConfig();
  const cwd = resolveWorkspaceCwd(null, cfg.allowedRoots, cfg.cwd);
  const mode = cfg.mode === "auto" ? (await resolveBridgeMode(cfg.bridgeUrl)) ?? "browser-only" : cfg.mode;
  if (cfg.mode === "auto" && mode === "browser-only") {
    console.warn(`bridge mode unknown at ${cfg.bridgeUrl}/healthz; assuming browser-only`);
  }
  createServer({ bridgeUrl: cfg.bridgeUrl, cwd, models: cfg.models, mode }).listen(cfg.port, "127.0.0.1", () => {
    console.log(`dsh-chatgpt-shim on http://127.0.0.1:${cfg.port} -> ${cfg.bridgeUrl} (cwd ${cwd}, mode ${mode})`);
  });
}
