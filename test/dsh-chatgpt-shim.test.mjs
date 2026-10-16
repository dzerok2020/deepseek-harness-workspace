// Tests for tools/dsh-chatgpt-shim.mjs — the Responses adapter for the
// codex-chatgpt-web bridge. Run: node --test test/
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";

import {
  DEFAULT_MODELS,
  adaptRequestBody,
  buildEnvironmentContext,
  buildModelsPayload,
  buildTurnMetadata,
  createServer,
  isKnownModel,
  liftSystemMessages,
  listModels,
  loadConfig,
  normalizeInput,
  resolveWorkspaceCwd,
} from "../tools/dsh-chatgpt-shim.mjs";

const CWD = "/tmp/ws";
const IDS = { threadId: "thread-1", turnId: "turn-1" };
const USER_MSG_ID = "msg_0123456789abcdef0123456789abcdef";

const dshRequest = (extra = {}) => ({
  model: DEFAULT_MODELS[0],
  stream: true,
  store: false,
  tools: [{ type: "function", name: "dsh_read_file", parameters: { type: "object", properties: {} } }],
  input: [{ type: "message", id: USER_MSG_ID, role: "user", content: [{ type: "input_text", text: "hello" }] }],
  ...extra,
});

test("environment context carries the cwd as both cwd and workspace root", () => {
  const ctx = buildEnvironmentContext(CWD);
  assert.match(ctx, /^<environment_context>\n/);
  assert.ok(ctx.includes(`<cwd>${CWD}</cwd>`));
  assert.ok(ctx.includes(`<workspace_roots><root>${CWD}</root></workspace_roots>`));
  assert.ok(ctx.endsWith("</environment_context>"));
});

test("real DSH requests never declare tool effects to be simulated", () => {
  for (const mode of ["browser-only", "full"]) {
    const out = adaptRequestBody(dshRequest(), { cwd: CWD, ...IDS, mode });
    assert.doesNotMatch(JSON.stringify(out), /codex_dev_mode|All outer tool effects are explicitly simulated/);
  }
});

test("turn metadata declares a turn bound to the workspace root", () => {
  const meta = buildTurnMetadata({ threadId: "t", turnId: "u", cwd: CWD });
  assert.equal(meta.request_kind, "turn");
  assert.equal(meta.thread_id, "t");
  assert.equal(meta.turn_id, "u");
  assert.equal(meta.sandbox, "none");
  assert.deepEqual(Object.keys(meta.workspaces), [CWD]);
});

test("browser-only default stamps the turn id on the last user message, no env envelope", () => {
  const body = dshRequest({
    input: [
      { type: "message", id: "msg_old", role: "user", content: [{ type: "input_text", text: "earlier" }] },
      { type: "message", id: "msg_a1", role: "assistant", content: [{ type: "output_text", text: "answer" }] },
      { type: "message", id: USER_MSG_ID, role: "user", content: [{ type: "input_text", text: "hello" }] },
    ],
  });
  const out = adaptRequestBody(body, { cwd: CWD, ...IDS });

  assert.equal(out.input.length, 3, "browser-only must not prepend anything");
  assert.doesNotMatch(JSON.stringify(out.input), /environment_context/, "no environment envelope in browser-only");
  assert.deepEqual(out.input.slice(0, 2), body.input.slice(0, 2), "history items pass through unchanged");
  const last = out.input.at(-1);
  assert.equal(last.id, USER_MSG_ID);
  assert.equal(last.internal_chat_message_metadata_passthrough.turn_id, IDS.turnId);

  const meta = JSON.parse(out.client_metadata["x-codex-turn-metadata"]);
  assert.equal(meta.turn_id, IDS.turnId);
  assert.equal(meta.thread_id, IDS.threadId);
});

