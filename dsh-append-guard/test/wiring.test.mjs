import { test } from 'node:test';
import assert from 'node:assert/strict';

import { apply, name as pluginName, inject } from '../lib/index.js';

const passthrough = async () => ({ ok: true });

function memoryResult(ids) {
  return { output: JSON.stringify({ entries: ids.map((id) => ({ id })) }) };
}

function makeCtx() {
  const handlers = new Map();
  return {
    handlers,
    on(event, fn) {
      handlers.set(event, fn);
    },
  };
}

function makeExec({ tool = 'memory_remember', args = {}, agent = {}, result } = {}) {
  return { name: tool, toolName: tool, arguments: args, agent, result };
}

function wire(config) {
  const ctx = makeCtx();
  apply(ctx, config);
  const postExecute = ctx.handlers.get('tools/post-execute');
  const turnStopping = ctx.handlers.get('agent/turn-stopping');
  assert.equal(typeof postExecute, 'function', 'post-execute hook registered');
  assert.equal(typeof turnStopping, 'function', 'turn-stopping hook registered');
  return { ctx, postExecute, turnStopping };
}

function makeAgent(sink) {
  const agent = {};
  agent.steer = (message) => {
    sink.push(message);
  };
  return agent;
}

test('plugin declares its name and tool injection', () => {
  assert.equal(pluginName, 'dsh-append-guard');
  assert.deepEqual([...inject], ['tools']);
});

test('apply registers both seams', () => {
  const { ctx } = wire({});
  assert.ok(ctx.handlers.has('tools/post-execute'));
  assert.ok(ctx.handlers.has('agent/turn-stopping'));
});

test('a pure append keeps the turn quiet', async () => {
  const steered = [];
  const agent = makeAgent(steered);
  const { postExecute, turnStopping } = wire({});

  await postExecute(makeExec({ agent, result: { output: JSON.stringify({ entries: [{ id: 'a' }] }) } }), passthrough(), passthrough);
  await postExecute(
    makeExec({ agent, result: { output: JSON.stringify({ entries: [{ id: 'a' }, { id: 'b' }] }) } }),
    passthrough(),
    passthrough,
  );

  await turnStopping({ agent });
  assert.equal(steered.length, 0, 'no nudge for an append-only turn');
});

test('an insert in the middle makes the gate steer the agent', async () => {
  const steered = [];
  const agent = makeAgent(steered);
  const { postExecute, turnStopping } = wire({});

  await postExecute(
    makeExec({ agent, result: { output: JSON.stringify({ entries: [{ id: 'a' }, { id: 'c' }] }) } }),
    passthrough(),
    passthrough,
  );
  await postExecute(
    makeExec({ agent, result: { output: JSON.stringify({ entries: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] }) } }),
    passthrough(),
    passthrough,
  );

  await turnStopping({ agent });
  assert.equal(steered.length, 1);
  const text = steered[0].content[0].text;
  assert.ok(text.includes('memory_remember'));
  assert.ok(text.includes('inserted into the middle'));
});

test('a rewrite is flagged as blocking', async () => {
  const steered = [];
  const agent = makeAgent(steered);
  const { postExecute, turnStopping } = wire({});

  await postExecute(
    makeExec({ agent, result: { output: JSON.stringify({ entries: [{ id: 'a' }, { id: 'b' }] }) } }),
    passthrough(),
    passthrough,
  );
  await postExecute(makeExec({ agent, result: { output: JSON.stringify({ entries: [{ id: 'a' }] }) } }), passthrough(), passthrough);

  const before = await turnStopping({ agent });
  assert.equal(before, undefined);
  assert.equal(steered.length, 1);
  assert.ok(steered[0].content[0].text.includes('rewrote existing memory'));
});

test('canonical exec.arguments append:"intentional" exempts the call', async () => {
  const steered = [];
  const agent = makeAgent(steered);
  const { postExecute, turnStopping } = wire({});

  await postExecute(
    makeExec({ agent, result: { output: JSON.stringify({ entries: [{ id: 'a' }, { id: 'c' }] }) } }),
    passthrough(),
    passthrough,
  );
  await postExecute(
    makeExec({
      agent,
      args: { append: 'intentional' },
      result: { output: JSON.stringify({ entries: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] }) },
    }),
    passthrough(),
    passthrough,
  );

  await turnStopping({ agent });
  assert.equal(steered.length, 0);
});

