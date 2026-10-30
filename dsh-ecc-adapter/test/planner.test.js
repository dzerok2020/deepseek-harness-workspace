import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { Context } from '@deepseek-ai/cordis';
import Tools from '@deepseek-ai/dsh-tools';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import { createScope, scopeTarget } from '@deepseek-ai/dsh-scope';

// Exercise the installed public SDK depth policy without constructing a native agent loop.
const sdk = createRequire(join(dirname(process.execPath), '../lib/node_modules/@deepseek-ai/dsh/package.json'));
const { SubagentRuntime, resolveChildDepth } = await import(sdk.resolve('@deepseek-ai/dsh-subagent'));
const names = ['ops_read_files', 'ops_grep', 'ops_glob'];
const body = 'You are the planner. Keep {{literal}}. Produce a plan, never implement.\n';
const pinned = 'b92f181b3b748d1abbc2afd94af6aa7d8c8fca29';
const deferred = () => { let resolve, reject; const promise = new Promise((done, fail) => { resolve = done; reject = fail; }); return { promise, resolve, reject }; };

async function registration() {
  let module;
  try { module = await import('../lib/planner.js'); }
  catch (error) { if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error; }
  assert.equal(typeof module?.registerPlanner, 'function', 'public registerPlanner must implement the native planner pilot');
  return module.registerPlanner;
}

function tool(ctx, name, calls = []) {
  return ctx.tools.register({
    name, description: `Fixture ${name}`, parameters: { type: 'object', additionalProperties: true },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    execute() { calls.push(name); return name; },
  });
}
function publish(child, calls = []) { return names.map(name => tool(child.ctx, name, calls)); }
const call = (ctx, agent, name, args = {}, signal = new AbortController().signal) => ctx.tools.execute({ callId: `${name}-${Math.random()}`, name, arguments: args, signal, agent });

async function fixture(t, options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'ecc-planner-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'agents'));
  await writeFile(join(root, 'agents/planner.md'), `---\nname: planner\ntools: Read, Grep, Glob\nmodel: opus\n---\n${body}`);
  const ctx = new Context();
  await Promise.all([ctx.plugin(Tools), ctx.plugin(SystemPrompt)].map(fiber => fiber.await()));
  t.after(() => ctx.fiber.dispose());
  const generation = {};
  const composition = createScope(ctx, generation);
  t.after(() => composition.dispose());
  let compositionCtx;
  await composition.ctx.plugin({ inject: ['tools', 'systemPrompt'], apply(view) { compositionCtx = view; } }).await();
  async function agent(id) {
    const key = { id, options: { provider: 'native-route', model: 'current-model', reasoningEffort: 'current-effort', maxTokens: 1024 }, session: { id, header: { cwd: '/fixture/workspace' } } };
    const scope = createScope(ctx, key, { parent: generation });
    await scope.ctx.plugin({ inject: ['tools', 'systemPrompt'], apply(view) { key.ctx = view; } }).await();
    t.after(() => scope.dispose());
    return { agent: key, scope };
  }
  const { agent: parent } = await agent('parent');
  const { agent: sibling } = await agent('sibling');
  const started = deferred();
  const driver = { starts: [], attempts: [], resolutions: [], children: [], runs: 0, disposals: 0, started: started.promise };
  const provider = { name: 'spawn', capabilities: { agentOptions: true }, async prepareContinuable() { return {}; } };
  const nativeDepth = { config: { maxDepth: { get: () => options.maxDepth ?? 1 } } };
  ctx.provide('subagents', {
    resolveMaxDepth(configured) {
      driver.resolutions.push(configured);
      return SubagentRuntime.prototype.resolveMaxDepth.call(nativeDepth, configured);
    },
    getProvider(name) { return name === 'spawn' ? (options.provider ?? provider) : undefined; },
    async startActivation(spec) {
      driver.attempts.push(spec);
      const childDepth = resolveChildDepth(spec.request.parent, spec.request.maxDepth);
      driver.starts.push(spec);
      const { agent: child, scope } = await agent(spec.childId);
      child.options.subagentDepth = childDepth;
      child.session.header.delegationDepth = childDepth;
      driver.children.push(child);
      let disposed = false;
      const terminal = deferred();
      const dispose = async () => {
        if (disposed) return;
        disposed = true;
        driver.disposals++;
        await scope.dispose();
        terminal.resolve({ stopReason: 'aborted', output: [] });
      };
      const activation = { childId: child.id, result: terminal.promise, dispose };
      try {
        await options.onChild?.(child, driver, spec);
        started.resolve(child);
        await ctx.serial(scopeTarget(child, child), 'agent/created', { agent: child, source: 'startup', signal: spec.signal });
        spec.signal.throwIfAborted();
        driver.runs++;
        if (options.run) Promise.resolve(options.run(child, driver, spec)).then(terminal.resolve, terminal.reject);
        else terminal.resolve({ stopReason: 'completed', output: [{ type: 'text', text: 'Fixture plan: read, then ask for approval.' }] });
        return activation;
      } catch (error) { await dispose(); throw error; }
    },
  });
  const registerPlanner = await registration();
  const result = await registerPlanner(ctx, { eccRoot: root, readinessTimeoutMs: 100, ...options.config });
  t.after(async () => { for (const dispose of result.disposers) await dispose(); });
  return { ctx, root, parent, sibling, compositionCtx, result, driver };
}

