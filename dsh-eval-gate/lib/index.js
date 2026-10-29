/**
 * G4 — eval gate plugin wiring.
 *
 * Policy lives in ./policy.js (pure). This file only connects it to DSH seams:
 *   - `tools/post-execute`  : watch file edits + sentinel test runs
 *   - `agent/turn-stopping` : refuse to end a turn that changed files without sentinels
 */

import { createUserMessage } from '@deepseek-ai/dsh-llm';
import {
  compileEvalConfig,
  createEvalState,
  noteChange,
  noteSentinel,
  evalVerdict,
  buildEvalGateMessage,
  resetTurn,
} from './policy.js';

export const name = 'dsh-eval-gate';
export const inject = ['tools'];

const SOURCE = Object.freeze({
  kind: 'eval-gate',
  form: 'notice',
  summary: 'eval-gate sentinel requirement',
});

const WRITE_TOOLS = new Set(['write', 'edit', 'apply_patch', 'str_replace_editor']);

function textOf(message) {
  if (message === null || typeof message !== 'object') return '';
  const content = message.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const parts = [];
    for (const part of content) {
      if (typeof part === 'string') parts.push(part);
      else if (part !== null && typeof part === 'object' && typeof part.text === 'string') parts.push(part.text);
    }
    if (parts.length > 0) return parts.join('\n');
  }
  // Tool results in DSH carry their payload in `output` (or a nested `result`),
  // not in `content`. Without this the gate can never see a real bash run.
  if (typeof message.output === 'string') return message.output;
  if (typeof message.text === 'string') return message.text;
  const nested = message.result;
  if (nested !== null && typeof nested === 'object' && typeof nested.output === 'string') return nested.output;
  return '';
}

/** Extract a file path from whichever tool argument shape was used. */
function filePathOf(exec) {
  const args = exec?.arguments;
  if (args === null || typeof args !== 'object') return undefined;
  const candidate = args.path ?? args.file_path ?? args.filePath ?? args.target;
  return typeof candidate === 'string' ? candidate : undefined;
}

/**
 * Recognise a sentinel-bearing test output.
 * Convention: the runner's exit code decides pass/fail; the test name carries
 * the marker `must-change:` or `must-keep:` so the gate knows which half of the
 * pair was demonstrated. `intent` is what the agent declared when it ran it.
 */
function sentinelsIn(text) {
  const found = [];
  if (typeof text !== 'string' || text.length === 0) return found;
  const lines = text.split('\n');
  for (const line of lines) {
    for (const kind of ['must-change', 'must-keep']) {
      const marker = `${kind}:`;
      const at = line.indexOf(marker);
      if (at === -1) continue;
      const name = line.slice(at + marker.length).split(/[|\u2502]/)[0].trim();
      found.push({ name: name.length > 0 ? name : '(unnamed)', kind });
    }
  }
  return found;
}

function declaredKind(exec) {
  const args = exec?.arguments;
  if (args === null || typeof args !== 'object') return undefined;
  const intent = args.sentinel ?? args.intent;
  if (intent === 'must-change' || intent === 'must-keep') return intent;
  return undefined;
}

export function apply(ctx, rawConfig) {
  const env = typeof process === 'object' && process !== null ? process.env : undefined;
  const off = env !== undefined && env.DSH_EVAL_GATE === 'off';
  const cfg = compileEvalConfig({ ...(rawConfig ?? {}), ...(off ? { enabled: false } : {}) });
  if (!cfg.enabled) return;

  const fallback = createEvalState();
  const perAgent = new WeakMap();

  function stateFor(agent) {
    if (agent === null || agent === undefined || (typeof agent !== 'object' && typeof agent !== 'function')) {
      return fallback;
    }
    let state = perAgent.get(agent);
    if (state === undefined) {
      state = createEvalState();
      perAgent.set(agent, state);
    }
    return state;
  }

  ctx.on('tools/post-execute', async (exec, result, next) => {
    const downstream = await next();
    const toolName = exec?.name ?? exec?.toolName;

    if (WRITE_TOOLS.has(toolName)) {
      const state = stateFor(exec?.agent);
      const target = filePathOf(exec);
      if (target !== undefined) noteChange(state, target);
    }

    // A test run is the only evidence that counts for sentinels.
    const output = textOf(result) || textOf(exec?.result);
    const found = sentinelsIn(output);
    if (found.length > 0) {
      const state = stateFor(exec?.agent);
      const ok = result?.ok !== false && result?.isError !== true;
      const declared = declaredKind(exec);
      for (const item of found) {
        noteSentinel(state, { name: item.name, kind: declared ?? item.kind, ok });
      }
    }

    return downstream;
  });

  ctx.on('agent/turn-stopping', async (payload) => {
    const agent = payload?.agent;
    if (agent === null || agent === undefined) return;

    const state = stateFor(agent);
    const verdict = evalVerdict(state, cfg);
    if (verdict === null) {
      resetTurn(state);
      return;
    }

    state.refusals += 1;
    if (typeof agent.steer !== 'function') return;
    agent.steer(createUserMessage({
      content: [{ type: 'text', text: buildEvalGateMessage(verdict) }],
      source: SOURCE,
    }));
  });
}
