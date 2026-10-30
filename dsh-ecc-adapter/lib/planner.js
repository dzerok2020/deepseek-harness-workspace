import { randomUUID } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { scopeOf } from '@deepseek-ai/dsh-scope';
import { splitFrontmatter } from './inventory.js';

const exec = promisify(execFile);
const implementationVersion = '0.3.1';
const readonlyNames = { Read: ['ops_read_files', 'read'], Grep: ['ops_grep', 'grep'], Glob: ['ops_glob', 'glob'] };
const runtimeTimeoutMs = 120000;
const maxTaskChars = 8192;
const maxOutputTokens = 2048;

async function plannerSource(config) {
  if (!isAbsolute(config.eccRoot ?? '')) throw new Error('eccRoot must be absolute');
  const root = await realpath(config.eccRoot);
  let revision = null;
  try { revision = (await exec('git', ['rev-parse', 'HEAD'], { cwd: root, timeout: 10000 })).stdout.trim(); }
  catch (error) { if (error.code !== 128) throw error; }
  if (config.expectedRevision) {
    if (revision !== config.expectedRevision) throw new Error(`ECC revision mismatch: expected ${config.expectedRevision}, received ${revision}`);
    const { stdout } = await exec('git', ['status', '--porcelain=v1', '--untracked-files=normal'], { cwd: root, timeout: 10000, maxBuffer: 1048576 });
    if (stdout.trim()) throw new Error('ECC source is dirty; planner activation requires the reviewed source');
  }
  const path = join(root, 'agents/planner.md');
  const { metadata, content } = splitFrontmatter(await readFile(path, 'utf8'));
  const requested = Array.isArray(metadata.tools) ? metadata.tools : String(metadata.tools ?? '').split(',').map(name => name.trim());
  if (metadata.name !== 'planner' || requested.length !== 3 || !Object.keys(readonlyNames).every(name => requested.includes(name)) || !content.trim()) throw new Error('Planner must preserve the read-only Read, Grep, Glob source contract');
  return { content, source: { path, revision, pinned: Boolean(config.expectedRevision), modelAlias: metadata.model ?? null } };
}

function waitForTools(owner, view, scope, allowed, signal, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = error => {
      if (settled) return;
      settled = true;
      stop(); clearTimeout(timer); signal.removeEventListener('abort', onAbort);
      if (error) reject(error); else resolve();
    };
    const onAbort = () => finish(signal.reason ?? new Error('Planner cancelled'));
    const check = () => {
      if (signal.aborted) onAbort();
      else if (allowed.every(name => view.tools.get(name, scope))) finish();
    };
    const stop = owner.on('tools/change', check);
    const timer = setTimeout(() => finish(new Error('Planner tool readiness timed out in the exact child scope')), timeoutMs);
    signal.addEventListener('abort', onAbort, { once: true });
    check();
  });
}

function cancellable(result, signal) {
  return new Promise((resolve, reject) => {
    const onAbort = () => { signal.removeEventListener('abort', onAbort); reject(signal.reason ?? new Error('Planner cancelled')); };
    signal.addEventListener('abort', onAbort, { once: true });
    Promise.resolve(result).then(value => { signal.removeEventListener('abort', onAbort); resolve(value); }, error => { signal.removeEventListener('abort', onAbort); reject(error); });
    if (signal.aborted) onAbort();
  });
}