test('linked planner shares the native scope singleton through public runtime resolution and Agent lifecycle', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ecc-planner-native-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'agents'));
  await writeFile(join(root, 'agents/planner.md'), `---\nname: planner\ntools: Read, Grep, Glob\nmodel: opus\n---\n${body}`);
  // A fresh isolate applies the public linked-package resolver before importing the adapter.
  // Only the creation/teardown registry is real; the managed driver never starts a loop or worker.
  const script = `
    import assert from 'node:assert/strict';
    import { createRequire } from 'node:module';
    import { join } from 'node:path';
    import { pathToFileURL } from 'node:url';
    const [anchor, adapterDir, sourceRoot, personaBody] = process.argv.slice(1);
    const sdk = createRequire(anchor);
    const load = name => import(sdk.resolve(name));
    const [{ Context }, { PluginPackages, createRuntimeResolution }, { default: Tools }, { default: SystemPrompt }, { default: Agents }, nativeScope, depth] = await Promise.all([
      load('@deepseek-ai/cordis'), load('@deepseek-ai/dsh-app-boot'), load('@deepseek-ai/dsh-tools'), load('@deepseek-ai/dsh-system-prompt'), load('@deepseek-ai/dsh-agent'), load('@deepseek-ai/dsh-scope'), load('@deepseek-ai/dsh-subagent'),
    ]);
    const ctx = new Context();
    const resolution = await createRuntimeResolution({ installAnchor: anchor, home: join(sourceRoot, 'inert-home') });
    await ctx.plugin(PluginPackages, { resolution: { ...resolution, linkedRoots: [{ name: 'dsh-ecc-adapter', realPath: adapterDir }] } }).await();
    try {
      const plannerURL = pathToFileURL(join(adapterDir, 'lib/planner.js')).href;
      const adapterRequire = createRequire(plannerURL);
      const adapterScope = await import(adapterRequire.resolve('@deepseek-ai/dsh-scope'));
      const { registerPlanner } = await import(plannerURL);
      await Promise.all([ctx.plugin(Tools), ctx.plugin(SystemPrompt), ctx.plugin(Agents)].map(fiber => fiber.await()));
      const scopes = [];
      async function agent(id) {
        const agent = { id, options: { provider: 'native-route', model: 'native-model', reasoningEffort: 'native-effort', maxTokens: 1024 }, session: { id, header: { cwd: sourceRoot, delegationDepth: 0 } } };
        const scope = nativeScope.createScope(ctx, agent);
        scopes.push(scope);
        await scope.ctx.plugin({ inject: ['tools', 'systemPrompt', 'agents'], apply(view) { agent.ctx = view; } }).await();
        assert.equal(nativeScope.scopeOf(agent.ctx), agent);
        return { agent, scope };
      }
      let reads = 0, writes = 0, runs = 0, disposals = 0;
      const names = ['ops_read_files', 'ops_grep', 'ops_glob'];
      function tool(view, name) {
        return view.tools.register({ name, description: 'Inert SDK fixture', parameters: { type: 'object', additionalProperties: true },
          output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
          execute() { if (names.includes(name)) reads++; else writes++; return name; } });
      }
      const { agent: parent } = await agent('native-parent');
      const { agent: sibling } = await agent('native-sibling');
      tool(ctx, 'ops_write_file');
      ctx.tools.guard(execution => execution.name === 'ops_glob' ? 'Inherited native permission denial' : undefined);
      const provider = { name: 'spawn', capabilities: { agentOptions: true }, async prepareContinuable() { return {}; } };
      ctx.provide('subagents', {
        resolveMaxDepth(configured) { return depth.SubagentRuntime.prototype.resolveMaxDepth.call({ config: { maxDepth: { get: () => 1 } } }, configured); },
        getProvider(name) { return name === 'spawn' ? provider : undefined; },
        async startActivation(spec) {
          const childDepth = depth.resolveChildDepth(spec.request.parent, spec.request.maxDepth);
          const { agent: child, scope } = await agent(spec.childId);
          child.options.subagentDepth = childDepth;
          child.session.header.delegationDepth = childDepth;
          let disposed = false;
          const dispose = async () => { if (!disposed) { disposed = true; disposals++; await scope.dispose(); } };
          const publication = setTimeout(() => { for (const name of names) tool(child.ctx, name); }, 5);
          try {
            await child.ctx.agents.register(child);
            runs++;
            const assembled = await ctx.systemPrompt.assemble({ scope: child });
            assert.ok(assembled.sections.some(section => section.name === 'ecc-planner-persona' && section.interpolate === false && section.text.includes(personaBody)));
            assert.deepEqual(assembled.tools.map(item => item.name).sort(), [...names].sort());
            assert.ok(!(await ctx.systemPrompt.assemble({ scope: sibling })).sections.some(section => section.name === 'ecc-planner-persona'));
            assert.equal(ctx.tools.get('ops_read_files', sibling), undefined);
            assert.equal(ctx.tools.get('ops_read_files'), undefined);
            const execute = name => ctx.tools.execute({ name, arguments: {}, agent: child, signal: spec.signal, callId: name });
            assert.equal((await execute('ops_read_files')).isError, false);
            assert.equal((await execute('ops_glob')).isError, true, 'Native policy still overrides the planner allowlist');
            tool(child.ctx, 'late-write');
            for (const name of ['ops_write_file', 'late-write', 'invoke', 'run_code']) assert.equal((await execute(name)).isError, true);
            assert.deepEqual(spec.request.agentOptions, { maxTokens: 1024 });
            for (const name of ['agentPreset', 'provider', 'model', 'persona', 'toolFilter']) assert.equal(Object.hasOwn(spec.request, name), false);
            return { childId: child.id, result: Promise.resolve({ stopReason: 'completed', output: [] }), dispose };
          } catch (error) { await dispose(); throw error; }
          finally { clearTimeout(publication); }
        },
      });
      const planner = await registerPlanner(ctx, { eccRoot: sourceRoot, readinessTimeoutMs: 1000 });
      assert.equal(planner.observe(parent).implementationVersion, '0.3.1');
      assert.equal(planner.observe(parent).nativeScopeMatched, true);
      const result = await ctx.tools.execute({ name: 'ecc_planner', arguments: { task: 'Plan only.' }, agent: parent, signal: new AbortController().signal, callId: 'native-planner' });
      assert.equal(result.isError, false, 'Native linked planner failed (same scope singleton: ' + (adapterScope.scopeOf === nativeScope.scopeOf) + '): ' + JSON.stringify(result));
      assert.equal(adapterScope.scopeOf, nativeScope.scopeOf, 'the linked adapter must use the host scope singleton');
      assert.equal(result.value.status, 'completed');
      assert.equal(runs, 1); assert.equal(disposals, 1); assert.equal(reads, 1); assert.equal(writes, 0);
      assert.deepEqual(planner.observe(parent).active, []);
      for (const dispose of planner.disposers) await dispose();
      for (const scope of scopes) await scope.dispose();
      console.log(JSON.stringify({ runs, disposals, reads, writes, scopeShared: true }));
    } finally { await ctx.fiber.dispose(); }
  `;
  const { stdout } = await promisify(execFile)(process.execPath, ['--input-type=module', '--eval', script, sdk.resolve('@deepseek-ai/dsh/package.json'), fileURLToPath(new URL('..', import.meta.url)), root, body], { timeout: 15000, maxBuffer: 1048576 });
  assert.deepEqual(JSON.parse(stdout.trim()), { runs: 1, disposals: 1, reads: 1, writes: 0, scopeShared: true });
});

