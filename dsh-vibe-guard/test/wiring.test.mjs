import test from 'node:test';
import assert from 'node:assert/strict';
import { apply, inject, name } from '../lib/index.js';

function makeCtx() {
  const guards = [];
  const handlers = new Map();
  const ctx = {
    tools: { guard(fn) { guards.push(fn); return () => {}; } },
    on(event, handler) { handlers.set(event, handler); return () => {}; },
  };
  return { ctx, guards, handlers };
}

function makeAgent() {
  const steers = [];
  const agent = { steer(message) { steers.push(message); } };
  return { agent, steers };
}

function feed(handlers, exec, result) {
  const next = async () => ({ kind: 'accept' });
  return handlers.get('tools/post-execute')(exec, result, next);
}

test('exports name, inject and apply', () => {
  assert.equal(name, 'dsh-vibe-guard');
  assert.ok(Array.isArray(inject));
  assert.ok(inject.includes('tools'));
  assert.equal(typeof apply, 'function');
});

test('registers a guard and both event handlers', () => {
  const { ctx, guards, handlers } = makeCtx();
  apply(ctx, {});
  assert.equal(guards.length, 1);
  assert.equal(typeof handlers.get('tools/post-execute'), 'function');
  assert.equal(typeof handlers.get('agent/turn-stopping'), 'function');
});

test('guard denies irreversible commands and allows benign ones', () => {
  const { ctx, guards } = makeCtx();
  apply(ctx, {});
  const guard = guards[0];
  const denied = guard({ name: 'bash', arguments: { command: 'rm -rf /' } });
  assert.equal(typeof denied, 'string');
  assert.ok(denied.length > 0);
  assert.equal(guard({ name: 'bash', arguments: { command: 'ls -la' } }), undefined);
  assert.equal(guard({ name: 'bash', arguments: { command: 'rm -rf /tmp/build' } }), undefined);
});

test('an edit with no verification forces a steer at turn end', async () => {
  const { ctx, handlers } = makeCtx();
  apply(ctx, {});
  const { agent, steers } = makeAgent();
  await feed(handlers, { name: 'write', arguments: { file_path: 'a.md' }, agent }, {});
  await handlers.get('agent/turn-stopping')({ agent, turn: 1 });
  assert.equal(steers.length, 1);
  const text = steers[0].content[0].text;
  assert.equal(typeof text, 'string');
  assert.ok(text.length > 0);
});

test('a passing verification clears the gate', async () => {
  const { ctx, handlers } = makeCtx();
  apply(ctx, {});
  const { agent, steers } = makeAgent();
  await feed(handlers, { name: 'write', arguments: { file_path: 'a.md' }, agent }, {});
  await feed(handlers, { name: 'bash', arguments: { command: 'pnpm test' }, agent }, {});
  await handlers.get('agent/turn-stopping')({ agent, turn: 2 });
  assert.equal(steers.length, 0);
});

test('a failed verification re-opens the gate', async () => {
  const { ctx, handlers } = makeCtx();
  apply(ctx, {});
  const { agent, steers } = makeAgent();
  await feed(handlers, { name: 'write', arguments: { file_path: 'a.md' }, agent }, {});
  await feed(handlers, { name: 'bash', arguments: { command: 'pnpm test' }, agent }, {});
  await feed(handlers, { name: 'bash', arguments: { command: 'pnpm test' }, agent }, { isError: true });
  await handlers.get('agent/turn-stopping')({ agent, turn: 3 });
  assert.equal(steers.length, 1);
});

test('a shell write followed by failure still leaves verification debt', async () => {
  const { ctx, handlers } = makeCtx();
  apply(ctx, {});
  const { agent, steers } = makeAgent();
  await feed(handlers, { name: 'bash', arguments: { command: 'echo changed > report.txt && false' }, agent }, { isError: true });
  await handlers.get('agent/turn-stopping')({ agent, turn: 1 });
  assert.equal(steers.length, 1);
});

test('a failed verification after a write cannot close the debt', async () => {
  const { ctx, handlers } = makeCtx();
  apply(ctx, {});
  const { agent, steers } = makeAgent();
  await feed(handlers, { name: 'bash', arguments: { command: 'echo changed > report.txt; node --test missing.test.js' }, agent }, { isError: true });
  await handlers.get('agent/turn-stopping')({ agent, turn: 1 });
  assert.equal(steers.length, 1);
});

test('a blocked shell write cannot create verification debt', async () => {
  const { ctx, handlers } = makeCtx();
  apply(ctx, {});
  const { agent, steers } = makeAgent();
  await handlers.get('tools/post-execute')(
    { name: 'bash', arguments: { command: 'echo changed > report.txt && false' }, agent },
    { isError: true },
    async () => ({ kind: 'block' })
  );
  await handlers.get('agent/turn-stopping')({ agent, turn: 1 });
  assert.equal(steers.length, 0);
});

