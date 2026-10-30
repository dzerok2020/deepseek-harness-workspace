import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Context } from '@deepseek-ai/cordis';
import Commands from '@deepseek-ai/dsh-commands';
import Tools from '@deepseek-ai/dsh-tools';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import { createScope, scopeTarget } from '@deepseek-ai/dsh-scope';

async function fixture(t, files) {
  const root = await mkdtemp(join(tmpdir(), 'ecc-native-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const kind of ['commands', 'agents']) await mkdir(join(root, kind));
  for (const [file, content] of Object.entries(files)) await writeFile(join(root, file), content);
  return root;
}

async function host(t, { broken } = {}) {
  const ctx = new Context();
  const fibers = [ctx.plugin(SystemPrompt), ctx.plugin(Tools), ctx.plugin(Commands)];
  await Promise.all(fibers.map(fiber => fiber.await()));
  t.after(() => ctx.fiber.dispose());
  const presets = new Map();
  ctx.provide('agentPresets', {
    async list() { return [...presets.values()].map(preset => ({ id: preset.id, broken })); },
    async resolve(id) { return { id, broken }; },
    async register(definition) {
      if (presets.has(definition.id)) throw new Error(`Duplicate agent preset: ${definition.id}`);
      presets.set(definition.id, definition);
      return async () => { if (presets.get(definition.id) === definition) presets.delete(definition.id); };
    },
  });
  return { ctx, presets };
}

function receivingAgent() {
  const messages = [];
  const events = [];
  const agent = {
    options: { provider: 'native', model: 'current-model' },
    followup(message) { messages.push(message); },
    session: { append(type, data) { events.push({ type, data }); return { seq: events.length }; } },
  };
  return { agent, messages, events };
}

async function register(t, files, config = {}) {
  const { registerNativeAssets } = await import('../lib/native-assets.js');
  const root = await fixture(t, files);
  const runtime = await host(t);
  return { ...runtime, root, result: await registerNativeAssets(runtime.ctx, { eccRoot: root, ...config }) };
}

function registerTool(ctx, name, calls = []) {
  return ctx.tools.register({
    name, description: `Fixture ${name}`, parameters: {},
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    execute() { calls.push(name); return name; },
  });
}

async function mountPreset(t, ctx, preset, key = {}) {
  const scope = createScope(ctx, key);
  t.after(() => scope.dispose());
  for (const entry of preset.plugins) {
    const plugin = await import(entry.name);
    const fiber = scope.ctx.plugin(plugin, entry.config);
    await fiber.await();
  }
  return { key, ctx: scope.ctx, dispose: () => scope.dispose() };
}

test('public registration queues the complete ECC prompt and exact arguments on the receiving native Agent', async t => {
  const body = '# Plan\n\nKeep {{literal}}. WAIT for explicit approval before writing code.\n\nRequest: $ARGUMENTS\n';
  const { ctx, result } = await register(t, {
    'commands/plan.md': `---\ndescription: >-\n  Plan safely\nargument-hint: "<request>"\n---\n${body}`,
  });
  const { agent, messages, events } = receivingAgent();
  assert.deepEqual(Object.keys(result).sort(), ['agents', 'collisions', 'commands', 'disposers', 'unsupported']);
  assert.equal(result.commands[0].status, 'registered');
  const descriptor = ctx.commands.list(agent).find(command => command.name === 'ecc-plan');
  assert.equal(descriptor.description, 'Plan safely');
  assert.equal(descriptor.input.hint, '<request>');
  const input = '  Build $5 feature\nkeep "quotes" and `backticks`  ';
  const execution = await ctx.commands.execute(agent, `/ecc-plan${input}`, [], new AbortController().signal);
  assert.equal(execution.result.kind, 'success');
  assert.equal(messages.length, 1, 'command handlers do not send prompts automatically');
  const message = messages[0];
  assert.equal(message.role, 'user');
  assert.ok(message.id);
  const prompt = message.content.filter(block => block.type === 'text').map(block => block.text).join('\n');
  assert.ok(prompt.includes(body.replaceAll('$ARGUMENTS', input)));
  assert.ok(prompt.includes(input));
  assert.match(prompt, /WAIT for explicit approval/);
  assert.match(prompt, /\{\{literal\}\}/);
  assert.deepEqual(events.map(event => event.type), ['command/run', 'command/done']);
});

test('registration is collision-safe, namespaced and reversibly owns only its registrations', async t => {
  const { registerNativeAssets } = await import('../lib/native-assets.js');
  const root = await fixture(t, { 'commands/plan.md': 'Plan safely', 'commands/help.md': 'Help safely' });
  const { ctx } = await host(t);
  const original = { name: 'ecc-plan', description: 'Existing', handler: () => ({ kind: 'success', text: 'original' }) };
  ctx.commands.register(original);
  const result = await registerNativeAssets(ctx, { eccRoot: root });
  assert.equal(result.commands.find(item => item.name === 'plan').status, 'collision');
  assert.equal(result.collisions[0].nativeName, 'ecc-plan');
  const { agent, messages } = receivingAgent();
  assert.equal((await ctx.commands.execute(agent, '/ecc-plan', [], new AbortController().signal)).result.text, 'original');
  assert.equal(messages.length, 0);
  await Promise.all(result.disposers.map(dispose => dispose()));
  assert.equal(ctx.commands.find(agent, 'ecc-help'), undefined);
  assert.equal(ctx.commands.find(agent, 'ecc-plan').description, 'Existing');
});

test('commands fail clearly without a real native inbox seam and never claim a prompt was sent', async t => {
  const { ctx } = await register(t, { 'commands/plan.md': 'WAIT for approval.' });
  const { agent } = receivingAgent();
  delete agent.followup;
  const execution = await ctx.commands.execute(agent, '/ecc-plan request', [], new AbortController().signal);
  assert.equal(execution.result.kind, 'error');
  assert.match(execution.result.text, /followup|inbox/i);
});

test('malformed documents and unsupported host or external-provider semantics are reported without registration', async t => {
  const { ctx, result } = await register(t, {
    'commands/broken.md': '---\ndescription: [broken\n---\nBody',
    'commands/empty.md': '---\ndescription: Empty\n---\n',
    'commands/external.md': 'Run ~/.claude/bin/codeagent-wrapper --backend codex "$ARGUMENTS"',
    'commands/restricted.md': '---\nallowed-tools: [Read]\n---\nOnly read.',
    'commands/good.md': 'Safe native prompt',
  });
  assert.equal(result.commands.length, 5);
  assert.equal(result.unsupported.length, 4);
  assert.deepEqual(ctx.commands.list(receivingAgent().agent).map(item => item.name), ['ecc-good']);
  assert.ok(result.unsupported.every(item => item.reason.length > 0));
});

test('agent presets preserve literal persona, enforce tools through native execution, and do not leak globally', async t => {
  const { registerNativeAssets } = await import('../lib/native-assets.js');
  const body = 'You are the careful reviewer. Keep {{literal}} and do not edit files.\n';
  const root = await fixture(t, { 'agents/reviewer.md': `---\nname: reviewer\ndescription: Review changes\ntools: Read, Grep\nmodel: sonnet\n---\n${body}` });
  const { ctx, presets } = await host(t);
  const calls = [];
  for (const name of ['read', 'grep', 'write']) registerTool(ctx, name, calls);
  const result = await registerNativeAssets(ctx, { eccRoot: root });
  assert.equal(result.agents[0].status, 'registered');
  assert.deepEqual(result.agents[0].model, { requested: 'sonnet', mode: 'inherit-current', nativeModel: null, provider: 'current' });
  const preset = await mountPreset(t, ctx, presets.get('ecc-reviewer'));
  const assembly = await ctx.systemPrompt.assemble({ scope: preset.key });
  assert.ok(assembly.sections.some(section => section.text.includes(body) && section.interpolate === false));
  assert.deepEqual(assembly.tools.map(tool => tool.name).sort(), ['grep', 'read']);
  assert.ok(!(await ctx.systemPrompt.assemble()).sections.some(section => section.text.includes(body)));
  assert.deepEqual(ctx.tools.schemas().map(tool => tool.name).sort(), ['grep', 'read', 'write']);
  const agent = Object.assign(preset.key, { ctx: preset.ctx });
  const signal = new AbortController().signal;
  assert.equal((await ctx.tools.execute({ callId: 'read-1', name: 'read', arguments: {}, signal, agent })).isError, false);
  assert.equal((await ctx.tools.execute({ callId: 'write-1', name: 'write', arguments: {}, signal, agent })).isError, true);
  await preset.ctx.inject(['tools'], child => { registerTool(child, 'late-write', calls); }).await();
  assert.equal((await ctx.tools.execute({ callId: 'late-1', name: 'late-write', arguments: {}, signal, agent })).isError, true);
  assert.deepEqual(calls, ['read']);
  await preset.dispose();
  assert.deepEqual(ctx.tools.schemas(agent).map(tool => tool.name).sort(), ['grep', 'read', 'write']);
});

test('explicit model mapping changes only the model on scoped native request and inherits the active provider', async t => {
  const { registerNativeAssets } = await import('../lib/native-assets.js');
  const root = await fixture(t, { 'agents/planner.md': '---\nname: planner\ntools: [Read]\nmodel: opus\n---\nPlan only.' });
  const { ctx, presets } = await host(t);
  registerTool(ctx, 'ops_read');
  const result = await registerNativeAssets(ctx, { eccRoot: root, toolMap: { Read: 'ops_read' }, modelMap: { opus: 'native-reasoner' } });
  assert.deepEqual(result.agents[0].tools, { requested: ['Read'], native: ['ops_read'] });
  assert.deepEqual(result.agents[0].model, { requested: 'opus', mode: 'native-model', nativeModel: 'native-reasoner', provider: 'current' });
  const preset = await mountPreset(t, ctx, presets.get('ecc-planner'));
  const base = Object.freeze({ provider: 'current-native-provider', model: 'current-model', temperature: 0.2 });
  const mapped = await ctx.waterfall(scopeTarget(preset.key, preset.key), 'agent/request', { agent: preset.key }, async () => base);
  assert.deepEqual(mapped, { ...base, model: 'native-reasoner' });
  const unmapped = await ctx.waterfall(scopeTarget({}, {}), 'agent/request', { agent: {} }, async () => base);
  assert.equal(unmapped, base);
  assert.match((await ctx.systemPrompt.assemble({ scope: preset.key })).sections.map(section => section.text).join('\n'), /native-reasoner/);
});

test('unmapped tools, missing tools and cross-provider model mappings fail closed instead of weakening agents', async t => {
  const { registerNativeAssets } = await import('../lib/native-assets.js');
  const root = await fixture(t, {
    'agents/unknown.md': '---\ntools: [MysteryTool]\n---\nUnknown tool',
    'agents/missing.md': '---\ntools: [Bash]\n---\nMissing native tool',
    'agents/external.md': '---\ntools: [Read]\nmodel: opus\n---\nNative only',
  });
  const { ctx, presets } = await host(t);
  registerTool(ctx, 'read');
  const result = await registerNativeAssets(ctx, { eccRoot: root, modelMap: { opus: { provider: 'external', model: 'other' } } });
  assert.equal(presets.size, 0);
  assert.equal(result.unsupported.length, 3);
  assert.ok(result.agents.every(item => item.status === 'unsupported'));
});

test('explicit empty tool list means no tools, not unrestricted tools', async t => {
  const { registerNativeAssets } = await import('../lib/native-assets.js');
  const root = await fixture(t, { 'agents/no-tools.md': '---\ntools: []\n---\nReason without tools.' });
  const { ctx, presets } = await host(t);
  registerTool(ctx, 'bash');
  const result = await registerNativeAssets(ctx, { eccRoot: root });
  assert.equal(result.agents[0].status, 'registered');
  const preset = await mountPreset(t, ctx, presets.get('ecc-no-tools'));
  assert.deepEqual((await ctx.systemPrompt.assemble({ scope: preset.key })).tools, []);
  assert.equal(ctx.tools.schemas().length, 1);
});

test('preset collisions do not await unrelated preset diagnostics during host activation', async t => {
  const { registerNativeAssets } = await import('../lib/native-assets.js');
  const root = await fixture(t, { 'agents/reviewer.md': '---\ntools: [Read]\n---\nReview.' });
  const { ctx, presets } = await host(t);
  registerTool(ctx, 'read');
  const original = { id: 'ecc-reviewer' };
  presets.set(original.id, original);
  ctx.agentPresets.list = async () => { throw new Error('must not await unrelated host Loader rows'); };
  const result = await registerNativeAssets(ctx, { eccRoot: root });
  assert.equal(result.agents[0].status, 'collision');
  assert.equal(result.collisions.length, 1);
  assert.equal(presets.get(original.id), original);
  assert.equal(result.disposers.length, 0);
});

test('broken preset activation is unsupported and its failed registration is disposed', async t => {
  const { registerNativeAssets } = await import('../lib/native-assets.js');
  const root = await fixture(t, { 'agents/reviewer.md': '---\ntools: [Read]\n---\nReview.' });
  const { ctx, presets } = await host(t, { broken: 'persona plugin failed activation' });
  registerTool(ctx, 'read');
  const result = await registerNativeAssets(ctx, { eccRoot: root });
  assert.equal(result.agents[0].status, 'unsupported');
  assert.match(result.agents[0].reason, /failed activation/);
  assert.equal(result.disposers.length, 0);
  assert.equal(presets.size, 0);
});

test('real Loader and AgentPresetRegistry activate, mount and dispose the native preset module', async t => {
  const [{ default: Loader }, { default: Projections }, { default: Presets }, { registerNativeAssets }] = await Promise.all([
    import('@deepseek-ai/cordis-plugin-loader'), import('@deepseek-ai/dsh-session-projection'),
    import('@deepseek-ai/dsh-agent-preset-registry'), import('../lib/native-assets.js'),
  ]);
  const root = await fixture(t, { 'agents/reviewer.md': '---\ntools: [Read]\nmodel: sonnet\n---\nReal mounted persona {{literal}}.' });
  const ctx = new Context();
  const fibers = [ctx.plugin(Loader), ctx.plugin(Projections), ctx.plugin(SystemPrompt), ctx.plugin(Tools), ctx.plugin(Commands), ctx.plugin(Presets, { default: 'ecc-reviewer' })];
  await Promise.all(fibers.map(fiber => fiber.await()));
  t.after(() => ctx.fiber.dispose());
  registerTool(ctx, 'read');
  registerTool(ctx, 'write');
  const result = await registerNativeAssets(ctx, { eccRoot: root });
  assert.equal(result.agents[0].status, 'registered', result.agents[0].reason);
  assert.equal((await ctx.agentPresets.resolve('ecc-reviewer')).broken, undefined);
  const key = {};
  const agentScope = createScope(ctx, key);
  t.after(() => agentScope.dispose());
  assert.deepEqual(await ctx.agentPresets.mount(agentScope.ctx, 'ecc-reviewer'), { id: 'ecc-reviewer' });
  const assembly = await ctx.systemPrompt.assemble({ scope: key });
  assert.ok(assembly.sections.some(section => section.text.includes('Real mounted persona {{literal}}.')));
  assert.deepEqual(assembly.tools.map(tool => tool.name), ['read']);
  assert.equal(ctx.agentPresets.inspectCompositions(agentScope.ctx).length, 1);
  await Promise.all(result.disposers.map(dispose => dispose()));
  assert.equal((await ctx.agentPresets.list()).length, 0);
  assert.deepEqual((await ctx.systemPrompt.assemble({ scope: key })).tools.map(tool => tool.name), ['read'], 'in-use preset revision remains retained until its Agent scope is disposed');
  await agentScope.dispose();
  assert.equal(ctx.agentPresets.inspectCompositions().length, 0);
});

test('main-shaped session-local capabilities stay fail-closed across late publication, sibling scopes and disposal', async t => {
  const [{ default: Loader }, { default: Projections }, { default: Presets }, { registerNativeAssets }] = await Promise.all([
    import('@deepseek-ai/cordis-plugin-loader'), import('@deepseek-ai/dsh-session-projection'),
    import('@deepseek-ai/dsh-agent-preset-registry'), import('../lib/native-assets.js'),
  ]);
  const root = await fixture(t, { 'agents/reviewer.md': '---\ntools: [Read]\n---\nReview without widening native permissions.' });
  const ctx = new Context();
  await Promise.all([
    ...[Loader, Projections, SystemPrompt, Tools, Commands].map(plugin => ctx.plugin(plugin)),
    ctx.plugin(Presets, { default: 'standard' }),
  ].map(fiber => fiber.await()));
  t.after(() => ctx.fiber.dispose());
  await ctx.agentPresets.register({ id: 'standard', plugins: [] });
  const sessions = [];
  for (let index = 0; index < 2; index++) {
    const key = {};
    const scope = createScope(ctx, key);
    t.after(() => scope.dispose());
    await ctx.agentPresets.mount(scope.ctx, 'standard');
    let view;
    await scope.ctx.plugin({ inject: ['tools'], apply(scoped) { view = scoped; } }).await();
    sessions.push({ key, scope, view });
  }
  const calls = [];
  const sibling = sessions[1];
  const removeSibling = registerTool(sibling.view, 'ops_read_files', calls);
  const config = { eccRoot: root, toolMap: { Read: 'ops_read_files' } };
  const assertHeld = async () => {
    const result = await registerNativeAssets(ctx, config);
    assert.equal(result.agents[0].status, 'unsupported');
    assert.match(result.agents[0].reason, /adapter registration scope/);
    assert.match(result.agents[0].reason, /standalone ECC presets.*do not inherit/);
    assert.doesNotMatch(result.agents[0].reason, /missing dependency|not installed/i);
    assert.equal(result.disposers.length, 0);
    assert.deepEqual((await ctx.agentPresets.list()).map(preset => preset.id), ['standard']);
    assert.equal(ctx.tools.get('ops_read_files'), undefined);
    return result;
  };
  assert.ok(ctx.tools.get('ops_read_files', sibling.key));
  assert.equal(ctx.tools.get('ops_read_files', sessions[0].key), undefined);
  await assertHeld();
  const removeParent = registerTool(sessions[0].view, 'ops_read_files', calls);
  assert.ok(ctx.tools.get('ops_read_files', sessions[0].key));
  await assertHeld();
  const unrelated = {};
  const execution = await ctx.tools.execute({ callId: 'no-session-leak', name: 'ops_read_files', arguments: { files: [{ path: 'src/example.py' }] }, signal: new AbortController().signal, agent: unrelated });
  assert.equal(execution.isError, true);
  removeParent();
  assert.equal(ctx.tools.get('ops_read_files', sessions[0].key), undefined);
  assert.ok(ctx.tools.get('ops_read_files', sibling.key));
  await assertHeld();
  removeSibling();
  assert.equal(ctx.tools.get('ops_read_files', sibling.key), undefined);
  assert.deepEqual(calls, [], 'no real worker or fixture tool body may run');
});

test('a caller-visible tool is not inherited by an independently activated real ECC preset', async t => {
  const [{ default: Loader }, { default: Projections }, { default: Presets }, { registerNativeAssets }] = await Promise.all([
    import('@deepseek-ai/cordis-plugin-loader'), import('@deepseek-ai/dsh-session-projection'),
    import('@deepseek-ai/dsh-agent-preset-registry'), import('../lib/native-assets.js'),
  ]);
  const root = await fixture(t, { 'agents/reviewer.md': '---\ntools: [Read]\n---\nNo caller capability transfer.' });
  const ctx = new Context();
  await Promise.all([
    ...[Loader, Projections, SystemPrompt, Tools, Commands].map(plugin => ctx.plugin(plugin)),
    ctx.plugin(Presets, { default: 'standard' }),
  ].map(fiber => fiber.await()));
  t.after(() => ctx.fiber.dispose());
  const key = {};
  const caller = createScope(ctx, key);
  t.after(() => caller.dispose());
  let view;
  await caller.ctx.plugin({ inject: ['tools', 'systemPrompt', 'agentPresets'], apply(scoped) { view = scoped; } }).await();
  const calls = [];
  registerTool(view, 'ops_read_files', calls);
  assert.ok(ctx.tools.get('ops_read_files', key));
  assert.equal(ctx.tools.get('ops_read_files'), undefined);
  const result = await registerNativeAssets(view, { eccRoot: root, toolMap: { Read: 'ops_read_files' } });
  assert.equal(result.agents[0].status, 'unsupported', 'caller visibility must never make an independent preset falsely ready');
  assert.match(result.agents[0].reason, /activation failed/);
  assert.equal(result.disposers.length, 0);
  assert.equal((await ctx.agentPresets.list()).length, 0);
  assert.ok(ctx.tools.get('ops_read_files', key), 'failed activation must not dispose caller-owned tools');
  assert.equal(ctx.tools.get('ops_read_files', {}), undefined);
  assert.ok(!(await ctx.systemPrompt.assemble({ scope: key })).sections.some(section => section.text.includes('No caller capability transfer.')));
  assert.deepEqual(calls, []);
});

test('preset apply validates its actual capability scope before contributing prompt or restrictions', async t => {
  const { apply } = await import('../lib/native-assets.js');
  const { ctx } = await host(t);
  const key = {};
  const scope = createScope(ctx, key);
  t.after(() => scope.dispose());
  let failure;
  await scope.ctx.plugin({ inject: ['tools', 'systemPrompt'], apply(view) {
    try {
      apply(view, { prompt: 'No partial persona on rejected capability.', tools: ['ops_read_files'], model: { requested: null, nativeModel: null } });
    } catch (error) { failure = error; }
  } }).await();
  assert.ok(failure, 'an unavailable required capability must fail activation');
  assert.ok(!(await ctx.systemPrompt.assemble({ scope: key })).sections.some(section => section.text.includes('No partial persona on rejected capability.')), 'rejected activation must not leave a partial ECC persona');
  assert.match(failure.message, /actual preset activation scope/);
  assert.deepEqual(ctx.tools.schemas(key), []);
});

test('missing required host services are explicit unsupported assets, never false registered', async t => {
  const { registerNativeAssets } = await import('../lib/native-assets.js');
  const root = await fixture(t, { 'commands/plan.md': 'Plan.', 'agents/reviewer.md': '---\ntools: [Read]\n---\nReview.' });
  const result = await registerNativeAssets(new Context(), { eccRoot: root });
  assert.equal(result.commands[0].status, 'unsupported');
  assert.equal(result.agents[0].status, 'unsupported');
  assert.equal(result.disposers.length, 0);
  assert.equal(result.unsupported.length, 2);
});
