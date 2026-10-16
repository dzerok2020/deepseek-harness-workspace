#!/usr/bin/env node
// dsh-chatgpt-shim.mjs — OpenAI Responses adapter for the codex-chatgpt-web bridge.
//
// WHY THIS EXISTS
// The bridge (miuuyy/codex-chatgpt-web) is written for Codex as its client and
// requires Codex's own transport envelope on tool-bearing turns. DeepSeek Harness
// does not produce it, so the bridge fails those turns with:
//   "ChatGPT web turn is missing cwd in trusted Codex environment context"
// This adapter adds that envelope (verified against bridge v6.1.9) and forwards
// the turn unchanged, so DSH can use the bridge as an ordinary Responses provider.
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

import http from "node:http";
import { randomUUID } from "node:crypto";
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
 * Rewrite a DSH Responses request into one the bridge accepts.
 * Pure apart from the generated ids. No I/O.
 */
export function adaptRequestBody(dshBody, { cwd, models = DEFAULT_MODELS, threadId, turnId }) {
  const model = dshBody?.model;
  if (!isKnownModel(model, models)) {
    throw new Error(`unknown model ${JSON.stringify(model)}; known: ${models.join(", ")}`);
  }
  const normalized = normalizeInput(Array.isArray(dshBody.input) ? dshBody.input : []);
  const { input, systemText } = liftSystemMessages(normalized);
  const envelope = {
    type: "message",
    id: `msg_dev_environment_${hex()}`,
    role: "user",
    content: [{ type: "input_text", text: buildEnvironmentContext(cwd) }],
    internal_chat_message_metadata_passthrough: { turn_id: turnId },
  };
  const instructions = [dshBody.instructions, systemText]
    .filter((t) => typeof t === "string" && t.trim())
    .join("\n\n");
  return {
    ...dshBody,
    model,
    ...(instructions ? { instructions } : {}),
    input: [envelope, ...input],
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

/**
 * The launcher's Chromium tab wedges occasionally, and Playwright then fails with
 * a bare "locator.click: Timeout 3000ms exceeded" (or the bridge reports "ChatGPT
 * stopped responding after the task started"). Neither names the remedy, so append
 * it to the streamed error text. ASCII only on purpose: this lands inside a JSON
 * string in an SSE frame, so a quote or backslash would corrupt the frame.
 */
const WEDGE_SIGNATURES = [
  /locator\.click: Timeout \d+ms exceeded/g,
  /ChatGPT stopped responding after the task started/g,
];
const WEDGE_REMEDY =
  " [dsh-chatgpt-shim: the launcher browser tab is wedged - bring its Chromium window to the front or reload that ChatGPT tab, then retry]";

export function annotateWedgeError(text) {
  let annotated = text;
  for (const signature of WEDGE_SIGNATURES) {
    annotated = annotated.replace(signature, (match) => match + WEDGE_REMEDY);
  }
  return annotated;
}

export function createServer({ bridgeUrl, cwd, models }) {
  const base = bridgeUrl.replace(/\/+$/, "");
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (req.method === "GET" && url.pathname === "/healthz") {
      return sendJson(res, 200, { status: "ok", service: "dsh-chatgpt-shim", bridge: base, cwd, models });
    }
    if (req.method === "GET" && url.pathname === "/v1/models") {
      return sendJson(res, 200, buildModelsPayload(models));
    }
    if (req.method !== "POST" || !url.pathname.startsWith("/v1/responses")) {
      return sendJson(res, 404, { error: { message: `no route for ${req.method} ${url.pathname}`, type: "invalid_request_error" } });
    }
    let body;
    try {
      body = adaptRequestBody(JSON.parse(await readBody(req)), { cwd, models, threadId: randomUUID(), turnId: randomUUID() });
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
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    Readable.fromWeb(
      upstream.body.pipeThrough(
        new TransformStream({
          transform(chunk, controller) {
            controller.enqueue(encoder.encode(annotateWedgeError(decoder.decode(chunk, { stream: true }))));
          },
          flush(controller) {
            const tail = decoder.decode();
            if (tail) controller.enqueue(encoder.encode(annotateWedgeError(tail)));
          },
        }),
      ),
    ).pipe(res);
  });
}

export function loadConfig(env = process.env) {
  const cwd = env.CGW_CWD || env.DSH_WORKSPACE || process.cwd();
  const models = env.CGW_MODELS ? env.CGW_MODELS.split(",").map((m) => m.trim()).filter(Boolean) : [...DEFAULT_MODELS];
  return {
    bridgeUrl: env.CGW_BRIDGE_URL || "http://127.0.0.1:17841",
    port: Number(env.CGW_SHIM_PORT || 17842),
    cwd,
    allowedRoots: (env.CGW_ALLOWED_ROOTS || cwd).split(":").filter(Boolean),
    models,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const cfg = loadConfig();
  const cwd = resolveWorkspaceCwd(null, cfg.allowedRoots, cfg.cwd);
  createServer({ bridgeUrl: cfg.bridgeUrl, cwd, models: cfg.models }).listen(cfg.port, "127.0.0.1", () => {
    console.log(`dsh-chatgpt-shim on http://127.0.0.1:${cfg.port} -> ${cfg.bridgeUrl} (cwd ${cwd})`);
  });
}