test('public ecc_planner runs the literal persona in only its child and returns a quiescent inherited-route plan', async t => {
  const calls = [];
  let runtime;
  runtime = await fixture(t, {
    onChild(child) { publish(child, calls); tool(child.ctx, 'write', calls); tool(child.ctx, 'invoke', calls); },
    async run(child, _driver, spec) {
      const assembly = await runtime.ctx.systemPrompt.assemble({ scope: child });
      assert.ok(assembly.sections.some(section => section.text.includes(body) && section.interpolate === false));
      assert.deepEqual(assembly.tools.map(item => item.name).sort(), [...names].sort());
      assert.ok(!(await runtime.ctx.systemPrompt.assemble({ scope: runtime.sibling })).sections.some(section => section.text.includes(body)));
      assert.equal((await call(runtime.ctx, child, 'ops_read_files')).isError, false);
      for (const name of ['write', 'invoke', 'run_code']) assert.equal((await call(runtime.ctx, child, name)).isError, true);
      tool(child.ctx, 'late-write', calls);
      assert.equal((await call(runtime.ctx, child, 'late-write')).isError, true);
      assert.equal(spec.request.parent, runtime.parent);
      assert.deepEqual(spec.request.prompt, [{ type: 'text', text: 'Plan the new feature.' }]);
      assert.deepEqual(spec.request.agentOptions, { maxTokens: 1024 });
      for (const key of ['agentPreset', 'provider', 'model', 'persona', 'toolFilter']) assert.equal(Object.hasOwn(spec.request, key), false);
      return { stopReason: 'completed', output: [{ type: 'text', text: 'A safe plan.' }] };
    },
  });
  assert.equal(runtime.result.status, 'registered');
  assert.deepEqual(runtime.result.tools, ['ecc_planner']);
  assert.equal(runtime.result.observe().runtimeVerified, false);
  const execution = await call(runtime.ctx, runtime.parent, 'ecc_planner', { task: 'Plan the new feature.' });
  assert.equal(execution.isError, false, JSON.stringify(execution));
  assert.equal(execution.value.status, 'completed');
  assert.equal(execution.value.childId, runtime.driver.children[0].id);
  assert.equal(execution.value.route, 'inherited-native');
  assert.equal(execution.value.parity, 'partial');
  assert.equal(execution.value.source.modelAlias, 'opus');
  assert.equal(runtime.driver.disposals, 1, 'the child must be quiescent before returning a result');
  assert.deepEqual(calls, ['ops_read_files']);
  assert.ok(!(await runtime.ctx.systemPrompt.assemble({ scope: runtime.driver.children[0] })).sections.some(section => section.text.includes(body)));
  assert.equal(runtime.ctx.tools.get('ops_read_files'), undefined);
});

