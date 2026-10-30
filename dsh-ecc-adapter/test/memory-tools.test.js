import test from 'node:test';
import assert from 'node:assert/strict';
import { Context } from '@deepseek-ai/cordis';
import Tools from '@deepseek-ai/dsh-tools';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import { registerMemoryTools } from '../lib/memory-tools.js';

async function host(t) {
  const ctx = new Context();
  t.after(() => ctx.fiber.dispose());
  await ctx.plugin(SystemPrompt).await();
  await ctx.plugin(Tools, {}).await();
  return ctx;
}

test('ECC memory tools use native runtime and current session workspace, not a second MCP', async t => {
  const ctx = await host(t); const calls = [];
  const state = registerMemoryTools(ctx, { eccRoot: '/source', workspaceRoot: '/fallback' }, async config => {
    calls.push(config);
    return Object.fromEntries(['save', 'search', 'read', 'doctor'].map(key => [key, async args => ({ owner: 'Hindsight', method: key, args })]));
  });
  const controller = new AbortController();
  const result = await ctx.tools.execute({ name: 'memory_save', arguments: { title: 'One', body: 'Fact' }, callId: 'save', agent: { session: { header: { cwd: '/session-workspace', origin: 'user' } } }, signal: controller.signal });
  assert.ok(calls[0].signal instanceof AbortSignal);
  assert.equal(result.isError, false);
  assert.match(JSON.stringify(result), /Hindsight/);
  assert.equal(calls[0].workspaceRoot, '/session-workspace');
  assert.equal(state.tools.length, 4);
  for (const dispose of state.disposers) dispose();
  assert.equal(ctx.tools.schemas().some(tool => tool.name === 'memory_save'), false);
});

test('ECC memory ownership preserves colliding tools without half registration', async t => {
  const ctx = await host(t);
  ctx.tools.register({ name: 'memory_read', description: 'Existing owner', parameters: {}, output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: v }] }, execute: () => 'existing' });
  assert.throws(() => registerMemoryTools(ctx, {}, () => {}), /collision|existing owner/i);
  assert.equal(ctx.tools.schemas().some(tool => tool.name === 'memory_save'), false);
});

test('ECC memory bridge follows native subagent opt-out before constructing a client', async t => {
  const ctx = await host(t); let clients = 0;
  registerMemoryTools(ctx, { eccRoot: '/source', workspaceRoot: '/fallback' }, async () => { clients++; return {}; });
  const result = await ctx.tools.execute({ name: 'memory_doctor', arguments: {}, callId: 'doctor', agent: { session: { header: { cwd: '/child', origin: 'subagent' } } }, signal: new AbortController().signal });
  assert.equal(result.isError, true);
  assert.equal(clients, 0);
});