test("full mode prepends the trusted environment envelope", () => {
  const body = dshRequest();
  const original = structuredClone(body);
  const out = adaptRequestBody(body, { cwd: CWD, ...IDS, mode: "full" });

  assert.equal(out.input.length, original.input.length + 1);
  const [env, ...rest] = out.input;
  assert.equal(env.type, "message");
  assert.equal(env.role, "user");
  assert.match(env.id, /^msg_environment_[0-9a-f]{32}$/);
  assert.ok(env.content[0].text.startsWith("<environment_context>"));
  assert.equal(env.internal_chat_message_metadata_passthrough.turn_id, IDS.turnId);
  assert.deepEqual(rest, original.input, "original input must pass through unchanged");
});

test("adaptRequestBody keeps caller metadata and tool declarations", () => {
  const out = adaptRequestBody(dshRequest({ client_metadata: { other: "1" } }), { cwd: CWD, ...IDS });
  assert.equal(out.client_metadata.other, "1");
  assert.equal(out.tools[0].name, "dsh_read_file");
  assert.equal(out.stream, true);
});

test("normalizeInput normalizes DSH items and leaves the rest alone", () => {
  const bare = { type: "message", role: "user", content: [{ type: "input_text", text: "x" }] };
  const kept = { type: "message", id: USER_MSG_ID, role: "user", content: [] };
  const call = { type: "function_call", call_id: "c1", name: "f", arguments: "{}" };
  // Exactly what DSH sends: no `type`, no `id`.
  const dsh = { role: "user", content: [{ type: "input_text", text: "hello" }] };
  const [a, b, c, d] = normalizeInput([bare, kept, call, dsh]);
  assert.match(a.id, /^msg_[0-9a-f]{32}$/);
  assert.equal(a.content[0].text, "x");
  assert.equal(b.id, USER_MSG_ID);
  assert.deepEqual(c, call, "non-message items pass through untouched");
  assert.equal(d.type, "message", "a DSH role/content item gains its type");
  assert.match(d.id, /^msg_[0-9a-f]{32}$/);
  assert.equal(d.content[0].text, "hello");
  assert.equal(normalizeInput([]).length, 0);
});

test("liftSystemMessages moves system items into instructions text", () => {
  const sys = { type: "message", role: "system", content: "You are a coding agent." };
  const parts = {
    type: "message",
    role: "system",
    content: [{ type: "text", text: "part A" }, { type: "text", text: "part B" }],
  };
  const user = { type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] };
  const { input, systemText } = liftSystemMessages([sys, user, parts]);
  assert.deepEqual(input, [user]);
  assert.equal(systemText, "You are a coding agent.\n\npart A\npart B");
});

test("adaptRequestBody lifts DSH's system message into instructions", () => {
  // DSH's real shape: a system item first, then user items, none typed or identified.
  const out = adaptRequestBody(
    {
      model: DEFAULT_MODELS[0],
      input: [
        { role: "system", content: "SYS" },
        { role: "user", content: [{ type: "input_text", text: "hi" }] },
      ],
    },
    { cwd: CWD, ...IDS },
  );
  assert.equal(out.instructions, "SYS");
  assert.equal(out.input.some((i) => i.role === "system"), false, "no system item survives in input");
  assert.equal(out.input[0].role, "user");
  assert.doesNotMatch(JSON.stringify(out.input), /environment_context/);
  assert.equal(out.input[0].internal_chat_message_metadata_passthrough.turn_id, IDS.turnId);
});

test("server preserves upstream failures without inventing a diagnosis", async (t) => {
  const raw = 'event: response.failed\ndata: {"type":"response.failed","response":{"error":{"message":"ChatGPT stopped responding after the task started. locator.click: Timeout 3000ms exceeded."}}}\n\n';
  const bridge = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/event-stream" });
    // Split inside a former annotation signature: chunking must not affect output.
    res.write(raw.slice(0, 110));
    res.end(raw.slice(110));
  });
  bridge.listen(0, "127.0.0.1");
  await once(bridge, "listening");
  const shim = createServer({ bridgeUrl: `http://127.0.0.1:${bridge.address().port}`, cwd: CWD, models: [...DEFAULT_MODELS] });
  shim.listen(0, "127.0.0.1");
  await once(shim, "listening");
  t.after(() => { shim.close(); bridge.close(); });
  const reply = await fetch(`http://127.0.0.1:${shim.address().port}/v1/responses`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(dshRequest()),
  });
  assert.equal(reply.status, 200);
  assert.equal(await reply.text(), raw);
});

