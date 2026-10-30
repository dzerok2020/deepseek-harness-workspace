import test from 'node:test';
import assert from 'node:assert/strict';
import { Context } from '@deepseek-ai/cordis';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import Tools from '@deepseek-ai/dsh-tools';
import { createScope } from '@deepseek-ai/dsh-scope';
import { registerConnectorDiagnostics } from '../lib/connectors.js';

async function fixture(t) {
  const ctx = new Context();
  await ctx.plugin(SystemPrompt).await();
  await ctx.plugin(Tools).await();
  t.after(() => ctx.fiber.dispose());
  return ctx;
}

const templates = ['filesystem', 'github', 'ecc-memory-vault', 'memory', 'omega-memory', 'longhand', 'memxus'].map(name => ({ name }));
const tool = name => ({ name, description: 'Readonly connector fixture', parameters: {}, output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] }, execute: () => 'fixture success' });

test('connector selection reuses exact scoped native OPS and never claims to start MCP servers', async t => {
  const ctx = await fixture(t);
  const left = createScope(ctx, {}), right = createScope(ctx, {});
  t.after(async () => { await left.dispose(); await right.dispose(); });
  const diagnostics = registerConnectorDiagnostics(ctx, { templates });
  t.after(async () => { for (const dispose of diagnostics.disposers) await dispose(); });
  const agent = { ctx: left.ctx, session: { header: { cwd: '/fixture/project' } } };
  assert.equal(diagnostics.observe(agent).capabilities[0].status, 'capability-missing');
  const mounted = left.ctx.plugin({ name: 'scoped-native-ops-fixture', inject: ['tools'], apply(view) {
    for (const name of ['ops_read_files', 'ops_grep', 'ops_glob']) view.tools.register(tool(name), { inheritable: false });
  } });
  await mounted.await();
  const own = diagnostics.observe(agent);
  assert.equal(own.serversStarted, 0);
  assert.equal(own.capabilities[0].status, 'native-tools-visible');
  assert.equal(own.capabilities[0].parity, 'partial-readonly');
  assert.deepEqual(own.capabilities[0].tools, ['ops_read_files', 'ops_grep', 'ops_glob']);
  assert.equal(own.capabilities[0].runtimeVerified, false);
  assert.equal(diagnostics.observe({ ctx: right.ctx, session: agent.session }).capabilities[0].status, 'capability-missing');
  assert.equal(own.templates.find(row => row.name === 'github').status, 'disabled');
  assert.equal(own.templates.find(row => row.name === 'memxus').owner, 'Hindsight');
  assert.deepEqual(ctx.tools.schemas().map(row => row.name), []);
  await mounted.dispose();
  assert.equal(diagnostics.observe(agent).capabilities[0].status, 'capability-missing');
});
