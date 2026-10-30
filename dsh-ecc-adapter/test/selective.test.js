import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { Context } from '@deepseek-ai/cordis';
import Loader from '@deepseek-ai/cordis-plugin-loader';
import Projections from '@deepseek-ai/dsh-session-projection';
import Presets from '@deepseek-ai/dsh-agent-preset-registry';
import Commands from '@deepseek-ai/dsh-commands';
import Tools from '@deepseek-ai/dsh-tools';
import Skills from '@deepseek-ai/dsh-skill';
import SystemPrompt, { renderContextSnapshot } from '@deepseek-ai/dsh-system-prompt';
import { createScope, scopeOf } from '@deepseek-ai/dsh-scope';
import { apply } from '../lib/index.js';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'ecc-selective-test-')); const source = join(root, 'source'); const data = join(root, 'state'); const ctx = new Context();
  t.after(async () => { await ctx.fiber.dispose(); assert.ok(resolve(root).startsWith(join(tmpdir(), 'ecc-selective-test-'))); await rm(root, { recursive: true, force: true }); });
  const fibers = [ctx.plugin(Loader, { config: { entries: [] } }), ctx.plugin(Projections), ctx.plugin(Presets), ctx.plugin(Commands), ctx.plugin(Skills), ctx.plugin(SystemPrompt), ctx.plugin(Tools)];
  await Promise.all(fibers.map(f => f.await()));
  const files = {
    'skills/alpha/SKILL.md': '---\nname: alpha\ndescription: Alpha\n---\nSafe supplemental testing guidance.',
    'skills/continuous-learning/SKILL.md': '---\nname: continuous-learning\ndescription: Learning\n---\nPersist memories into ~/.claude/skills/learned.',
    'commands/learn.md': '---\ndescription: Learning\n---\nSave observations into ~/.claude/memory.',
    'commands/plan.md': '---\ndescription: Plan\n---\nPlan $ARGUMENTS and wait for confirmation.',
    'agents/reviewer.md': '---\ntools: [Read]\n---\nReview the supplied source.',
    'rules/common/testing.md': '# Tests\nUse executable evidence.',
    'rules/common/learning.md': '# Store\nWrite to ~/.claude/observations.jsonl.',
    'hooks/hooks.json': JSON.stringify({ hooks: {} }), 'mcp-configs/mcp-servers.json': JSON.stringify({ mcpServers: {} }),
  };
  for (const [path, body] of Object.entries(files)) { const full = join(source, path); await mkdir(resolve(full, '..'), { recursive: true }); await writeFile(full, body); }
  ctx.tools.register({ name: 'read', description: 'Fixture only', parameters: {}, output: { schema: { type: 'string' }, render: (_a,v)=>[{type:'text',text:v}] }, execute: () => 'not called' });
  return { ctx, source, data };
}

test('selective native mode withholds raw memory entrypoints and applies source-complete ownership policy', async t => {
  const { ctx, source, data } = await fixture(t);
  await apply(ctx, { eccRoot: source, dataRoot: data, selective: true });
  const state = JSON.parse(await readFile(join(data, 'status.json'), 'utf8'));
  assert.equal(state.policy.mode, 'selective-native');
  assert.equal(state.policy.counts.total, 7);
  assert.deepEqual((await ctx.skills.list()).map(s => s.name), ['alpha']);
  assert.equal(ctx.commands.find({}, 'ecc-learn'), undefined);
  assert.ok(ctx.commands.find({}, 'ecc-plan'));
  assert.equal(state.native.commands.find(c => c.name === 'learn').status, 'policy-held');
  const prompt = renderContextSnapshot(await ctx.systemPrompt.assemble({}));
  assert.match(prompt, /executable evidence/);
  assert.doesNotMatch(prompt, /Write to ~\/.claude\/observations/);
  assert.equal(state.memory.owner, 'Hindsight');
  assert.match(prompt, /memory tools are disabled/i);
  assert.doesNotMatch(prompt, /Use memory_save\/search\/read\/doctor/);
  assert.equal(ctx.tools.schemas().some(tool => tool.name === 'memory_save'), false);
});

