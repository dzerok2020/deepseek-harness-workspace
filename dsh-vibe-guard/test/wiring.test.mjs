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