test('native depth caps deny top-level, nested and resumed parents before child setup', async t => {
  for (const [name, maxDepth, runtimeDepth, persistedDepth] of [
    ['host zero', 0, 0, 0], ['nested parent', 1, 1, 0], ['resumed monotone header', 1, 0, 1],
  ]) await t.test(name, async t => {
    const runtime = await fixture(t, { maxDepth, onChild: child => publish(child) });
    runtime.parent.options.subagentDepth = runtimeDepth;
    runtime.parent.session.header.delegationDepth = persistedDepth;
    const execution = await call(runtime.ctx, runtime.parent, 'ecc_planner', { task: 'Respect native depth.' });
    assert.equal(execution.isError, true, 'native delegation cap must not be omitted');
    assert.match(JSON.stringify(execution), /subagent depth .* exceeds maxDepth/);
    assert.deepEqual(runtime.driver.resolutions, [undefined]);
    assert.equal(runtime.driver.attempts[0].request.maxDepth, maxDepth);
    assert.equal(runtime.driver.starts.length, 0);
    assert.equal(runtime.driver.children.length, 0);
    assert.equal(runtime.driver.runs, 0);
    assert.deepEqual(runtime.result.observe().active, []);
  });
});

test('planner resolves the live native depth cap on every call without changing the route', async t => {
  const options = { maxDepth: 1, onChild: child => publish(child) };
  const runtime = await fixture(t, options);
  assert.equal((await call(runtime.ctx, runtime.parent, 'ecc_planner', { task: 'First plan.' })).isError, false);
  options.maxDepth = 2;
  runtime.parent.options.subagentDepth = 1;
  assert.equal((await call(runtime.ctx, runtime.parent, 'ecc_planner', { task: 'Second plan.' })).isError, false);
  options.maxDepth = 1;
  const denied = await call(runtime.ctx, runtime.parent, 'ecc_planner', { task: 'Now deny.' });
  assert.equal(denied.isError, true);
  assert.deepEqual(runtime.driver.resolutions, [undefined, undefined, undefined]);
  assert.deepEqual(runtime.driver.attempts.map(spec => spec.request.maxDepth), [1, 2, 1]);
  assert.deepEqual(runtime.driver.children.map(child => child.options.subagentDepth), [1, 2]);
  for (const spec of runtime.driver.attempts) {
    assert.equal(spec.provider, 'spawn');
    assert.equal(spec.request.parent, runtime.parent);
    assert.deepEqual(spec.request.agentOptions, { maxTokens: 1024 });
    for (const key of ['agentPreset', 'provider', 'model', 'reasoningEffort', 'persona', 'toolFilter']) assert.equal(Object.hasOwn(spec.request, key), false);
  }
  assert.equal(runtime.driver.disposals, 2);
  assert.deepEqual(runtime.result.observe().active, []);
});

