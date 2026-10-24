/**
 * G6 — append guard plugin wiring.
 *
 * Policy lives in ./policy.js (pure). This file only connects it to DSH seams:
 *   - `tools/post-execute`  : watch memory mutations + count tool usage
 *   - `agent/turn-stopping` : remind the agent (once per turn) when it broke
 *                             append-only, keeping the KV-cache prefix intact
 *
 * `deferLoading` is a HOST-side hint on a tool declaration, so this plugin
 * cannot switch it on by itself — it only *suggests* which rarely used tools
 * the host could defer. See deferSuggestions() in ./policy.js.
 */

import { createUserMessage } from '@deepseek-ai/dsh-llm';
import {
  compileAppendConfig,
  createAppendState,
  diffOutline,
  isGuardedMutation,
  noteToolUse,
  noteViolation,
  resetAppendTurn,
  appendVerdict,
} from './policy.js';

export const name = 'dsh-append-guard';
export const inject = ['tools'];

const SOURCE = Object.freeze({
  kind: 'append-guard',
  form: 'notice',
  summary: 'append-only memory rule',
});

/**
 * Read the text payload of a tool result.
 *
 * Lesson from G4: DSH puts tool payloads in `output` (or a nested
 * `result.output`), NOT in `content`. Reading only `content` silently makes
 * every guard blind.
 */
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
  if (typeof message.output === 'string') return message.output;
  if (typeof message.text === 'string') return message.text;
  const nested = message.result;
  if (nested !== null && typeof nested === 'object' && typeof nested.output === 'string') return nested.output;
  return '';
}

/** Read the memory outline out of a tool result, if the tool reported one. */
function outlineOf(message) {
  if (message !== null && typeof message === 'object') {
    if (Array.isArray(message.entries)) return message.entries;
    const nested = message.result;
    if (nested !== null && typeof nested === 'object' && Array.isArray(nested.entries)) return nested.entries;
  }
  const text = textOf(message);
  if (text.length === 0) return undefined;
  try {
    const parsed = JSON.parse(text);
    if (parsed !== null && typeof parsed === 'object' && Array.isArray(parsed.entries)) return parsed.entries;
  } catch {
    // Not JSON — no outline to compare against.
  }
  return undefined;
}

/** An explicit `append: "intentional"` acknowledges the mutation for one call. */
function declaredIntentional(exec) {
  const args = exec?.args;
  if (args === null || typeof args !== 'object') return false;
  const flag = args.append ?? args.intent ?? args.mode;
  return flag === 'intentional' || flag === 'append';
}

export function apply(ctx, rawConfig) {
  const env = typeof process === 'object' && process !== null ? process.env : undefined;
  const off = env !== undefined && env.DSH_APPEND_GUARD === 'off';
  const cfg = compileAppendConfig({ ...(rawConfig ?? {}), ...(off ? { enabled: false } : {}) });
  if (!cfg.enabled) return;

  const fallback = createAppendState();
  const perAgent = new WeakMap();
  const suggested = new Set();

  function stateFor(agent) {
    if (agent === null || agent === undefined || (typeof agent !== 'object' && typeof agent !== 'function')) {
      return fallback;
    }
    let state = perAgent.get(agent);
    if (state === undefined) {
      state = createAppendState();
      perAgent.set(agent, state);
    }
    return state;
  }

  ctx.on('tools/post-execute', async (exec, result, next) => {
    const downstream = await next();
    const toolName = exec?.name ?? exec?.toolName;
    if (typeof toolName !== 'string' || toolName.length === 0) return downstream;

    const state = stateFor(exec?.agent);

    // Rarity heuristic: every call counts, so `deferSuggestions` can name the
    // tools the host should defer.
    noteToolUse(state, toolName);

    if (!isGuardedMutation(toolName, cfg)) return downstream;
    if (result?.ok === false || result?.isError === true) return downstream;
    if (exec?.result?.ok === false || exec?.result?.isError === true) return downstream;
    if (declaredIntentional(exec)) return downstream;

    const after = outlineOf(result) ?? outlineOf(exec?.result);
    if (after === undefined) return downstream;

    const before = Array.isArray(state.before) ? state.before : [];
    if (before.length === 0) {
      // First observation of this turn: remember the outline, nothing to judge yet.
      state.before = after.map((entry) => ({ ...entry }));
      return downstream;
    }

    const diff = diffOutline(before, after);
    if (diff.action !== 'append') {
      noteViolation(state, { tool: toolName, action: diff.action, moved: diff.moved });
    }
    state.before = after.map((entry) => ({ ...entry }));
    return downstream;
  });

  ctx.on('agent/turn-stopping', async (payload) => {
    const agent = payload?.agent;
    if (agent === null || agent === undefined) return;

    const state = stateFor(agent);
    const verdict = appendVerdict(state, cfg);

    if (verdict.action === 'ok') {
      resetAppendTurn(state);
      return;
    }

    state.refusals += 1;

    // One-shot hint about deferred loading; the host decides, we only report.
    const rare = Object.entries(state.toolUses ?? {})
      .filter(([toolName, count]) => !cfg.neverDefer.includes(toolName) && count <= cfg.rareToolUses)
      .map(([toolName]) => toolName);
    for (const toolName of rare) suggested.add(toolName);

    const text =
      rare.length > 0
        ? `${verdict.message}\n\nRarely used this session (candidates for \`deferLoading: true\`): ${rare.slice(0, 5).join(', ')}.`
        : verdict.message;

    agent.steer(
      createUserMessage({
        content: [{ type: 'text', text }],
        source: SOURCE,
      }),
    );

    resetAppendTurn(state);
  });
}
