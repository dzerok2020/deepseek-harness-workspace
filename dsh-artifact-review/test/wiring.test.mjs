import { test } from 'node:test';
import assert from 'node:assert/strict';

import { apply } from '../lib/index.js';

/** Minimal stand-in for the DSH ctx object: just records handlers by event. */
function makeCtx() {
  const handlers = new Map();
  return {
    handlers,
    on(event, fn) {
      handlers.set(event, fn);
    },
  };
}

/** Build the argument shape DSH passes to tools/post-execute. */
function makeExec({ tool = 'read_image', args = {}, agent = {}, output } = {}) {
  const exec = { name: tool, args, agent };
  if (output !== undefined) exec.result = { ok: true, output };
  return exec;
}

/** Setup ctx + apply(), return the two handlers. */
function wire(config) {
  const ctx = makeCtx();
  apply(ctx, config);
  return {
    ctx,
    postExecute: ctx.handlers.get('tools/post-execute'),
    turnStopping: ctx.handlers.get('agent/turn-stopping'),
  };
}

/** A fake agent that records every steer() payload. */
function makeAgent(sink) {
  return {
    steer(message) {
      sink.push(message);
    },
  };
}

const passthrough = async () => ({ ok: true });

test('plugin registers both hooks', () => {
  const { postExecute, turnStopping } = wire({});
  assert.equal(typeof postExecute, 'function');
  assert.equal(typeof turnStopping, 'function');
});

test('a turn with no render is left alone', async () => {
  const steered = [];
  const steeredAgent = makeAgent(steered);
  const { postExecute, turnStopping } = wire({});

  await postExecute(makeExec({ tool: 'bash', agent: steeredAgent }), { ok: true }, passthrough);
  await turnStopping({ agent: steeredAgent });

  assert.equal(steered.length, 0);
});

test('render then stop without looking makes the gate steer the agent', async () => {
  const steered = [];
  const agent = makeAgent(steered);
  const { postExecute, turnStopping } = wire({});

  await postExecute(makeExec({ tool: 'render_artifact', agent }), { ok: true }, passthrough);
  await turnStopping({ agent });

  assert.equal(steered.length, 1, 'expected exactly one nudge');
  const text = steered[0].content[0].text;
  assert.match(text, /Artifact review round 0: blind \(propogser accepted without a review pass\)\./);
});

test('render, look and see nothing blocking → no nudge', async () => {
  const steered = [];
  const agent = makeAgent(steered);
  const { postExecute, turnStopping } = wire({});

  await postExecute(makeExec({ tool: 'render_artifact', agent }), { ok: true }, passthrough);
  await postExecute(
    makeExec({ tool: 'read_image', agent, output: 'page 1 | contrast | minor | grey on grey' }),
    { ok: true, output: 'page 1 | contrast | minor | grey on grey' },
    passthrough,
  );
  await turnStopping({ agent });

  assert.equal(steered.length, 0);
});

test('a blocking finding found by the vision pass forces a rework nudge', async () => {
  const steered = [];
  const agent = makeAgent(steered);
  const { postExecute, turnStopping } = wire({});

  await postExecute(makeExec({ tool: 'render_artifact', agent }), { ok: true }, passthrough);
  const visionOutput = 'page 2 | overflow | blocking | right column clipped';
  await postExecute(
    makeExec({ tool: 'read_image', agent, output: visionOutput }),
    { ok: true, output: visionOutput },
    passthrough,
  );
  await turnStopping({ agent });

  assert.equal(steered.length, 1);
  const text = steered[0].content[0].text;
  assert.match(text, /Artifact review round 1: rework \(1 blocking finding\(s\)\)\./);
  assert.match(text, /- page 2 · overflow · blocking — right column clipped/);
});

test('reading the payload from output (not content) is what makes findings visible', async () => {
  // Regression for the G4 defect: if textOf ignored `output`, no finding would
  // ever be parsed and the gate would silently accept a blind review.
  const steered = [];
  const agent = makeAgent(steered);
  const { postExecute, turnStopping } = wire({});

  await postExecute(makeExec({ tool: 'render', agent }), { ok: true }, passthrough);
  await postExecute(
    { name: 'read_image', args: {}, agent, result: { output: 'page 9 | truncation | blocking | title cut' } },
    { ok: true, content: [{ type: 'tool_result', output: 'page 9 | truncation | blocking | title cut' }] },
    passthrough,
  );
  await turnStopping({ agent });

  assert.equal(steered.length, 1);
  assert.match(steered[0].content[0].text, /page 9 · truncation · blocking/);
});

test('the round ceiling stops the ping-pong instead of looping forever', async () => {
  const steered = [];
  const agent = makeAgent(steered);
  const { postExecute, turnStopping } = wire({ maxRounds: 2 });

  for (let round = 0; round < 4; round += 1) {
    await postExecute(makeExec({ tool: 'render_artifact', agent }), { ok: true }, passthrough);
    await postExecute(
      makeExec({ tool: 'read_image', agent, output: 'page 1 | layout | major | overlapping' }),
      { ok: true },
      passthrough,
    );
    await turnStopping({ agent });
  }

  // Round 1 → rework, round 2 → ceiling reached → give up (no third nudge).
  assert.equal(steered.length, 2);
});

test('a failed vision call does not count as looking', async () => {
  const steered = [];
  const agent = makeAgent(steered);
  const { postExecute, turnStopping } = wire({});

  await postExecute(makeExec({ tool: 'render_artifact', agent }), { ok: true }, passthrough);
  await postExecute(makeExec({ tool: 'read_image', agent }), { ok: false, isError: true }, passthrough);
  await turnStopping({ agent });

  assert.equal(steered.length, 1);
  assert.match(steered[0].content[0].text, /blind/);
});

test('per-agent state does not leak across agents', async () => {
  const steeredA = [];
  const steeredB = [];
  const agentA = makeAgent(steeredA);
  const agentB = makeAgent(steeredB);
  const { postExecute, turnStopping } = wire({});

  await postExecute(makeExec({ tool: 'render_artifact', agent: agentA }), { ok: true }, passthrough);
  await postExecute(
    makeExec({ tool: 'read_image', agent: agentA, output: 'page 1 | contrast | minor | low' }),
    { ok: true },
    passthrough,
  );

  // B rendered nothing at all → untouched even though A looked.
  await turnStopping({ agent: agentB });
  assert.equal(steeredB.length, 0);

  // A looked and saw nothing blocking → also untouched.
  await turnStopping({ agent: agentA });
  assert.equal(steeredA.length, 0);
});

test('after accept the turn state resets so the next turn starts clean', async () => {
  const steered = [];
  const agent = makeAgent(steered);
  const { postExecute, turnStopping } = wire({});

  await postExecute(makeExec({ tool: 'render_artifact', agent }), { ok: true }, passthrough);
  await postExecute(makeExec({ tool: 'read_image', agent }), { ok: true }, passthrough);
  await turnStopping({ agent });
  assert.equal(steered.length, 0);

  // Next turn renders again and never looks → blind again from round 0.
  await postExecute(makeExec({ tool: 'render_artifact', agent }), { ok: true }, passthrough);
  await turnStopping({ agent });
  assert.equal(steered.length, 1);
  assert.match(steered[0].content[0].text, /round 0: blind/);
});

test('enabled:false makes the plugin inert', async () => {
  const steered = [];
  const agent = makeAgent(steered);
  const { postExecute, turnStopping } = wire({ enabled: false });

  assert.equal(postExecute, undefined);
  assert.equal(turnStopping, undefined);
  assert.equal(steered.length, 0);
});