test('missing or invalid native depth seams fail closed before activation', async t => {
  const runtime = await fixture(t, { onChild: child => publish(child) });
  const original = runtime.ctx.subagents.resolveMaxDepth;
  for (const resolver of [null, ...[undefined, null, NaN, Infinity, -1, -0, 0.5, Number.MAX_SAFE_INTEGER + 1, '1', true].map(value => () => value), () => { throw new Error('native depth policy unavailable'); }]) {
    if (resolver === null) delete runtime.ctx.subagents.resolveMaxDepth;
    else runtime.ctx.subagents.resolveMaxDepth = resolver;
    const execution = await call(runtime.ctx, runtime.parent, 'ecc_planner', { task: 'Fail closed.' });
    assert.equal(execution.isError, true, 'missing/invalid native maxDepth must not create a child');
    assert.match(JSON.stringify(execution), /maxDepth|depth policy/i);
    assert.equal(runtime.driver.attempts.length, 0);
    assert.deepEqual(runtime.result.observe().active, []);
  }
  runtime.ctx.subagents.resolveMaxDepth = original;
  const denied = runtime.ctx.tools.guard(execution => execution.name === 'ecc_planner' ? 'parent denies planner' : undefined);
  assert.equal((await call(runtime.ctx, runtime.parent, 'ecc_planner', { task: 'Denied.' })).isError, true);
  assert.equal(runtime.driver.resolutions.length, 0, 'parent admission denial must not read policy or activate a child');
  denied();
});

