import { registerTodoProgress } from './todo-progress.js';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
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
} from './policy.js';

export const name = 'dsh-vibe-guard';
export const inject = ['tools', 'sessionProjections'];

const SOURCE = Object.freeze({
  kind: 'vibe-guard',
  form: 'notice',
  summary: 'vibe-guard verification gate',
});

function failed(result) {
  if (result === null || typeof result !== 'object') return false;
  if (result.isError === true) return true;
  return result.error !== undefined && result.error !== null;
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
      const hit = findIrreversible(exec, cfg);
      if (hit === null) return undefined;
      noteDenial(stateFor(exec.agent), hit);
      return irreversibleDenial(hit);
    });
  }

  ctx.on('tools/post-execute', async (exec, result, next) => {
    const downstream = await next();
    const state = stateFor(exec.agent);
    const verdict = classifyCall(exec, cfg);
    const blocked = downstream !== null && typeof downstream === 'object' && downstream.kind === 'block';
    const ok = !failed(result) && !blocked;
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
}