test("adaptRequestBody rejects models the bridge does not publish", () => {
  assert.throws(() => adaptRequestBody(dshRequest({ model: "gpt-5.6-sol" }), { cwd: CWD, ...IDS }), /unknown model/);
  assert.equal(isKnownModel(DEFAULT_MODELS[0]), true);
  assert.equal(isKnownModel("chatgpt-web/nope"), false);
});

test("resolveWorkspaceCwd accepts inside-roots paths and refuses the rest", () => {
  const roots = ["/tmp/ws"];
  assert.equal(resolveWorkspaceCwd("/tmp/ws", roots, "/tmp/ws"), "/tmp/ws");
  assert.equal(resolveWorkspaceCwd("/tmp/ws/sub", roots, "/tmp/ws"), "/tmp/ws/sub");
  assert.equal(resolveWorkspaceCwd(null, roots, "/tmp/ws"), "/tmp/ws");
  assert.equal(resolveWorkspaceCwd("/tmp/ws/", ["/tmp/ws/"], "/tmp/ws"), "/tmp/ws/");
  assert.throws(() => resolveWorkspaceCwd("/etc", roots, "/tmp/ws"), /outside allowed roots/);
  assert.throws(() => resolveWorkspaceCwd("/tmp/ws-evil", roots, "/tmp/ws"), /outside allowed roots/);
});

test("model payload exposes the catalog and no credentials", () => {
  const payload = buildModelsPayload();
  assert.equal(payload.object, "list");
  assert.deepEqual(payload.data.map((m) => m.id), [...DEFAULT_MODELS]);
  const text = JSON.stringify(payload).toLowerCase();
  for (const secret of ["token", "cookie", "secret", "apikey", "api_key", "bearer"]) {
    assert.ok(!text.includes(secret), `model payload must not contain ${secret}`);
  }
});

test("loadConfig defaults to the local bridge and the process workspace", () => {
  const cfg = loadConfig({ DSH_WORKSPACE: "/w" });
  assert.equal(cfg.bridgeUrl, "http://127.0.0.1:17841");
  assert.equal(cfg.port, 17842);
  assert.equal(cfg.cwd, "/w");
  assert.deepEqual(cfg.allowedRoots, ["/w"]);
  assert.equal(cfg.mode, "browser-only", "the verified mode is the default");
  const custom = loadConfig({ CGW_BRIDGE_URL: "http://h:1/", CGW_SHIM_PORT: "9", CGW_CWD: "/a", CGW_ALLOWED_ROOTS: "/a:/b", CGW_MODELS: "chatgpt-web/x, chatgpt-web/y" });
  assert.equal(custom.port, 9);
  assert.deepEqual(custom.allowedRoots, ["/a", "/b"]);
  assert.deepEqual(custom.models, ["chatgpt-web/x", "chatgpt-web/y"]);
  assert.equal(loadConfig({ CGW_BRIDGE_MODE: "full" }).mode, "full");
});

test("loadConfig rejects a mode the bridge cannot have", () => {
  assert.throws(() => loadConfig({ CGW_BRIDGE_MODE: "half" }), /invalid CGW_BRIDGE_MODE/);
});

test("server reuses prompt_cache_key as the bridge thread id", async (t) => {
  const seen = [];
  const bridge = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    seen.push(JSON.parse(Buffer.concat(chunks).toString()));
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.end("data: [DONE]\n\n");
  });
  bridge.listen(0, "127.0.0.1");
  await once(bridge, "listening");
  const shim = createServer({ bridgeUrl: `http://127.0.0.1:${bridge.address().port}`, cwd: CWD, models: [...DEFAULT_MODELS] });
  shim.listen(0, "127.0.0.1");
  await once(shim, "listening");
  t.after(() => { shim.close(); bridge.close(); });

  const post = () => fetch(`http://127.0.0.1:${shim.address().port}/v1/responses`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify(dshRequest({ prompt_cache_key: "pcache-session-1" })),
  }).then((r) => r.text());
  await post();
  await post();
  const threads = seen.map((b) => JSON.parse(b.client_metadata["x-codex-turn-metadata"]).thread_id);
  const turns = seen.map((b) => JSON.parse(b.client_metadata["x-codex-turn-metadata"]).turn_id);
  assert.deepEqual(threads, ["pcache-session-1", "pcache-session-1"], "one thread per session");
  assert.notEqual(turns[0], turns[1], "each HTTP turn gets its own turn id");
});