test('late tools wait in the exact child scope and sibling readiness never starts queued work', async t => {
  const runtime = await fixture(t);
  publish(runtime.sibling);
  const pending = call(runtime.ctx, runtime.parent, 'ecc_planner', { task: 'Inspect the design.' });
  const child = await runtime.driver.started;
  assert.equal(runtime.driver.runs, 0);
  assert.equal(runtime.result.observe().active[0].status, 'awaiting-tools');
  tool(child.ctx, names[0]);
  tool(child.ctx, names[1]);
  await Promise.resolve();
  assert.equal(runtime.driver.runs, 0);
  tool(child.ctx, names[2]);
  const execution = await pending;
  assert.equal(execution.isError, false, JSON.stringify(execution));
  assert.equal(runtime.driver.runs, 1);
  assert.equal(runtime.driver.disposals, 1);
  assert.deepEqual(runtime.result.observe().active, []);
});

test('a parent-composition monotonic denial still wins for an allowlisted planner tool', async t => {
  const calls = [];
  let runtime;
  runtime = await fixture(t, { onChild(child) { publish(child, calls); }, async run(child) {
    const denied = await call(runtime.ctx, child, 'ops_read_files');
    assert.equal(denied.isError, true);
    assert.match(JSON.stringify(denied), /parent policy denies read/);
    assert.equal((await call(runtime.ctx, child, 'ops_grep')).isError, false);
    return { stopReason: 'completed', output: [{ type: 'text', text: 'Read denied; no write fallback.' }] };
  } });
  runtime.compositionCtx.tools.guard(exec => exec.name === 'ops_read_files' ? 'parent policy denies read' : undefined);
  assert.equal((await call(runtime.ctx, runtime.parent, 'ecc_planner', { task: 'Plan without bypass.' })).isError, false);
  assert.deepEqual(calls, ['ops_grep']);
});

test('readiness timeout fails closed without executing the child prompt or borrowing sibling tools', async t => {
  const runtime = await fixture(t, { config: { readinessTimeoutMs: 15 } });
  publish(runtime.sibling);
  const execution = await call(runtime.ctx, runtime.parent, 'ecc_planner', { task: 'Plan.' });
  assert.equal(execution.isError, true);
  assert.match(JSON.stringify(execution), /readiness.*timed out|readiness.*timeout/i);
  assert.equal(runtime.driver.runs, 0);
  assert.equal(runtime.driver.disposals, 1);
  assert.deepEqual(runtime.result.observe().active, []);
});

test('caller cancellation during readiness tears down the exact child and cannot start queued input', async t => {
  const runtime = await fixture(t);
  const controller = new AbortController();
  const pending = call(runtime.ctx, runtime.parent, 'ecc_planner', { task: 'Plan.' }, controller.signal);
  await runtime.driver.started;
  controller.abort(new Error('caller cancelled planner'));
  const execution = await pending;
  assert.equal(execution.isError, true);
  assert.equal(runtime.driver.runs, 0);
  assert.equal(runtime.driver.disposals, 1);
  assert.deepEqual(runtime.result.observe().active, []);
});