test('selective same-name fallback follows both workspace and scope across native owner removal', { skip: !process.env.ECC_ROOT, timeout: 30000 }, async t => {
  const { ctx, data } = await fixture(t);
  const sameName = 'agent-harness-construction', otherCwd = join(data, 'other-project');
  const first = createScope(ctx, {}), second = createScope(ctx, {});
  t.after(async () => { await first.dispose(); await second.dispose(); });
  const candidate = (name, provider) => ({ name, description: 'Native fixture owner', rank: 100, provider, source: 'project', locator: name, invocation: { modelInvocable: true, userInvocable: true } });
  const removeGlobal = ctx.skills.registerProvider(() => ({ name: 'native-global',
    list: async options => options.cwd === process.cwd() ? [sameName, 'tdd'].map(name => candidate(name, 'native-global')) : [],
    get: async entry => ({ ...entry, content: 'Native global body' }),
  }));
  const scoped = first.ctx.plugin({ name: 'native-scoped-fixture', inject: ['skills'], apply(view) {
    view.skills.registerProvider(() => ({ name: 'native-scoped',
      list: async options => options.cwd === otherCwd ? [candidate(sameName, 'native-scoped')] : [],
      get: async entry => ({ ...entry, content: 'Native scoped body' }),
    }));
  } });
  await scoped.await();
  await apply(ctx, { eccRoot: process.env.ECC_ROOT, dataRoot: data, selective: true });
  const firstView = { cwd: otherCwd, scope: scopeOf(first.ctx) }, secondView = { cwd: otherCwd, scope: scopeOf(second.ctx) };
  assert.equal((await ctx.skills.get(sameName, { cwd: process.cwd() })).provider, 'native-global');
  assert.equal((await ctx.skills.get(sameName, firstView)).provider, 'native-scoped');
  assert.equal((await ctx.skills.get(sameName, secondView))?.provider, 'ecc-upstream');
  assert.equal((await ctx.skills.get(sameName, { cwd: otherCwd }))?.provider, 'ecc-upstream');
  const initial = JSON.parse(await readFile(join(data, 'status.json'), 'utf8'));
  assert.equal(initial.policy.assets.find(row => row.name === sameName).action, 'native-equivalent');
  assert.match(initial.policy.view.verification, /registration-view only/i);
  assert.equal(initial.policy.view.cwd, process.cwd());
  assert.equal((await ctx.skills.get('tdd-workflow', secondView)), undefined, 'partial overlap stays reference-only even if native owner is missing');
  const agent = { ctx: second.ctx, session: { header: { cwd: otherCwd }, append: () => ({ seq: 1 }) }, followup() { throw new Error('Status must not invoke a model'); } };
  const result = await ctx.commands.execute(agent, '/ecc-status', [], new AbortController().signal);
  assert.equal(result.result.kind, 'success');
  const summary = JSON.parse(result.result.text);
  assert.equal(summary.ownership.cwd, otherCwd);
  assert.equal(summary.ownership.scope, 'agent');
  const overlap = summary.ownership.assets.find(row => row.name === 'tdd-workflow');
  assert.equal(overlap.action, 'reference-only');
  assert.equal(overlap.status, 'native-unavailable');
  assert.equal(overlap.nativeSkill, 'tdd');
  assert.equal(overlap.owner, null);
  assert.equal(summary.ownership.assets.find(row => row.name === sameName).status, 'ecc-fallback');
  const prompt = renderContextSnapshot(await ctx.systemPrompt.assemble({ scope: scopeOf(second.ctx) }));
  assert.doesNotMatch(prompt, /use native tdd/);
  assert.match(prompt, /current workspace.*scope/i);
  removeGlobal();
  assert.equal((await ctx.skills.get(sameName, { cwd: process.cwd() }))?.provider, 'ecc-upstream');
  await scoped.dispose();
  assert.equal((await ctx.skills.get(sameName, firstView))?.provider, 'ecc-upstream');
});

test('pinned source selective integration covers every component and exposes only Hindsight memory tools', { skip: !process.env.ECC_ROOT }, async t => {
  const { ctx, data } = await fixture(t);
  await apply(ctx, { eccRoot: process.env.ECC_ROOT, dataRoot: data, expectedRevision: 'b92f181b3b748d1abbc2afd94af6aa7d8c8fca29', selective: true, enableMemory: true });
  const state = JSON.parse(await readFile(join(data, 'status.json'), 'utf8'));
  assert.equal(state.policy.counts.total, 661);
  assert.equal(state.policy.assets.length, 661);
  assert.equal(state.hookPolicy.hooks.length, 27);
  assert.equal(state.hooks.status, 'disabled');
  assert.equal(state.memory.status, 'native-registered');
  assert.deepEqual(state.memory.tools, ['memory_save', 'memory_search', 'memory_read', 'memory_doctor']);
  const prompt = renderContextSnapshot(await ctx.systemPrompt.assemble({}));
  assert.match(prompt, /Use memory_save\/search\/read\/doctor/);
  assert.doesNotMatch(prompt, /memory tools are disabled/i);
  for (const asset of state.policy.assets.filter(row => row.kind === 'skills' && row.action !== 'include')) {
    assert.equal((await ctx.skills.list()).some(skill => skill.name === asset.name), false, asset.name);
  }
  for (const asset of state.native.commands.filter(row => row.status === 'policy-held')) assert.equal(ctx.commands.find({}, `ecc-${asset.name}`), undefined);
  const summary = { sourceComponents: state.policy.counts.total, policy: state.policy.counts, skills: (await ctx.skills.list()).length, registeredCommands: state.native.commands.filter(row => row.status === 'registered').length, memoryOwner: state.memory.owner };
  console.log('SELECTIVE_MOUNT ' + JSON.stringify(summary));
});
