import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { openSync, fstatSync, readFileSync, closeSync, constants } from 'node:fs';
import { resolve } from 'node:path';
import { registerTodoProgress } from './todo-progress.js';
import {
  compileConfig,
  classifyCall,
  findIrreversible,
  createState,
  noteCall,
  noteFailedVerify,
  noteDenial,
  noteForced,
  shouldForceVerify,
  buildGateMessage,
  irreversibleDenial,
  detectUnverifiedClaim,
  noteClaimBlocked,
  buildClaimGateMessage,
} from './policy.js';

export const name = 'dsh-vibe-guard';
export const inject = ['tools', 'sessionProjections', 'agents'];

const SOURCE = Object.freeze({
  kind: 'vibe-guard',
  form: 'notice',
  summary: 'vibe-guard verification gate',
});

// Inspect scripts without executing them; reject devices/FIFOs and oversized inputs.
function inspectedCall(exec) {
  const args = exec.arguments ?? exec.args;
  if (!args || typeof args !== 'object' || !args.script_path) return exec;
  if (typeof args.script_path !== 'string') throw new Error('script_path must be a string');
  const cwd = exec.agent?.session?.header?.cwd ?? process.cwd();
  const workdir = resolve(cwd, args.workdir || '.');
  const path = resolve(workdir, args.script_path);
  let fd;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK);
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > 1024 * 1024) throw new Error('script must be a regular file under 1 MiB');
    const script = readFileSync(fd, 'utf8');
    return { ...exec, arguments: { ...args, script_path: undefined, command: [args.command, script].filter(Boolean).join('\n') } };
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function failed(result) {
  if (result === null || typeof result !== 'object') return false;
  if (result.isError === true || result.error != null || result.failure != null) return true;
  if (result.kind === 'background' || result.kind === 'promoted') return true;
  if (result.status !== undefined && result.status !== 'completed') return true;
  if (result.kind === 'foreground' && (result.status !== 'completed' || result.exitCode !== 0)) return true;
  if (result.exitCode !== undefined && result.exitCode !== 0) return true;
  return Boolean(result.signal || result.aborted || result.timedOut || result.cancelled);
}

// Flatten the text blocks of a committed assistant message into one string.
function textOf(message) {
  if (message === null || typeof message !== 'object') return '';
  const content = Array.isArray(message.content) ? message.content : [];
  const parts = [];
  for (const block of content) {
    if (block !== null && typeof block === 'object' && typeof block.text === 'string') {
      parts.push(block.text);
    }
  }
  return parts.join('\n').trim();
}

export function apply(ctx, rawConfig) {
  const env = typeof process === 'object' && process !== null ? process.env : undefined;
  const off = env !== undefined && env.DSH_VIBE_GUARD === 'off';
  const cfg = compileConfig({ ...(rawConfig ?? {}), ...(off ? { enabled: false } : {}) });
  if (!cfg.enabled) return;

  registerTodoProgress(ctx);

  const fallback = createState();
  const perAgent = new WeakMap();

  function stateFor(agent) {
    if (agent === null || typeof agent !== 'object') return fallback;
    let state = perAgent.get(agent);
    if (state === undefined) {
      state = createState();
      perAgent.set(agent, state);
    }
    return state;
  }

  if (cfg.irreversibleGate) {
    ctx.tools.guard((exec) => {
      let inspected;
      try { inspected = inspectedCall(exec); }
      catch { return '[vibe-guard] Cannot safely inspect script_path; use an explicit readable regular script.'; }
      const hit = findIrreversible(inspected, cfg);
      if (hit === null) return undefined;
      noteDenial(stateFor(exec.agent), hit);
      return irreversibleDenial(hit);
    });
  }

  ctx.on('tools/post-execute', async (exec, result, next) => {
    const downstream = await next();
    const state = stateFor(exec.agent);
    let inspected;
    try { inspected = inspectedCall(exec); } catch { inspected = exec; }
    const verdict = classifyCall(inspected, cfg);
    const blocked = downstream !== null && typeof downstream === 'object' && downstream.kind === 'block';
    const value = result?.value;
    const opsShell = exec.name === 'ops_bash';
    const ok = !failed(result) && !failed(value) && !blocked && (!opsShell ||
      (value?.kind === 'foreground' && value.status === 'completed' && value.exitCode === 0));
    // A downstream block means nothing ran, unlike a shell command that ran then failed.
    noteCall(state, blocked ? { ...verdict, mayEditOnFailure: false } : verdict, ok);
    if (verdict.kind === 'verify' && !ok) noteFailedVerify(state, verdict);
    return downstream;
  });

  if (cfg.verifyGate) {
    ctx.on('agent/turn-stopping', async (payload) => {
      const agent = payload === null || typeof payload !== 'object' ? undefined : payload.agent;
      if (agent === undefined || agent === null || typeof agent.steer !== 'function') return;
      const state = stateFor(agent);
      const info = shouldForceVerify(state, cfg);
      if (info === null) return;
      noteForced(state);
      const text = buildGateMessage(info, cfg);
      agent.steer(createUserMessage({
        content: [{ type: 'text', text }],
        source: SOURCE,
      }));
    });
  }

  // Claim gate: block "done / fixed / tests pass" wording when the turn has
  // unverified edits. Subscribes to the committed assistant message so the check
  // sees the full text of what the model actually said.
  if (cfg.claimGate) {
    ctx.on('session/event', (session, event) => {
      if (event === null || typeof event !== 'object') return;
      if (event.type !== 'assistant/message') return;
      const text = textOf(event.data?.message);
      if (text.length === 0 || typeof session?.id !== 'string') return;
      // The live registry keys agents by the shared agent/session id. Sessions do not own agents.
      const agent = ctx.agents?.get(session.id);
      if (!agent || agent.id !== session.id || typeof agent.steer !== 'function') return;
      const state = stateFor(agent);
      const info = detectUnverifiedClaim(text, state, cfg);
      if (info === null || shouldForceVerify(state, { ...cfg, verifyGate: true }) === null) return;
      noteClaimBlocked(state, info);
      noteForced(state);
      const notice = buildClaimGateMessage(info, cfg);
      agent.steer(createUserMessage({
        content: [{ type: 'text', text: notice }],
        source: SOURCE,
      }));
    });
  }
}