test('an intentional ToolResult advances the baseline for the next append only', async () => {
  const steered = [];
  const agent = makeAgent(steered);
  const { postExecute, turnStopping } = wire({});

  await postExecute(makeExec({ agent }), memoryResult(['a', 'c']), passthrough);
  await postExecute(
    makeExec({ agent, args: { append: 'intentional' } }),
    memoryResult(['a', 'b', 'c']),
    passthrough,
  );
  await postExecute(makeExec({ agent }), memoryResult(['a', 'b', 'c', 'd']), passthrough);

  await turnStopping({ agent });
  assert.equal(steered.length, 0, 'the third call appends to the accepted intentional snapshot');

  // A quiet turn clears its outline, so observe it again before the later rewrite.
  await postExecute(makeExec({ agent }), memoryResult(['a', 'b', 'c', 'd']), passthrough);
  await postExecute(makeExec({ agent }), memoryResult(['a', 'b', 'c']), passthrough);

  await turnStopping({ agent });
  assert.equal(steered.length, 1, 'a later unmarked rewrite must still nudge');
  assert.ok(steered[0].content[0].text.includes('rewrote existing memory'));
});

test('a first intentional ToolResult establishes the baseline without exempting the next call', async () => {
  const steered = [];
  const agent = makeAgent(steered);
  const { postExecute, turnStopping } = wire({});

  await postExecute(
    makeExec({ agent, args: { append: 'intentional' } }),
    memoryResult(['a', 'b', 'c']),
    passthrough,
  );
  await postExecute(makeExec({ agent }), memoryResult(['a', 'c']), passthrough);

  await turnStopping({ agent });
  assert.equal(steered.length, 1, 'the very next unmarked rewrite must be judged');
  assert.ok(steered[0].content[0].text.includes('rewrote existing memory'));
});

test('a failed intentional ToolResult does not advance the accepted baseline', async () => {
  const steered = [];
  const agent = makeAgent(steered);
  const { postExecute, turnStopping } = wire({});

  await postExecute(makeExec({ agent }), memoryResult(['a', 'c']), passthrough);
  await postExecute(
    makeExec({ agent, args: { append: 'intentional' } }),
    { ...memoryResult(['a', 'b', 'c']), isError: true },
    passthrough,
  );
  await postExecute(makeExec({ agent }), memoryResult(['a', 'c', 'd']), passthrough);

  await turnStopping({ agent });
  assert.equal(steered.length, 0, 'the next append must use the last successful snapshot');
});

test('an intentional ToolResult without an outline keeps the accepted baseline', async () => {
  const steered = [];
  const agent = makeAgent(steered);
  const { postExecute, turnStopping } = wire({});

  await postExecute(makeExec({ agent }), memoryResult(['a', 'c']), passthrough);
  await postExecute(
    makeExec({ agent, args: { append: 'intentional' } }),
    { output: 'ok' },
    passthrough,
  );
  await postExecute(makeExec({ agent }), memoryResult(['a']), passthrough);

  await turnStopping({ agent });
  assert.equal(steered.length, 1, 'a missing outline must not discard the previous snapshot');
  assert.ok(steered[0].content[0].text.includes('rewrote existing memory'));
});

test('legacy exec.args cannot exempt a canonical host call', async () => {
  const steered = [];
  const agent = makeAgent(steered);
  const { postExecute, turnStopping } = wire({});

  await postExecute(
    makeExec({ agent, result: { entries: [{ id: 'a' }, { id: 'c' }] } }),
    passthrough(),
    passthrough,
  );
  const exec = makeExec({ agent, result: { entries: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] } });
  exec.args = { append: 'intentional' };
  await postExecute(exec, passthrough(), passthrough);

  await turnStopping({ agent });
  assert.equal(steered.length, 1, 'only canonical arguments can declare intentional mutation');
});

