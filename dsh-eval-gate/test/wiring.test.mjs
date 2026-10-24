import test from "node:test";
import assert from "node:assert/strict";

import { apply, inject, name } from "../lib/index.js";

function makeCtx() {
  const handlers = new Map();
  return {
    handlers,
    on(event, fn) {
      handlers.set(event, fn);
    },
  };
}

function makeExec({ tool = "write", args = {}, agent = {}, result = {} } = {}) {
  return { name: tool, args, agent, result };
}

function runPostExecute(handler, exec, result = { ok: true }) {
  return handler(exec, result, async () => result);
}

// An agent whose `steer` records the messages it receives. The SAME object must
// be handed to every seam, because the plugin keys its per-agent state off it.
function makeAgent(sink) {
  return { steer: (m) => sink.push(m) };
}

test("plugin exports the bundle contract", () => {
  assert.equal(name, "dsh-eval-gate");
  assert.deepEqual(inject, ["tools"]);
  assert.equal(typeof apply, "function");
});

test("apply registers both seams and honours the kill switch", () => {
  const ctx = makeCtx();
  apply(ctx, {});
  assert.equal(typeof ctx.handlers.get("tools/post-execute"), "function");
  assert.equal(typeof ctx.handlers.get("agent/turn-stopping"), "function");

  const offCtx = makeCtx();
  apply(offCtx, { enabled: false });
  assert.equal(offCtx.handlers.size, 0);
});

test("a write with no sentinels makes the gate steer the agent", async () => {
  const ctx = makeCtx();
  apply(ctx, {});
  const steered = [];
  const agent = makeAgent(steered);
  const post = ctx.handlers.get("tools/post-execute");
  const stop = ctx.handlers.get("agent/turn-stopping");

  await runPostExecute(post, makeExec({ tool: "write", args: { path: "lib/a.js" }, agent }), { ok: true });
  await stop({ agent });

  assert.equal(steered.length, 1);
  const text = steered[0].content[0].text;
  assert.match(text, /^EVAL GATE:/);
  assert.match(text, /missing must-change sentinel/);
  assert.match(text, /missing must-keep sentinel/);
});

test("shipping both sentinels in the test output clears the gate", async () => {
  const ctx = makeCtx();
  apply(ctx, {});
  const steered = [];
  const agent = makeAgent(steered);
  const post = ctx.handlers.get("tools/post-execute");
  const stop = ctx.handlers.get("agent/turn-stopping");

  await runPostExecute(post, makeExec({ tool: "edit", args: { file_path: "lib/a.js" }, agent }), { ok: true });
  await runPostExecute(
    post,
    makeExec({ tool: "bash", args: {}, agent }),
    { ok: true, output: "must-change: rejects blank path | pass\nmust-keep: keeps legacy path | pass" },
  );
  await stop({ agent });

  assert.equal(steered.length, 0, "both sentinels present => no steer");
});

test("a failing sentinel run does not count as proof", async () => {
  const ctx = makeCtx();
  apply(ctx, {});
  const steered = [];
  const agent = makeAgent(steered);
  const post = ctx.handlers.get("tools/post-execute");
  const stop = ctx.handlers.get("agent/turn-stopping");

  await runPostExecute(post, makeExec({ tool: "write", args: { path: "lib/a.js" }, agent }), { ok: true });
  await runPostExecute(
    post,
    makeExec({ tool: "bash", args: {}, agent }),
    { ok: false, output: "must-change: rejects blank path | FAIL\nmust-keep: keeps legacy path | pass" },
  );
  await stop({ agent });

  assert.equal(steered.length, 1);
  assert.match(steered[0].content[0].text, /missing must-change sentinel/);
});

test("the read-only turn passes untouched and resets state", async () => {
  const ctx = makeCtx();
  apply(ctx, {});
  const stop = ctx.handlers.get("agent/turn-stopping");

  const steered = [];
  await stop({ agent: makeAgent(steered) });
  assert.equal(steered.length, 0);
});

test("per-agent state does not leak across agents", async () => {
  const ctx = makeCtx();
  apply(ctx, {});
  const post = ctx.handlers.get("tools/post-execute");
  const stop = ctx.handlers.get("agent/turn-stopping");

  const steeredDirty = [];
  const steeredClean = [];
  const dirty = makeAgent(steeredDirty);
  const clean = makeAgent(steeredClean);
  await runPostExecute(post, makeExec({ tool: "write", args: { path: "lib/a.js" }, agent: dirty }), { ok: true });

  await stop({ agent: dirty });
  await stop({ agent: clean });

  assert.equal(steeredDirty.length, 1, "the agent that edited still owes sentinels");
  assert.equal(steeredClean.length, 0, "a different agent never saw the edit");
});