test("server forwards an adapted turn to the bridge and streams the reply back", async (t) => {
  let captured;
  const bridge = http.createServer(async (req, res) => {
    captured = JSON.parse((await once(req, "data"))[0].toString());
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write('event: response.output_item.done\ndata: {"type":"response.output_item.done"}\n\n');
    res.end("data: [DONE]\n\n");
  });
  bridge.listen(0, "127.0.0.1");
  await once(bridge, "listening");

  const shim = createServer({ bridgeUrl: `http://127.0.0.1:${bridge.address().port}`, cwd: CWD, models: [...DEFAULT_MODELS] });
  shim.listen(0, "127.0.0.1");
  await once(shim, "listening");
  t.after(() => {
    shim.close();
    bridge.close();
  });
  const base = `http://127.0.0.1:${shim.address().port}`;

  const reply = await fetch(`${base}/v1/responses`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(dshRequest()),
  });
  assert.equal(reply.status, 200);
  const text = await reply.text();
  assert.ok(text.includes("response.output_item.done"));
  assert.ok(text.trimEnd().endsWith("data: [DONE]"));

  assert.doesNotMatch(JSON.stringify(captured.input), /environment_context/, "browser-only default injects no envelope");
  const metaTurn = JSON.parse(captured.client_metadata["x-codex-turn-metadata"]).turn_id;
  assert.equal(captured.input.at(-1).internal_chat_message_metadata_passthrough.turn_id, metaTurn);

  const models = await fetch(`${base}/v1/models`).then((r) => r.json());
  assert.deepEqual(models.data.map((m) => m.id), [...DEFAULT_MODELS]);
  const health = await fetch(`${base}/healthz`).then((r) => r.json());
  assert.equal(health.service, "dsh-chatgpt-shim");
  const missing = await fetch(`${base}/v1/nope`);
  assert.equal(missing.status, 404);
});

test("server rejects an unknown model without calling the bridge", async (t) => {
  let called = false;
  const bridge = http.createServer((_req, res) => {
    called = true;
    res.end();
  });
  bridge.listen(0, "127.0.0.1");
  await once(bridge, "listening");
  const shim = createServer({ bridgeUrl: `http://127.0.0.1:${bridge.address().port}`, cwd: CWD, models: [...DEFAULT_MODELS] });
  shim.listen(0, "127.0.0.1");
  await once(shim, "listening");
  t.after(() => {
    shim.close();
    bridge.close();
  });

  const reply = await fetch(`http://127.0.0.1:${shim.address().port}/v1/responses`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(dshRequest({ model: "bogus" })),
  });
  assert.equal(reply.status, 400);
  assert.match((await reply.json()).error.message, /unknown model/);
  assert.equal(called, false);
});

test("server reports a clear error when the bridge is down", async (t) => {
  const dead = http.createServer();
  dead.listen(0, "127.0.0.1");
  await once(dead, "listening");
  const port = dead.address().port;
  dead.close();
  await once(dead, "close");

  const shim = createServer({ bridgeUrl: `http://127.0.0.1:${port}`, cwd: CWD, models: [...DEFAULT_MODELS] });
  shim.listen(0, "127.0.0.1");
  await once(shim, "listening");
  t.after(() => shim.close());

  const reply = await fetch(`http://127.0.0.1:${shim.address().port}/v1/responses`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(dshRequest()),
  });
  assert.equal(reply.status, 502);
  assert.match((await reply.json()).error.message, /bridge unreachable/);
});

test("listModels reports the bridge owner for every entry", () => {
  for (const m of listModels()) {
    assert.equal(m.object, "model");
    assert.equal(m.owned_by, "codex-chatgpt-web");
  }
});
