import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);
import { Context } from '@deepseek-ai/cordis';
import Loader from '@deepseek-ai/cordis-plugin-loader';
import Projections from '@deepseek-ai/dsh-session-projection';
import Presets from '@deepseek-ai/dsh-agent-preset-registry';
import Commands from '@deepseek-ai/dsh-commands';
import Tools from '@deepseek-ai/dsh-tools';
import Skills from '@deepseek-ai/dsh-skill';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';

async function host(t) {
  const root = await mkdtemp(join(tmpdir(), 'ecc-bootstrap-test-'));
  const source = join(root, 'source');
  const data = join(root, 'state');
  const ctx = new Context();
  t.after(async () => {
    await ctx.fiber.dispose();
    assert.equal(resolve(root), root);
    assert.ok(root.startsWith(join(tmpdir(), 'ecc-bootstrap-test-')));
    await rm(root, { recursive: true, force: true });
  });
  for (const path of ['commands', 'agents', 'skills/alpha', 'rules/common', 'hooks', 'mcp-configs']) {
    await mkdir(join(source, path), { recursive: true });
  }
  for (const [path, text] of Object.entries({
    'commands/plan.md': '---\ndescription: Plan fixture\n---\nPlan $ARGUMENTS; wait for user confirmation.',
    'agents/reviewer.md': '---\ntools: [Read]\nmodel: sonnet\n---\nReview only.',
    'skills/alpha/SKILL.md': '---\nname: alpha\ndescription: Fixture\n---\nAlpha original.',
    'rules/common/testing.md': '# Testing\nTest before claiming completion.',
    'hooks/hooks.json': JSON.stringify({ hooks: { SessionEnd: [{ hooks: [{ type: 'command', command: 'exit 0' }] }] } }),
    'mcp-configs/mcp-servers.json': JSON.stringify({ mcpServers: { github: { command: 'must-not-execute' } } }),
  })) await writeFile(join(source, path), text);
  const fibers = [ctx.plugin(Loader), ctx.plugin(Projections), ctx.plugin(SystemPrompt), ctx.plugin(Tools), ctx.plugin(Commands), ctx.plugin(Skills), ctx.plugin(Presets, { default: 'ecc-reviewer' })];
  await Promise.all(fibers.map(fiber => fiber.await()));
  for (const name of ['read', 'write', 'edit', 'grep', 'glob', 'bash', 'web_fetch', 'web_search', 'ask_user_question']) {
    ctx.tools.register({ name, description: `Fixture ${name}`, parameters: {}, output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] }, execute() { throw new Error('Registration smoke must not execute tools'); } });
  }
  return { ctx, source, data };
}

test('plugin mounts native services, emits truthful inventory and does not activate hooks or MCP by default', async t => {
  const { ctx, source, data } = await host(t);
  const plugin = await import(process.env.ECC_PLUGIN_ENTRY || new URL('../lib/index.js', import.meta.url).href);
  const fiber = ctx.plugin(plugin, { eccRoot: source, dataRoot: data });
  await fiber.await();
  const status = JSON.parse(await readFile(join(data, 'status.json'), 'utf8'));
  assert.deepEqual(status.inventory.counts, { skills: 1, commands: 1, agents: 1, rules: 1, hooks: 1, mcp: 1 });
  assert.equal(status.hooks.status, 'disabled');
  assert.equal(status.memory.status, 'disabled');
  assert.equal(status.mcp.status, 'disabled');
  assert.equal(status.planner.status, 'disabled');
  assert.equal(status.payloadHooks.status, 'disabled');
  assert.equal(status.connectors.serversStarted, 0);
  assert.equal(status.connectors.capabilities[0].runtimeVerified, false);
  assert.equal(status.native.commands[0].status, 'registered');
  assert.equal(status.native.agents[0].status, 'registered');
  assert.equal(status.native.agents[0].model.mode, 'inherit-current');
  assert.equal(status.parity, 'partial');
  assert.equal(status.skills.observation.complete, true);
  assert.equal(status.skills.observation.assets[0].owner, 'ecc-upstream');
  assert.equal(status.inventory.assets.skills[0].status, 'native-registered');
  assert.ok(ctx.commands.find({}, 'ecc-status'));
  assert.ok(ctx.commands.find({}, 'ecc-plan'));
  const agent = { options: { provider: 'native', model: 'current' }, session: { append: () => ({ seq: 1 }) }, followup() { throw new Error('Status must not invoke a model'); } };
  const execution = await ctx.commands.execute(agent, '/ecc-status', [], new AbortController().signal);
  assert.equal(execution.result.kind, 'success');
  assert.equal(JSON.parse(execution.result.text).parity, 'partial');
  assert.equal((await ctx.skills.list()).length, 1);
  assert.equal((await ctx.agentPresets.resolve('ecc-reviewer')).broken, undefined);
  await fiber.dispose();
  assert.equal(ctx.commands.find({}, 'ecc-status'), undefined);
  assert.equal(ctx.commands.find({}, 'ecc-plan'), undefined);
});

