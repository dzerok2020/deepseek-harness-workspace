import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access, lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { delimiter, isAbsolute, join, resolve, sep } from 'node:path';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { matcherDiagnostic, matchesMatcher, mergeHookOutputs, parseHookOutput } from '@deepseek-ai/dsh-hook-protocol';

const SUPPORTED = new Set(['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'Stop']);
const UNSUPPORTED = {
  PreCompact: 'DSH 0.2.1-rc.2 has no public awaited pre-compaction event.',
  SessionEnd: 'No public awaited session-end seam; Stop is a turn boundary, not SessionEnd.',
  PermissionRequest: 'The native ask decision is not a Claude permission-request lifecycle payload.',
  SubagentStart: 'Native subagent/start is observe-only and has no Claude agent_type.',
  SubagentStop: 'Native subagent/end is observe-only; it cannot enforce a blocking SubagentStop decision.',
  TaskCompleted: 'No public TaskCompleted lifecycle seam.',
};
const LIMIT = 1024 * 1024;
const ALIASES = { bash: 'Bash', read: 'Read', write: 'Write', edit: 'Edit' };
const SOURCE = { kind: 'ecc-hook' };
const blocked = (reason) => ({ exitCode: undefined, stdout: '', stderr: '', decision: 'deny', reason });
const context = (texts) => texts.length ? createUserMessage({ content: texts.map((text) => ({ type: 'text', text })), source: SOURCE }) : undefined;
const flatten = (blocks = []) => blocks.filter((block) => block.type === 'text').map((block) => block.text).join('');

async function findBwrap() {
  for (const directory of (process.env.PATH ?? '').split(delimiter).filter(Boolean)) {
    const candidate = resolve(directory, 'bwrap');
    try { await access(candidate, constants.X_OK); return await realpath(candidate); } catch { /* next PATH entry */ }
  }
}

function bwrapArgs(node, eccRoot, state) {
  return [
    '--unshare-all', '--die-with-parent', '--new-session', '--clearenv',
    '--ro-bind', '/usr', '/usr', '--ro-bind-try', '/lib', '/lib', '--ro-bind-try', '/lib64', '/lib64',
    '--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp', '--tmpfs', '/workspace',
    '--dir', '/opt', '--ro-bind', node, '/opt/node', '--ro-bind', eccRoot, '/ecc', '--bind', state, '/data',
    '--setenv', 'PATH', '/opt:/usr/bin', '--setenv', 'HOME', '/data/home',
    '--setenv', 'CLAUDE_PLUGIN_ROOT', '/ecc', '--setenv', 'CLAUDE_PROJECT_DIR', '/workspace',
    '--setenv', 'CLAUDE_CONFIG_DIR', '/data/config', '--setenv', 'XDG_CONFIG_HOME', '/data/config',
    '--setenv', 'XDG_CACHE_HOME', '/data/cache', '--setenv', 'ECC_SKIP_LLM_SUMMARY', '1',
    '--setenv', 'ECC_SKIP_OBSERVE', '1', '--setenv', 'CLV2_CONFIG', '/data/config/continuous-learning-v2/config.json',
    '--setenv', 'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC', '1',
    '--setenv', 'CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL', '1',
    '--remount-ro', '/', '--chdir', '/workspace', '--', '/usr/bin/sh', '-c',
  ];
}

// This runner never delegates to ctx.shell: a hook subprocess does not inherit
// DSH's tool guard. Only the independently probed bwrap boundary may launch it.
function contained(binary, args, command, payload, timeoutMs, signal) {
  return new Promise((done) => {
    if (signal?.aborted) return done(blocked('ECC hook cancelled before execution.'));
    let stdout = '', stderr = '', failure;
    let child;
    const kill = (reason) => {
      failure ??= reason;
      // Killing the sandbox PID 1 tears down all descendants, including async
      // children; an external process group also catches the bwrap supervisor.
      if (child?.pid) { try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } }
    };
    try {
      child = spawn(binary, [...args, command], { stdio: ['pipe', 'pipe', 'pipe'], detached: true, env: {} });
    } catch (error) { done(blocked(`ECC containment spawn failed: ${error.message}`)); return; }
    const timer = setTimeout(() => kill(`ECC hook timeout after ${timeoutMs}ms.`), timeoutMs);
    const abort = () => kill('ECC hook cancelled.');
    signal?.addEventListener('abort', abort, { once: true });
    const collect = (which, chunk) => {
      if (which === 'stdout') stdout += chunk; else stderr += chunk;
      if (Buffer.byteLength(stdout) + Buffer.byteLength(stderr) > LIMIT) kill('ECC hook output exceeded 1 MiB.');
    };
    child.stdout.setEncoding('utf8').on('data', (chunk) => collect('stdout', chunk));
    child.stderr.setEncoding('utf8').on('data', (chunk) => collect('stderr', chunk));
    child.stdin.on('error', () => {});
    child.once('error', (error) => { failure = `ECC containment spawn failed: ${error.message}`; });
    child.once('close', (code) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (failure) return done(blocked(failure));
      if (code !== 0 && code !== 2) return done(blocked(`ECC hook failed with exit ${code}: ${stderr.trim().slice(0, 500)}`));
      if (code === 0 && stdout.trim().startsWith('{')) {
        try {
          const parsed = JSON.parse(stdout);
          if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error('not an object');
          const specific = parsed.hookSpecificOutput;
          if (specific && specific.hookEventName !== payload.hook_event_name) return done(blocked('ECC hook-specific output event mismatch.'));
        } catch { return done(blocked('ECC hook returned invalid JSON.')); }
      }
      const output = parseHookOutput(code ?? undefined, stdout, stderr, payload.hook_event_name);
      if (output.updatedInput !== undefined) return done(blocked('updatedInput unsupported: native DSH arguments are already logged and immutable.'));
      // Claude plain stdout is context only at admission/start, not a decision.
      if (!stdout.trim().startsWith('{') && code === 0 && ['SessionStart', 'UserPromptSubmit'].includes(payload.hook_event_name) && stdout.trim()) output.additionalContext = stdout.trim();
      done(output);
    });
    child.stdin.end(`${JSON.stringify(payload)}\n`);
    if (signal?.aborted) abort();
  });
}