test('owner disposal cancels and awaits a running activation, unregistering only its tool', async t => {
  const running = deferred();
  const terminal = deferred();
  const runtime = await fixture(t, { onChild(child) { publish(child); }, run() { running.resolve(); return terminal.promise; } });
  tool(runtime.ctx, 'unrelated');
  const pending = call(runtime.ctx, runtime.parent, 'ecc_planner', { task: 'Plan.' });
  await running.promise;
  await Promise.all(runtime.result.disposers.map(dispose => dispose()));
  assert.equal((await pending).isError, true);
  assert.equal(runtime.driver.disposals, 1);
  assert.equal(runtime.ctx.tools.get('ecc_planner'), undefined);
  assert.ok(runtime.ctx.tools.get('unrelated'));
  assert.deepEqual(runtime.result.observe().active, []);
  await assert.rejects(runtime.result.start({ task: 'Again.' }, { agent: runtime.parent, signal: new AbortController().signal }), /disposed/i);
});

test('caller cancellation during an active run disposes before exposing the aborted result', async t => {
  const running = deferred();
  const terminal = deferred();
  const runtime = await fixture(t, { onChild(child) { publish(child); }, run() { running.resolve(); return terminal.promise; } });
  const controller = new AbortController();
  const pending = call(runtime.ctx, runtime.parent, 'ecc_planner', { task: 'Plan.' }, controller.signal);
  await running.promise;
  controller.abort();
  assert.equal((await pending).isError, true);
  assert.equal(runtime.driver.disposals, 1);
});

test('module provenance and current-parent scope diagnostics never claim runtime or permission proof', async t => {
  const runtime = await fixture(t);
  assert.equal(runtime.result.observe().nativeScopeMatched, null);
  assert.equal(runtime.result.observe().implementationVersion, '0.3.1');
  assert.equal(runtime.result.observe(runtime.parent).nativeScopeMatched, true);
  assert.equal(runtime.result.observe(runtime.sibling).nativeScopeMatched, true);
  assert.equal(runtime.result.observe({ ...runtime.parent, ctx: runtime.ctx }).nativeScopeMatched, false);
  assert.equal(runtime.result.observe({ ...runtime.parent, ctx: runtime.sibling.ctx }).nativeScopeMatched, false);
  assert.equal(runtime.result.observe({}).nativeScopeMatched, false);
  assert.equal(runtime.result.observe(null).nativeScopeMatched, null);
  runtime.parent.ctx = runtime.ctx;
  assert.equal(runtime.result.observe(runtime.parent).nativeScopeMatched, false, 'diagnostics read the current parent scope, not registration-time identity');
  assert.equal(runtime.result.observe(runtime.parent).runtimeVerified, false);
  assert.equal(runtime.result.observe(runtime.parent).parity, 'partial');
  assert.equal(runtime.result.observe(runtime.parent).route, 'inherited-native');
  assert.equal(runtime.driver.attempts.length, 0);
  assert.deepEqual(runtime.result.observe(runtime.parent).active, []);
});

test('ownership diagnostics filter concurrent planner activations by the exact native parent', async t => {
  const running = deferred();
  const terminal = deferred();
  let count = 0;
  const runtime = await fixture(t, { onChild(child) { publish(child); }, run() { if (++count === 2) running.resolve(); return terminal.promise; } });
  const first = call(runtime.ctx, runtime.parent, 'ecc_planner', { task: 'First plan.' });
  const second = call(runtime.ctx, runtime.sibling, 'ecc_planner', { task: 'Second plan.' });
  await running.promise;
  assert.equal(runtime.result.observe().active.length, 2);
  assert.equal(runtime.result.observe(runtime.parent).active.length, 1);
  assert.equal(runtime.result.observe(runtime.sibling).active.length, 1);
  assert.notEqual(runtime.result.observe(runtime.parent).active[0].childId, runtime.result.observe(runtime.sibling).active[0].childId);
  assert.deepEqual(runtime.result.observe({}).active, []);
  terminal.resolve({ stopReason: 'completed', output: [] });
  assert.equal((await first).isError, false);
  assert.equal((await second).isError, false);
  assert.equal(runtime.driver.disposals, 2);
});

