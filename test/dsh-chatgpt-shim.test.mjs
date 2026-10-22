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
  withEnvironmentContext,
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

test("replayed DSH history without message ids preserves canonical instruction lineage", () => {
  const input = [
    { role: "user", content: "first instruction" },
    { role: "assistant", content: "first answer" },
    { role: "user", content: "next instruction" },
  ];
  const first = normalizeInput(input);
  const replay = normalizeInput(JSON.parse(JSON.stringify(input)));
  assert.deepEqual(replay, first, "replay must not look like a different instruction");
  assert.deepEqual(normalizeInput([...input, { role: "assistant", content: "next answer" }]).slice(0, 3), first);
  assert.notEqual(normalizeInput([{ role: "user", content: "changed" }])[0].id, first[0].id);
  const repeated = normalizeInput([{ role: "user", content: "same" }, { role: "user", content: "same" }]);
  assert.notEqual(repeated[0].id, repeated[1].id, "distinct occurrences must not collapse");
  assert.deepEqual(input.map(item => item.id), [undefined, undefined, undefined], "caller data remains unchanged");
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

test("full mode places the trusted environment envelope before the current user message", () => {
  // Real DSH shape: a system item first, then user items sorted last-to-first
  // (DSH orders items this way), none typed or identified.
  const body = dshRequest({
    input: [
      { role: "system", content: "SYS" },
      { type: "message", id: USER_MSG_ID, role: "user", content: [{ type: "input_text", text: "hello" }] },
    ],
  });
  const out = adaptRequestBody(body, { cwd: CWD, ...IDS, mode: "full" });

  const envIndex = out.input.findIndex((item) => item.id?.startsWith("msg_environment_"));
  assert.equal(envIndex, 0, "the envelope precedes the only user message");
  const env = out.input[envIndex];
  assert.equal(env.type, "message");
  assert.equal(env.role, "user");
  assert.match(env.id, /^msg_environment_[0-9a-f]{32}$/);
  assert.ok(env.content[0].text.startsWith("<environment_context>"));
  assert.equal(env.internal_chat_message_metadata_passthrough.turn_id, IDS.turnId);
  assert.equal(out.input.length, 2, "env + user message; the system item moved to instructions");
  assert.equal(out.input[1].id, USER_MSG_ID, "the current user message follows the envelope");
  assert.equal(out.instructions, "SYS");
});

test("full mode puts the environment envelope before the LAST user, not the head", () => {
  // Journal-activated serve scans backwards from the current turn's user
  // message; a head-placed envelope leaves replayed history "missing cwd".
  const history = [
    { type: "message", id: "msg_11111111111111111111111111111111", role: "user", content: [{ type: "input_text", text: "first" }] },
    { type: "message", id: "msg_22222222222222222222222222222222", role: "assistant", content: [{ type: "output_text", text: "noted" }] },
    { type: "message", id: USER_MSG_ID, role: "user", content: [{ type: "input_text", text: "second" }] },
  ];
  const out = adaptRequestBody(dshRequest({ input: structuredClone(history) }), { cwd: CWD, ...IDS, mode: "full" });
  const envIndex = out.input.findIndex((item) => item.id?.startsWith("msg_environment_"));
  assert.ok(envIndex > 0, "envelope must not sit at the head of replayed history");
  assert.equal(out.input[envIndex + 1].content[0].text, "second", "envelope must immediately precede the current user message");
  assert.deepEqual(out.input.filter((item) => !item.id?.startsWith("msg_environment_")), history, "replayed history passes through unchanged");
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
  assert.deepEqual(threads, ["dsh-pcache-session-1", "dsh-pcache-session-1"], "one thread per session");
  assert.notEqual(turns[0], turns[1], "each HTTP turn gets its own turn id");
});

// Regression: the bridge rejects metadata where exactly one of thread_id /
// turn_id looks like a native Codex id (a bare RFC-4122 UUID). DSH's
// prompt_cache_key IS such a UUID on real sessions — this failed live on
// 2026-10-17 with "Codex thread metadata contains an invalid native identifier".
test("server keeps UUID-shaped prompt_cache_key ids non-native for the bridge", async (t) => {
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

  const uuidKey = "2bcf950d-42ff-4db6-93be-9d1ec8b5c972";
  const res = await fetch(`http://127.0.0.1:${shim.address().port}/v1/responses`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify(dshRequest({ prompt_cache_key: uuidKey })),
  });
  await res.text();
  const meta = JSON.parse(seen[0].client_metadata["x-codex-turn-metadata"]);
  const native = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  assert.equal(native.test(meta.thread_id), false, "thread_id must not look native");
  assert.equal(native.test(meta.turn_id), false, "turn_id must not look native");
  assert.equal(meta.thread_id, `dsh-${uuidKey}`, "session key still maps to one stable thread");
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

// Regression: DSH's system prompt is a system-role item whose type is only set
// by normalizeInput. The envelope scan used to require `item.type === "message"`
// on its own, so a system item made it miss the user — and the `last === -1`
// fallback then pushed the envelope to the HEAD of the history. Live on
// 2026-10-22 the bridge (CGW_BRIDGE_MODE=full) rejected every DSH turn with
// "ChatGPT web turn is missing cwd in trusted Codex environment context" — the
// reported failure.
test("full mode still finds the current user when a system item precedes it", () => {
  const out = withEnvironmentContext(
    normalizeInput([
      { role: "system", content: "SYS" },
      { role: "user", content: [{ type: "input_text", text: "hello" }] },
    ]),
    CWD,
    "turn_1",
  );

  assert.equal(out.length, 3, "system + env + user");
  assert.equal(out.findIndex((i) => i.id?.startsWith("msg_environment_")), 1, "the envelope sits right before the user");
  assert.ok(out[1].content[0].text.includes(`<cwd>${CWD}</cwd>`));
  assert.equal(out.at(-1).role, "user", "the envelope must not be pushed past the current user message");
  assert.equal(out.at(-1).content[0].text, "hello");
});

test("full mode finds the last user even when items carry no type at all", () => {
  const out = withEnvironmentContext(
    [
      { role: "system", content: "SYS" },
      { role: "user", content: [{ type: "input_text", text: "ambient" }] },
      { role: "user", content: [{ type: "input_text", text: "current" }] },
    ],
    CWD,
    "turn_1",
  );

  const envIndex = out.findIndex((item) => item.id?.startsWith("msg_environment_"));
  assert.equal(envIndex, 2, "the envelope belongs directly before the LAST untyped user item");
  assert.equal(out.at(-1).content[0].text, "current");
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

test("generated ids survive history truncation after compaction", () => {
  const history = [
    { type: "message", role: "system", content: [{ type: "input_text", text: "SYS" }] },
    { type: "message", role: "user", content: [{ type: "input_text", text: "first turn" }] },
    { type: "message", role: "assistant", content: [{ type: "output_text", text: "first reply" }] },
    { type: "message", role: "user", content: [{ type: "input_text", text: "current turn" }] },
  ];
  const full = normalizeInput(history);
  const byContent = new Map(full.map((m) => [JSON.stringify(m.content), m.id]));
  const truncated = normalizeInput(history.slice(1));
  for (const m of truncated) {
    assert.equal(
      m.id,
      byContent.get(JSON.stringify(m.content)),
      "an id must not change when older messages are dropped",
    );
  }
});

test("server routes a compaction request onto its own bridge thread", async (t) => {
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
  const shim = createServer({
    bridgeUrl: `http://127.0.0.1:${bridge.address().port}`,
    cwd: CWD,
    models: [...DEFAULT_MODELS],
  });
  shim.listen(0, "127.0.0.1");
  await once(shim, "listening");
  t.after(() => {
    shim.close();
    bridge.close();
  });
  const post = (input) =>
    fetch(`http://127.0.0.1:${shim.address().port}/v1/responses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(dshRequest({ prompt_cache_key: "pcache-r2", input })),
    }).then((r) => r.text());
  const userTurn = [{ type: "message", id: USER_MSG_ID, role: "user", content: [{ type: "input_text", text: "hello" }] }];
  const compactionTurn = [
    { type: "message", id: USER_MSG_ID, role: "user", content: [{ type: "input_text", text: "hello" }] },
    { type: "message", role: "assistant", content: [{ type: "output_text", text: "hi" }] },
    {
      type: "message",
      role: "user",
      content: [
        {
          type: "input_text",
          text: "You are now acting as a compaction engine for this AI coding assistant. Condense the conversation ABOVE into a structured checkpoint that lets another model resume the work with no loss of essential context.",
        },
      ],
    },
  ];
  await post(userTurn);
  await post(compactionTurn);
  const threads = seen.map((b) => JSON.parse(b.client_metadata["x-codex-turn-metadata"]).thread_id);
  assert.deepEqual(
    threads,
    ["dsh-pcache-r2", "dsh-pcache-r2-compaction"],
    "a background compaction prompt must not share the live user thread",
  );
});