/**
 * Register the pinned ECC command-hook dialect against public native DSH events.
 * No hooks execute until an actual event is delivered. Project/transcript access
 * is deliberately unavailable: only ECC (RO) and adapter hook state (RW) mount.
 */
export async function registerHooks(ctx, { eccRoot, dataRoot, enableHooks = false, hookManifest }) {
  const gaps = [];
  const hooks = [];
  const disposers = [];
  const groupsByEvent = new Map();
  const preflights = new WeakMap();
  let admissionBlocked;
  if (enableHooks) {
    if (typeof ctx.tools?.guard !== 'function') throw new Error('ECC hooks require the public monotonic tools.guard seam.');
    // Native guards run after the entire waterfall, so an outer listener cannot
    // promote an ECC denial (or bypassed async preflight) into an allowed call.
    disposers.push(ctx.tools.guard((exec) => {
      if (admissionBlocked) return admissionBlocked;
      if (!groupsByEvent.has('PreToolUse')) return;
      const preflight = preflights.get(exec);
      return preflight ? preflight.reason : 'ECC PreToolUse preflight was bypassed.';
    }));
  }
  let config;
  try {
    config = (hookManifest ?? JSON.parse(await readFile(join(eccRoot, 'hooks/hooks.json'), 'utf8'))).hooks;
    if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('hooks must be an object');
  } catch (error) {
    gaps.push(`ECC hook configuration unavailable: ${error.message}`);
    if (!enableHooks) return { hooks, status: 'disabled', gaps, disposers };
    admissionBlocked = gaps[0];
    disposers.push(ctx.on('tools/pre-execute', async () => ({ kind: 'deny', reason: admissionBlocked })));
    return { hooks, status: 'blocked', gaps, disposers };
  }
  for (const [event, groups] of Object.entries(config)) {
    const record = { event, status: enableHooks ? 'degraded' : 'disabled', commandCount: 0 };
    hooks.push(record);
    if (!enableHooks) { record.reason = 'enableHooks is false; no subprocess or event registration.'; continue; }
    if (!SUPPORTED.has(event)) {
      record.status = 'unsupported';
      record.reason = UNSUPPORTED[event] ?? 'No native DSH public event mapping.';
      gaps.push(`${event}: ${record.reason}`);
      continue;
    }
    record.reason = 'Contained commands only; no host project, HOME, transcript or model access.';
    const accepted = [];
    if (!Array.isArray(groups)) {
      record.status = 'unavailable';
      record.reason = `${event}: matcher groups must be an array.`;
      gaps.push(record.reason);
      groupsByEvent.set(event, [{ hooks: [{ error: record.reason }] }]);
      continue;
    }
    for (const group of groups) {
      const diagnostic = matcherDiagnostic(group?.matcher, 'claude-code');
      if (diagnostic || !group || typeof group !== 'object' || !Array.isArray(group.hooks)) {
        gaps.push(`${event}: disabled invalid matcher/group: ${diagnostic ?? 'hooks must be an array'}`);
        continue;
      }
      const commands = group.hooks.map((hook) => {
        record.commandCount++;
        let error;
        if (hook?.type !== 'command' || typeof hook.command !== 'string' || !hook.command.trim()) error = `${event}: unsupported command type ${hook?.type ?? '(missing)'}.`;
        else if (hook.timeout !== undefined && (!Number.isFinite(hook.timeout) || hook.timeout <= 0)) error = `${event}: invalid timeout.`;
        else if (hook.async !== undefined && typeof hook.async !== 'boolean') error = `${event}: invalid async flag.`;
        if (error) { gaps.push(error); record.status = 'unavailable'; return { error }; }
        if (hook.async) gaps.push(`${event}: async output is observational only; late decisions cannot veto an admitted operation.`);
        return { command: hook.command, async: hook.async === true, timeoutMs: Math.min((hook.timeout ?? 60) * 1000, 60000) };
      });
      accepted.push({ matcher: group.matcher, hooks: commands });
    }
    groupsByEvent.set(event, accepted);
  }
  if (!enableHooks) return { hooks, status: 'disabled', gaps, disposers };

  gaps.push('Host project and HOME are not mounted; project-dependent hook behavior is unavailable, not upstream parity.');
  gaps.push('transcript_path is empty: no Claude JSONL transcript seam; host transcripts are never mounted.');
  gaps.push('updatedInput is unsupported by the immutable native PreToolDecision; emitted rewrites fail closed.');
  gaps.push('PreToolUse additionalContext is queued for the next native pre-step, not retroactively added to the completed tool-selection request.');
  gaps.push('systemMessage is model context, not a native user-visible notification.');
  let binary, args;
  try {
    binary = await findBwrap();
    if (!binary) throw new Error('bwrap not found in PATH');
    if (!isAbsolute(eccRoot) || !isAbsolute(dataRoot)) throw new Error('eccRoot and dataRoot must be absolute');
    const root = await realpath(eccRoot);
    await mkdir(dataRoot, { recursive: true, mode: 0o700 });
    const data = await realpath(dataRoot);
    if ((await lstat(dataRoot)).isSymbolicLink() || data === sep || root === data || root.startsWith(data + sep) || data.startsWith(root + sep)) throw new Error('ECC and data roots must be separate directories without a data symlink');
    const state = join(data, 'hooks-state');
    await mkdir(state, { recursive: true, mode: 0o700 });
    if ((await lstat(state)).isSymbolicLink()) throw new Error('hook state cannot be a symlink');
    for (const directory of ['home', 'config', 'config/continuous-learning-v2', 'cache']) {
      const target = join(state, directory);
      await mkdir(target, { recursive: true, mode: 0o700 });
      if ((await lstat(target)).isSymbolicLink()) throw new Error('hook state directories cannot be symlinks');
    }
    await writeFile(join(state, 'config/continuous-learning-v2/config.json'), JSON.stringify({ observer: { enabled: false } }), { mode: 0o600, flag: constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW });
    args = bwrapArgs(await realpath(process.execPath), root, state);
    const probe = await contained(binary, args, '/usr/bin/true', { hook_event_name: 'containment-probe' }, 2000);
    if (probe.decision === 'deny' || probe.decision === 'block') throw new Error(probe.reason ?? 'bwrap probe failed');
  } catch (error) {
    const reason = `ECC containment unavailable; hooks fail closed: ${error.message}`;
    gaps.push(reason);
    for (const record of hooks) if (record.status !== 'unsupported') { record.status = 'unavailable'; record.reason = reason; }
    admissionBlocked = reason;
    disposers.push(ctx.on('tools/pre-execute', async () => ({ kind: 'deny', reason })));
    return { hooks, status: 'blocked', gaps, disposers };
  }

  const owner = new AbortController();
  const pending = new Set();
  let disposed = false;
  const track = (promise) => { pending.add(promise); promise.then(() => pending.delete(promise), () => pending.delete(promise)); return promise; };
  const shutdown = async () => { if (disposed) return; disposed = true; owner.abort(); await Promise.allSettled([...pending]); };
  disposers.push(shutdown);
  ctx.effect(() => shutdown);
  const base = (agent, event) => ({ session_id: agent?.session?.header?.id ?? '', cwd: agent?.session?.header?.cwd ?? '', transcript_path: '', hook_event_name: event });
  const messageFrom = (outcome) => context([...outcome.additionalContext, ...outcome.systemMessages]);
  const run = async (event, query, payload, signal, agent) => {
    const outputs = [];
    for (const group of groupsByEvent.get(event) ?? []) {
      if (!matchesMatcher(group.matcher, query, 'claude-code')) continue;
      for (const hook of group.hooks) {
        if (hook.error) { outputs.push(blocked(hook.error)); continue; }
        const combined = signal ? AbortSignal.any([owner.signal, signal]) : owner.signal;
        const promise = track(contained(binary, args, hook.command, payload, hook.timeoutMs, combined));
        if (hook.async) {
          track(promise.then((output) => {
            if (disposed || combined.aborted) return;
            const merged = mergeHookOutputs([output]);
            const message = messageFrom(merged);
            if (message && agent?.inject) agent.inject(message);
            if (merged.decision === 'deny' || merged.decision === 'ask' || merged.stop) gaps.push(`${event}: async decision/stop cannot apply after admission: ${merged.reason ?? merged.stopReason ?? merged.decision}`);
          }));
        } else outputs.push(await promise);
      }
    }
    return mergeHookOutputs(outputs);
  };
  const add = (event, handler) => disposers.push(ctx.on(event, handler));
  if (groupsByEvent.has('SessionStart')) add('agent/created', async ({ agent, source, signal }) => {
    const outcome = await run('SessionStart', source, { ...base(agent, 'SessionStart'), source }, signal, agent);
    if (outcome.decision === 'deny' || outcome.decision === 'ask' || outcome.stop) throw new Error(outcome.reason ?? outcome.stopReason ?? 'ECC SessionStart blocked.');
    const message = messageFrom(outcome);
    if (message) agent.inject(message);
  });
  if (groupsByEvent.has('UserPromptSubmit')) add('agent/pre-step', async ({ agent, messages, signal }, next) => {
    // Injected hook context is not a second user prompt.
    const prompts = messages.filter((message) => message.source?.kind !== SOURCE.kind);
    if (!prompts.length) return next();
    const outcome = await run('UserPromptSubmit', '', { ...base(agent, 'UserPromptSubmit'), prompt: flatten(prompts.flatMap((message) => message.content)) }, signal, agent);
    if (outcome.decision === 'deny' || outcome.decision === 'ask' || outcome.stop) return { kind: 'reject' };
    const downstream = await next();
    const message = messageFrom(outcome);
    return message && downstream.kind === 'enter' ? { ...downstream, messages: [...downstream.messages, message] } : downstream;
  });
  const toolPayload = (exec, event) => ({ ...base(exec.agent, event), tool_name: ALIASES[exec.name] ?? exec.name, tool_input: exec.arguments, tool_use_id: exec.callId });
  if (groupsByEvent.has('PreToolUse')) add('tools/pre-execute', async (exec, next) => {
    const preflight = { reason: 'ECC PreToolUse preflight has not completed.' };
    preflights.set(exec, preflight);
    const payload = toolPayload(exec, 'PreToolUse');
    const outcome = await run('PreToolUse', payload.tool_name, payload, exec.signal, exec.agent);
    if (outcome.decision === 'deny' || outcome.stop) {
      preflight.reason = outcome.reason ?? outcome.stopReason ?? 'ECC PreToolUse blocked.';
      return { kind: 'deny', reason: preflight.reason };
    }
    const downstream = await next();
    if (downstream.kind !== 'allow') { preflight.reason = undefined; return downstream; }
    const message = messageFrom(outcome);
    if (message) {
      if (!exec.agent?.inject) {
        preflight.reason = 'ECC pre-tool context requires a native agent injection seam.';
        return { kind: 'deny', reason: preflight.reason };
      }
      exec.agent.inject(message);
    }
    preflight.reason = undefined;
    return outcome.decision === 'ask' ? { kind: 'ask', reason: outcome.reason ?? 'ECC hook requests approval.' } : downstream;
  });
  if (groupsByEvent.has('PostToolUse') || groupsByEvent.has('PostToolUseFailure')) add('tools/post-execute', async (exec, result, next) => {
    const event = result.isError ? 'PostToolUseFailure' : 'PostToolUse';
    const payload = { ...toolPayload(exec, event), ...(result.isError ? { error: result.error?.message ?? flatten(result.content) } : { tool_response: result.value ?? flatten(result.content) }) };
    const outcome = await run(event, payload.tool_name, payload, exec.signal, exec.agent);
    const downstream = await next();
    const message = messageFrom(outcome);
    const additionalContexts = [...(downstream.additionalContexts ?? []), ...(message ? [message] : [])];
    if (outcome.decision === 'deny' || outcome.decision === 'ask' || outcome.stop) return { kind: 'block', feedback: [{ type: 'text', text: outcome.reason ?? outcome.stopReason ?? 'ECC post-tool hook blocked.' }], additionalContexts };
    return additionalContexts.length ? { ...downstream, additionalContexts } : downstream;
  });
  const stopTurns = new WeakMap();
  if (groupsByEvent.has('Stop')) add('agent/turn-stopping', async ({ agent, turn, signal }) => {
    const reentry = stopTurns.has(agent) && stopTurns.get(agent) === turn;
    stopTurns.set(agent, turn);
    const outcome = await run('Stop', '', { ...base(agent, 'Stop'), stop_hook_active: reentry }, signal, agent);
    const message = messageFrom(outcome);
    if (message) agent.inject(message);
    if (!outcome.stop && (outcome.decision === 'deny' || outcome.decision === 'ask')) agent.steer(context([outcome.reason ?? 'ECC Stop hook requests continuation.']));
  });
  gaps.splice(0, gaps.length, ...new Set(gaps));
  return { hooks, status: 'partial', gaps, disposers };
}