/** One parent-composed, native-only read-only planner; registration is not runtime proof. */
export async function registerPlanner(ctx, config) {
  const readinessTimeoutMs = config.readinessTimeoutMs ?? 5000;
  if (!Number.isFinite(readinessTimeoutMs) || readinessTimeoutMs <= 0 || readinessTimeoutMs > 30000) throw new Error('readinessTimeoutMs must be positive and at most 30000');
  const allowed = Object.entries(readonlyNames).map(([name, candidates]) => {
    const mapped = config.toolMap?.[name] ?? candidates[0];
    if (!candidates.includes(mapped)) throw new Error(`Unsafe read-only planner mapping for ${name}`);
    return mapped;
  });
  const { content, source } = await plannerSource(config);
  const active = new Map();
  let disposed = false, closing, unregister;
  const observe = agent => ({ implementationVersion, nativeScopeMatched: agent == null ? null : Boolean(agent.ctx && scopeOf(agent.ctx) === agent),
    status: disposed ? 'disposed' : 'registered', runtimeVerified: false, source: { ...source }, route: 'inherited-native', parity: 'partial',
    limits: { readinessTimeoutMs, runtimeTimeoutMs, maxTaskChars, maxOutputTokens },
    active: [...active.values()].filter(state => agent === undefined || state.parent === agent).map(state => ({ childId: state.childId, status: state.status })) });
  if (!ctx.tools || !ctx.systemPrompt || typeof ctx.subagents?.startActivation !== 'function' || typeof ctx.subagents.getProvider !== 'function') return { status: 'unsupported', tools: [], source, gaps: ['Native Tools, SystemPrompt and managed local subagents are required.'], disposers: [] };
  if (ctx.tools.get('ecc_planner', scopeOf(ctx))) return { status: 'collision', tools: [], source, gaps: ['Existing ecc_planner owner was preserved.'], disposers: [] };

  async function prepareChild(view, child, state) {
    const scope = scopeOf(view);
    if (scope !== child) throw new Error('Planner requires the exact native child scope');
    const allowedSet = new Set(allowed);
    view.tools.presentAs('native');
    view.tools.guard(execution => allowedSet.has(execution.name) ? undefined : `ECC planner read-only policy denies tool ${execution.name}`);
    view.on('system-prompt/assemble', async (_assembly, _context, next) => {
      const assembly = await next();
      return { ...assembly, tools: assembly.tools.filter(tool => allowedSet.has(tool.name)) };
    });
    await waitForTools(ctx, view, scope, allowed, state.controller.signal, readinessTimeoutMs);
    state.controller.signal.throwIfAborted();
    view.systemPrompt.section({ name: 'ecc-planner-persona', order: 0, interpolate: false, text: `${content}\n\n[ECC native planner pilot]\nRead-only planning only; never implement or delegate. The upstream ${source.modelAlias ?? 'unspecified'} model alias is metadata, not equivalence: native model/provider, permissions and instructions remain authoritative.` });
    state.status = 'running';
  }

  async function run(state, task, parent, signal, provider) {
    const onAbort = () => state.controller.abort(signal.reason ?? new Error('Planner cancelled'));
    signal.addEventListener('abort', onAbort, { once: true });
    const timeout = setTimeout(() => state.controller.abort(new Error('Planner runtime timed out after 120000 ms')), runtimeTimeoutMs);
    let activation, childFiber, setup;
    const stopCreated = ctx.on('agent/created', async event => {
      if (event.agent.id !== state.childId) return;
      state.status = 'awaiting-tools';
      childFiber = event.agent.ctx.plugin({ inject: ['tools', 'systemPrompt'], apply(view) {
        setup = prepareChild(view, event.agent, state);
        setup.catch(() => {}); // The awaited creation listener owns this failure.
      } });
      await childFiber.await();
      if (!setup) throw new Error('Native child dependencies did not activate the planner restrictions');
      await setup;
    });
    try {
      if (signal.aborted) onAbort();
      state.controller.signal.throwIfAborted();
      if (typeof ctx.subagents.resolveMaxDepth !== 'function') throw new Error('Planner requires the current native maxDepth policy');
      const maxDepth = ctx.subagents.resolveMaxDepth(undefined);
      if (!Number.isSafeInteger(maxDepth) || maxDepth < 0 || Object.is(maxDepth, -0)) throw new Error('Native planner maxDepth must be a non-negative safe integer');
      const parentLimit = parent.options?.maxTokens;
      const maxTokens = Number.isFinite(parentLimit) && parentLimit > 0 ? Math.min(parentLimit, maxOutputTokens) : maxOutputTokens;
      activation = await ctx.subagents.startActivation({ provider: 'spawn', label: 'ECC read-only planner', childId: state.childId, delivery: 'caller', signal: state.controller.signal,
        request: { parent, maxDepth, prompt: [{ type: 'text', text: task }], ...(provider.capabilities?.agentOptions ? { agentOptions: { maxTokens } } : {}) } });
      stopCreated();
      if (activation.childId !== state.childId || state.status !== 'running') throw new Error('Native activation did not compose the exact planner child before execution');
      const result = await cancellable(activation.result, state.controller.signal);
      state.controller.signal.throwIfAborted();
      if (result.stopReason !== 'completed') throw new Error(`Native planner ended with ${result.stopReason}; no complete plan was verified`);
      return { status: 'completed', childId: state.childId, source: { ...source }, route: 'inherited-native', parity: 'partial', stopReason: result.stopReason, output: result.output };
    } finally {
      stopCreated(); clearTimeout(timeout); signal.removeEventListener('abort', onAbort);
      try { await activation?.dispose(); }
      catch (error) { state.teardownError = error; throw error; }
      finally {
        try { await childFiber?.dispose(); }
        catch (error) { state.teardownError ??= error; throw error; }
        finally { active.delete(state.childId); }
      }
    }
  }

  async function start(args, execution) {
    if (disposed) throw new Error('Planner registration is disposed');
    if (!args || typeof args.task !== 'string' || !args.task.trim() || args.task.length > maxTaskChars || Object.keys(args).some(key => key !== 'task')) throw new Error('Planner requires only a non-empty task of at most 8192 characters');
    if (!execution?.agent?.ctx || !execution.signal) throw new Error('Planner requires a native calling agent and cancellation signal');
    const provider = ctx.subagents.getProvider('spawn');
    if (typeof provider?.prepareContinuable !== 'function') throw new Error('Planner requires the native local spawn provider; external backends are not allowed');
    if (provider.capabilities?.agentOptions !== true) throw new Error('Native spawn must support agentOptions.maxTokens for bounded planner output');
    const state = { childId: randomUUID(), parent: execution.agent, controller: new AbortController(), status: 'starting' };
    active.set(state.childId, state);
    state.done = run(state, args.task, execution.agent, execution.signal, provider);
    return state.done;
  }

  async function dispose() {
    if (!closing) {
      disposed = true; unregister?.();
      const states = [...active.values()];
      for (const state of states) state.controller.abort(new Error('Planner owner disposed'));
      closing = Promise.allSettled(states.map(state => state.done)).then(() => {
        const errors = states.map(state => state.teardownError).filter(Boolean);
        if (errors.length) throw new AggregateError(errors, 'Planner teardown failed');
      });
    }
    return closing;
  }
  unregister = ctx.tools.register({ name: 'ecc_planner', description: 'Produce a read-only implementation plan with the pinned ECC planner persona on the current native route. Does not implement, write, or call an external model.',
    parameters: { type: 'object', properties: { task: { type: 'string', minLength: 1, maxLength: maxTaskChars } }, required: ['task'], additionalProperties: false },
    output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    execute: (args, execution) => start(args, execution) });
  ctx.effect(() => dispose);
  return { status: 'registered', tools: ['ecc_planner'], source, route: 'inherited-native', parity: 'partial', runtimeVerified: false,
    gaps: ['Registration is not runtime verification; capability presence is not permission. Native host composition and policies remain authoritative.'], start, observe, disposers: [dispose] };
}