test('native spawn without a safe output-token option is rejected before child execution', async t => {
  const runtime = await fixture(t, { provider: { name: 'spawn', capabilities: { agentOptions: false }, async prepareContinuable() { return {}; } } });
  const execution = await call(runtime.ctx, runtime.parent, 'ecc_planner', { task: 'Bounded plan.' });
  assert.equal(execution.isError, true);
  assert.match(JSON.stringify(execution), /output|agentOptions|maxTokens/i);
  assert.equal(runtime.driver.starts.length, 0);
});

test('invalid tasks and nonlocal providers are rejected before any activation', async t => {
  const runtime = await fixture(t, { provider: { name: 'spawn', capabilities: {}, async start() { throw new Error('must not execute remote provider'); } } });
  for (const args of [{ task: '' }, { task: 'x'.repeat(8193) }, { task: 'Plan.', provider: 'external' }, { task: 'Plan.', model: 'opus' }, { task: 'Plan.' }]) {
    assert.equal((await call(runtime.ctx, runtime.parent, 'ecc_planner', args)).isError, true);
  }
  assert.equal(runtime.driver.starts.length, 0);
});

test('registration rejects unsafe mappings and malformed planner tool requirements without partial tools', async t => {
  const runtime = await fixture(t);
  await runtime.result.disposers[0]();
  const registerPlanner = await registration();
  await assert.rejects(registerPlanner(runtime.ctx, { eccRoot: runtime.root, toolMap: { Read: 'bash' } }), /readonly|read-only|mapping/i);
  await assert.rejects(registerPlanner(runtime.ctx, { eccRoot: runtime.root, readinessTimeoutMs: 30001 }), /readinessTimeoutMs/);
  await writeFile(join(runtime.root, 'agents/planner.md'), '---\nname: planner\ntools: [Read, Write]\n---\nDo edits.');
  await assert.rejects(registerPlanner(runtime.ctx, { eccRoot: runtime.root }), /Read.*Grep.*Glob|read-only/i);
  assert.equal(runtime.ctx.tools.get('ecc_planner'), undefined);
});

test('collisions preserve the existing owner and disposal is idempotent', async t => {
  const runtime = await fixture(t);
  await runtime.result.disposers[0]();
  const remove = tool(runtime.ctx, 'ecc_planner');
  const original = runtime.ctx.tools.get('ecc_planner');
  const registerPlanner = await registration();
  const collision = await registerPlanner(runtime.ctx, { eccRoot: runtime.root });
  assert.equal(collision.status, 'collision');
  assert.deepEqual(collision.tools, []);
  assert.equal(runtime.ctx.tools.get('ecc_planner'), original);
  await Promise.all(runtime.result.disposers.map(dispose => dispose()));
  assert.equal(runtime.ctx.tools.get('ecc_planner'), original);
  remove();
});

test('pinned source revision is checked before registration and the upstream persona stays literal', { skip: !process.env.ECC_ROOT }, async t => {
  const runtime = await fixture(t);
  await runtime.result.disposers[0]();
  const registerPlanner = await registration();
  await assert.rejects(registerPlanner(runtime.ctx, { eccRoot: process.env.ECC_ROOT, expectedRevision: 'f'.repeat(40) }), /revision mismatch/i);
  const registered = await registerPlanner(runtime.ctx, { eccRoot: process.env.ECC_ROOT, expectedRevision: pinned });
  t.after(() => registered.disposers[0]());
  assert.equal(registered.observe().source.revision, pinned);
  assert.equal(registered.observe().source.pinned, true);
  assert.equal(registered.observe().runtimeVerified, false);
  const source = await readFile(join(process.env.ECC_ROOT, 'agents/planner.md'), 'utf8');
  assert.match(source, /tools: Read, Grep, Glob/);
});