test('tools outside the memory list are never judged', async () => {
  const steered = [];
  const agent = makeAgent(steered);
  const { postExecute, turnStopping } = wire({});

  await postExecute(
    makeExec({ tool: 'edit', agent, result: { output: JSON.stringify({ entries: [{ id: 'a' }] }) } }),
    passthrough(),
    passthrough,
  );
  await postExecute(
    makeExec({ tool: 'edit', agent, result: { output: JSON.stringify({ entries: [{ id: 'b' }, { id: 'a' }] }) } }),
    passthrough(),
    passthrough,
  );

  await turnStopping({ agent });
  assert.equal(steered.length, 0);
});

test('a failed memory call does not count as a violation', async () => {
  const steered = [];
  const agent = makeAgent(steered);
  const { postExecute, turnStopping } = wire({});

  await postExecute(
    makeExec({ agent, result: { output: JSON.stringify({ entries: [{ id: 'a' }, { id: 'b' }] }) } }),
    passthrough(),
    passthrough,
  );
  await postExecute(
    makeExec({ agent, result: { ok: false, isError: true, output: JSON.stringify({ entries: [{ id: 'a' }] }) } }),
    async () => ({ ok: false }),
    passthrough,
  );

  await turnStopping({ agent });
  assert.equal(steered.length, 0);
});

test('per-agent state does not leak across agents', async () => {
  const steered = [];
  const agentA = makeAgent(steered);
  const agentB = makeAgent(steered);
  const { postExecute, turnStopping } = wire({});

  await postExecute(
    makeExec({ agent: agentA, result: { output: JSON.stringify({ entries: [{ id: 'a' }, { id: 'c' }] }) } }),
    passthrough(),
    passthrough,
  );
  // Agent B's first observation must NOT be diffed against agent A's outline.
  await postExecute(
    makeExec({ agent: agentB, result: { output: JSON.stringify({ entries: [{ id: 'z' }] }) } }),
    passthrough(),
    passthrough,
  );

  await turnStopping({ agent: agentB });
  assert.equal(steered.length, 0);
});

test('after a nudge the turn state resets so the next turn starts clean', async () => {
  const steered = [];
  const agent = makeAgent(steered);
  const { postExecute, turnStopping } = wire({});

  await postExecute(
    makeExec({ agent, result: { output: JSON.stringify({ entries: [{ id: 'a' }, { id: 'c' }] }) } }),
    passthrough(),
    passthrough,
  );
  await postExecute(
    makeExec({ agent, result: { output: JSON.stringify({ entries: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] }) } }),
    passthrough(),
    passthrough,
  );
  await turnStopping({ agent });
  assert.equal(steered.length, 1);

  // The nudge already consumed the violation.
  await turnStopping({ agent });
  assert.equal(steered.length, 1, 'a second stop in the same turn does not re-steer');
});

test('DSH_APPEND_GUARD=off disables the plugin', async () => {
  const previous = process.env.DSH_APPEND_GUARD;
  process.env.DSH_APPEND_GUARD = 'off';
  try {
    const ctx = makeCtx();
    apply(ctx, {});
    assert.equal(ctx.handlers.size, 0, 'no hooks registered when switched off');
  } finally {
    if (previous === undefined) delete process.env.DSH_APPEND_GUARD;
    else process.env.DSH_APPEND_GUARD = previous;
  }
});

test('a rare tool shows up as a deferLoading candidate in the nudge', async () => {
  const steered = [];
  const agent = makeAgent(steered);
  const { postExecute, turnStopping } = wire({});

  await postExecute(makeExec({ tool: 'acp_status', agent, result: { output: 'ok' } }), passthrough(), passthrough);
  await postExecute(
    makeExec({ agent, result: { output: JSON.stringify({ entries: [{ id: 'a' }, { id: 'c' }] }) } }),
    passthrough(),
    passthrough,
  );
  await postExecute(
    makeExec({ agent, result: { output: JSON.stringify({ entries: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] }) } }),
    passthrough(),
    passthrough,
  );

  await turnStopping({ agent });
  assert.equal(steered.length, 1);
  const text = steered[0].content[0].text;
  assert.ok(text.includes('deferLoading'));
  assert.ok(text.includes('acp_status'));
});