test('OPS commands share edit, verification and irreversible gates', async () => {
  const { ctx, handlers, guards } = makeCtx();
  apply(ctx, {});
  assert.equal(typeof guards[0]({ name: 'ops_bash', arguments: { command: 'git reset --hard' } }), 'string');
  assert.equal(typeof guards[0]({ name: 'ops_bash', arguments: { script_path: 'opaque.sh' } }), 'string');
  const { agent, steers } = makeAgent();
  await feed(handlers, { name: 'ops_bash', arguments: { command: 'echo changed > a.txt' }, agent }, { kind: 'foreground', status: 'completed', exitCode: 0 });
  await handlers.get('agent/turn-stopping')({ agent });
  assert.equal(steers.length, 1);
});

for (const result of [
  { kind: 'foreground', status: 'failed', exitCode: 1 },
  { failure: { code: 'INVALID_ARGUMENT' } },
  { kind: 'background', jobId: 'j1' },
  { kind: 'promoted', jobId: 'j2' },
  { status: 'pending' },
  { kind: 'foreground', status: 'completed', exitCode: null },
]) test(`structured OPS ${JSON.stringify(result)} is not passing evidence`, async () => {
  const { ctx, handlers } = makeCtx();
  apply(ctx, { shellTools: ['ops_bash'] });
  const { agent, steers } = makeAgent();
  await feed(handlers, { name: 'write', agent }, {});
  await feed(handlers, { name: 'ops_bash', arguments: { command: 'node --test test/' }, agent }, result);
  await handlers.get('agent/turn-stopping')({ agent });
  assert.equal(steers.length, 1);
});

test('host session event binds only its live agent and bounds repeated claim steering', async () => {
  const { ctx, handlers } = makeCtx();
  const parent = makeAgent(); parent.agent.id = 'parent';
  const child = makeAgent(); child.agent.id = 'child';
  ctx.agents = { get(id) { return id === 'parent' ? parent.agent : id === 'child' ? child.agent : undefined; } };
  apply(ctx, { maxPerSession: 2 });
  await feed(handlers, { name: 'write', agent: parent.agent }, {});
  const claim = { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'Done. Fixed.' }] } } };
  handlers.get('session/event')({ id: 'child' }, claim);
  handlers.get('session/event')({ id: 'unknown' }, claim);
  for (let i = 0; i < 5; i++) handlers.get('session/event')({ id: 'parent' }, claim);
  assert.equal(parent.steers.length, 1);
  assert.equal(child.steers.length, 0);
  await feed(handlers, { name: 'write', agent: parent.agent }, {});
  handlers.get('session/event')({ id: 'parent' }, claim);
  await handlers.get('agent/turn-stopping')({ agent: parent.agent });
  assert.equal(parent.steers.length, 2);
});

test('claim gate steers independently when verifyGate is disabled', async () => {
  const { ctx, handlers } = makeCtx();
  const { agent, steers } = makeAgent();
  agent.id = 'parent';
  ctx.agents = { get(id) { return id === agent.id ? agent : undefined; } };
  apply(ctx, { claimGate: true, verifyGate: false });
  await feed(handlers, { name: 'write', agent }, {});
  await handlers.get('agent/turn-stopping')({ agent });
  assert.equal(steers.length, 0);
  const claim = { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'Done. Fixed.' }] } } };
  for (let i = 0; i < 5; i++) handlers.get('session/event')({ id: 'parent' }, claim);
  assert.equal(steers.length, 1);
});

test('successful OPS foreground verification clears only its agent debt', async () => {
  const { ctx, handlers } = makeCtx(); apply(ctx, {});
  const a = makeAgent(), b = makeAgent();
  for (const { agent } of [a, b]) await feed(handlers, { name: 'write', agent }, {});
  await feed(handlers, { name: 'ops_bash', arguments: { command: 'node --test test/' }, agent: a.agent }, { isError: false, value: { kind: 'foreground', status: 'completed', exitCode: 0 } });
  for (const { agent } of [a, b]) await handlers.get('agent/turn-stopping')({ agent });
  assert.equal(a.steers.length, 0); assert.equal(b.steers.length, 1);
});

test('DSH_VIBE_GUARD=off disables everything', () => {
  const { ctx, guards, handlers } = makeCtx();
  process.env.DSH_VIBE_GUARD = 'off';
  try {
    apply(ctx, {});
  } finally {
    delete process.env.DSH_VIBE_GUARD;
  }
  assert.equal(guards.length, 0);
  assert.equal(handlers.size, 0);
});