test('opt-in planner waits for the native service, obeys admission guards and disposes with it', async t => {
  const { ctx, source, data } = await host(t);
  await writeFile(join(source, 'agents/planner.md'), '---\nname: planner\ntools: Read, Grep, Glob\nmodel: opus\n---\nRead only; propose a plan and wait for approval.');
  const plugin = await import(process.env.ECC_PLUGIN_ENTRY || new URL('../lib/index.js', import.meta.url).href);
  const fiber = ctx.plugin(plugin, { eccRoot: source, dataRoot: data, selective: true, enablePlanner: true });
  await fiber.await();
  const initial = JSON.parse(await readFile(join(data, 'status.json'), 'utf8'));
  assert.equal(initial.planner.status, 'waiting-service');
  assert.ok(ctx.commands.find({}, 'ecc-status'));
  assert.equal(ctx.tools.get('ecc_planner'), undefined);
  let starts = 0;
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('late planner registration timed out')), 5000);
    const off = ctx.on('tools/change', () => {
      if (ctx.tools.get('ecc_planner')) { clearTimeout(timer); off(); resolve(); }
    });
    t.after(() => { clearTimeout(timer); off(); });
  });
  const native = ctx.plugin({ apply(view) { view.provide('subagents', {
    getProvider() { return { prepareContinuable() {}, capabilities: { agentOptions: true } }; },
    startActivation() { starts++; throw new Error('Bootstrap must not invoke a model'); },
  }); } });
  await native.await();
  await ready;
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(ctx.commands.find({}, 'ecc-planner'));
  ctx.tools.guard(execution => execution.name === 'ecc_planner' ? 'native policy denies pilot' : undefined);
  const agent = { ctx, options: {}, session: { append: () => ({ seq: 1 }) } };
  const execution = await ctx.commands.execute(agent, '/ecc-planner Read only.', [], new AbortController().signal);
  assert.equal(execution.result.kind, 'error');
  assert.match(execution.result.text, /native policy denies pilot/);
  assert.equal(starts, 0);
  await native.dispose();
  assert.equal(ctx.tools.get('ecc_planner'), undefined);
  assert.equal(ctx.commands.find({}, 'ecc-planner'), undefined);
  assert.ok(ctx.commands.find({}, 'ecc-status'));
  await fiber.dispose();
});

test('a source pin mismatch aborts before registering any ECC assets', async t => {
  const { ctx, source, data } = await host(t);
  const { apply } = await import(process.env.ECC_PLUGIN_ENTRY || new URL('../lib/index.js', import.meta.url).href);
  await assert.rejects(apply(ctx, { eccRoot: source, dataRoot: data, expectedRevision: 'not-the-fixture-revision' }), /revision mismatch/);
  assert.equal(ctx.commands.find({}, 'ecc-plan'), undefined);
  assert.equal((await ctx.skills.list()).length, 0);
});

test('a pinned revision rejects dirty source before any assets are registered', async t => {
  const { ctx, source, data } = await host(t);
  await exec('git', ['init', '-q'], { cwd: source });
  await exec('git', ['add', '.'], { cwd: source });
  await exec('git', ['-c', 'user.name=ECC fixture', '-c', 'user.email=ecc-fixture@invalid', 'commit', '-qm', 'Fixture baseline'], { cwd: source });
  const { stdout } = await exec('git', ['rev-parse', 'HEAD'], { cwd: source });
  await writeFile(join(source, 'commands/plan.md'), 'Tampered prompt at the same HEAD');
  const { apply } = await import(process.env.ECC_PLUGIN_ENTRY || new URL('../lib/index.js', import.meta.url).href);
  await assert.rejects(apply(ctx, { eccRoot: source, dataRoot: data, expectedRevision: stdout.trim() }), /ECC source is dirty/);
  assert.equal(ctx.commands.find({}, 'ecc-plan'), undefined);
  assert.equal(ctx.commands.find({}, 'ecc-status'), undefined);
});

test('status-command collision preserves the existing command and refuses a half-mounted adapter', async t => {
  const { ctx, source, data } = await host(t);
  const original = ctx.commands.register({ name: 'ecc-status', description: 'Existing owner', handler: () => ({ kind: 'message', text: 'original' }) });
  t.after(original);
  const { apply } = await import(process.env.ECC_PLUGIN_ENTRY || new URL('../lib/index.js', import.meta.url).href);
  await assert.rejects(apply(ctx, { eccRoot: source, dataRoot: data }), /ecc-status already exists/);
  assert.equal(ctx.commands.find({}, 'ecc-plan'), undefined);
  assert.equal((await ctx.skills.list()).length, 0);
});

const upstream = process.env.ECC_ROOT;
test('pinned upstream source mounts the entire inventory with real public DSH services', { skip: !upstream, timeout: 60000 }, async t => {
  const { ctx, data } = await host(t);
  const plugin = await import(process.env.ECC_PLUGIN_ENTRY || new URL('../lib/index.js', import.meta.url).href);
  const fiber = ctx.plugin(plugin, { eccRoot: upstream, dataRoot: data, expectedRevision: 'b92f181b3b748d1abbc2afd94af6aa7d8c8fca29' });
  await fiber.await();
  const status = JSON.parse(await readFile(join(data, 'status.json'), 'utf8'));
  assert.deepEqual(status.inventory.counts, { skills: 311, commands: 97, agents: 71, rules: 121, hooks: 27, mcp: 34 });
  assert.equal((await ctx.skills.list()).length, 311);
  assert.equal(status.native.commands.length, 97);
  assert.equal(status.native.agents.length, 71);
  assert.equal(status.native.commands.filter(asset => asset.status === 'registered').length, 72);
  assert.equal(status.native.agents.filter(asset => asset.status === 'registered').length, 69);
  for (const asset of [...status.native.commands, ...status.native.agents]) {
    assert.ok(['registered', 'unsupported', 'collision'].includes(asset.status), asset.path);
    if (asset.status !== 'registered') assert.ok(asset.reason);
  }
  assert.equal(status.hooks.status, 'disabled');
  assert.equal(status.mcp.status, 'disabled');
  assert.equal(status.memory.status, 'disabled');
  console.log('UPSTREAM_MOUNT', JSON.stringify({ counts: status.inventory.counts, registeredCommands: status.native.commands.filter(asset => asset.status === 'registered').length, registeredAgents: status.native.agents.filter(asset => asset.status === 'registered').length, unsupported: status.native.unsupported.length }));
});
