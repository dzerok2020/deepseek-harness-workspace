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

// Match DSH's ToolExecution and post-execute waterfall contracts.
function makeExec({ tool = "write", arguments: toolArgs = {}, agent = {} } = {}) {
  return { name: tool, arguments: toolArgs, agent };
}

function runPostExecute(handler, exec, result = { isError: false, value: null, content: [] }, decision = { kind: "accept" }) {
  return handler(exec, result, async () => decision);
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

for (const tool of ["write", "edit"]) {
  test(`must-change: canonical ${tool} arguments require sentinels`, async () => {
    const ctx = makeCtx();
    apply(ctx, {});
    const steered = [];
    const agent = makeAgent(steered);
    const post = ctx.handlers.get("tools/post-execute");
    const stop = ctx.handlers.get("agent/turn-stopping");
    const toolArgs = tool === "write"
      ? { file_path: "safe-not-written.txt", content: "not executed" }
      : { file_path: "safe-not-edited.txt", old_string: "before", new_string: "after" };

    await runPostExecute(post, makeExec({ tool, arguments: toolArgs, agent }));
    await stop({ agent });

    assert.equal(steered.length, 1);
    const text = steered[0].content[0].text;
    assert.match(text, /^EVAL GATE:/);
    assert.match(text, /changed files: 1/);
    assert.match(text, /missing must-change sentinel/);
    assert.match(text, /missing must-keep sentinel/);
  });
}

test("shipping both sentinels in the test output clears the gate", async () => {
  const ctx = makeCtx();
  apply(ctx, {});
  const steered = [];
  const agent = makeAgent(steered);
  const post = ctx.handlers.get("tools/post-execute");
  const stop = ctx.handlers.get("agent/turn-stopping");

  await runPostExecute(post, makeExec({ tool: "edit", arguments: { file_path: "lib/a.js" }, agent }));
  await runPostExecute(
    post,
    makeExec({ tool: "bash", agent }),
    {
      isError: false,
      value: null,
      content: [
        { type: "text", text: "must-change: rejects blank path | pass" },
        { type: "text", text: "must-keep: keeps legacy path | pass" },
      ],
    },
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

  await runPostExecute(post, makeExec({ tool: "write", arguments: { file_path: "lib/a.js" }, agent }));
  await runPostExecute(
    post,
    makeExec({ tool: "bash", agent }),
    {
      isError: true,
      error: { message: "sentinel run failed" },
      content: [
        { type: "text", text: "must-change: rejects blank path | FAIL" },
        { type: "text", text: "must-keep: keeps legacy path | pass" },
      ],
    },
  );
  await stop({ agent });

  assert.equal(steered.length, 1);
  assert.match(steered[0].content[0].text, /missing must-change sentinel/);
});

for (const field of ["sentinel", "intent"]) {
  test(`must-change: declared ${field} comes from canonical arguments`, async () => {
    const ctx = makeCtx();
    apply(ctx, {});
    const steered = [];
    const agent = makeAgent(steered);
    const post = ctx.handlers.get("tools/post-execute");
    const stop = ctx.handlers.get("agent/turn-stopping");

    await runPostExecute(post, makeExec({ arguments: { file_path: "lib/a.js" }, agent }));
    await runPostExecute(
      post,
      makeExec({ tool: "bash", arguments: { [field]: "must-change" }, agent }),
      { isError: false, value: null, content: [{ type: "text", text: "must-keep: declared as must-change" }] },
    );
    await stop({ agent });

    assert.equal(steered.length, 1);
    const text = steered[0].content[0].text;
    assert.match(text, /missing must-keep sentinel/);
    assert.doesNotMatch(text, /missing must-change sentinel/);
  });
}

test("must-keep: malformed or absent canonical paths do not create changes or use args", async () => {
  const ctx = makeCtx();
  apply(ctx, {});
  const steered = [];
  const agent = makeAgent(steered);
  const post = ctx.handlers.get("tools/post-execute");
  const stop = ctx.handlers.get("agent/turn-stopping");

  for (const toolArgs of [undefined, null, "bad", {}, { file_path: null }, { file_path: 7 }, { file_path: "" }, { file_path: "  " }]) {
    await runPostExecute(post, {
      name: "write",
      arguments: toolArgs,
      args: { file_path: "not-canonical.txt" },
      agent,
    });
  }
  await runPostExecute(post, null);
  await stop({ agent });

  assert.equal(steered.length, 0);
});

test("must-keep: post-execute preserves the downstream decision", async () => {
  const ctx = makeCtx();
  apply(ctx, {});
  const post = ctx.handlers.get("tools/post-execute");
  for (const decision of [{ kind: "accept" }, { kind: "block", feedback: [{ type: "text", text: "blocked" }] }]) {
    assert.equal(await runPostExecute(post, makeExec({ tool: "read" }), undefined, decision), decision);
  }
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
  await runPostExecute(post, makeExec({ tool: "write", arguments: { file_path: "lib/a.js" }, agent: dirty }));

  await stop({ agent: dirty });
  await stop({ agent: clean });

  assert.equal(steeredDirty.length, 1, "the agent that edited still owes sentinels");
  assert.equal(steeredClean.length, 0, "a different agent never saw the edit");
});
