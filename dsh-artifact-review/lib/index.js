/**
 * G5 — artifact review plugin wiring.
 *
 * Policy lives in ./policy.js (pure). This file only connects it to DSH seams:
 *   - `tools/post-execute`  : watch render tools + vision passes
 *   - `agent/turn-stopping` : refuse to end a turn that claims an artifact is
 *                             ready without a review pass, and cap the ping-pong
 *
 * Why a turn hook and not a tool: the proposer can always declare victory, so the
 * only reliable place to insist on review is where the turn tries to end.
 */

import { createUserMessage } from '@deepseek-ai/dsh-llm';
import {
  compileReviewConfig,
  createReviewState,
  noteFinding,
  noteReviewed,
  reviewVerdict,
  buildReviewMessage,
  parseFindings,
  resetReviewTurn,
} from './policy.js';

export const name = 'dsh-artifact-review';
export const inject = ['tools'];

const SOURCE = Object.freeze({
  kind: 'artifact-review',
  form: 'notice',
  summary: 'artifact review required (different modality)',
});

/** Tools that produce an artifact someone must look at. */
const RENDER_TOOLS = new Set(['render_artifact', 'screenshot', 'render', 'export_slide', 'capture']);

/**
 * Pull text from a tool result. DSH carries the payload in `output` (or a nested
 * `result.output`), not only in `content` — reading just `content` silently
 * blinds the plugin. This is the exact defect that bit G4.
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

function toolNameOf(exec) {
  const raw = exec?.name ?? exec?.toolName;
  return typeof raw === 'string' ? raw : undefined;
}

/** True when this tool call is the configured vision pass. */
function isVisionCall(exec, cfg) {
  const toolName = toolNameOf(exec);
  if (toolName === undefined) return false;
  if (toolName === cfg.visionTool) return true;
  // Accept a family of names so a renamed vision tool still counts.
  return /(^|[_-])vision|read_image|describe_image|view_image/i.test(toolName);
}

export function apply(ctx, rawConfig) {
  const env = typeof process === 'object' && process !== null ? process.env : undefined;
  const off = env !== undefined && env.DSH_ARTIFACT_REVIEW === 'off';
  const cfg = compileReviewConfig({ ...(rawConfig ?? {}), ...(off ? { enabled: false } : {}) });
  if (!cfg.enabled) return;

  const fallback = createReviewState();
  const perAgent = new WeakMap();
  const seen = new WeakMap();

  function stateFor(agent) {
    if (agent === null || agent === undefined || (typeof agent !== 'object' && typeof agent !== 'function')) {
      return fallback;
    }
    let state = perAgent.get(agent);
    if (state === undefined) {
      state = createReviewState();
      perAgent.set(agent, state);
    }
    return state;
  }

  ctx.on('tools/post-execute', async (exec, result, next) => {
    const downstream = await next();
    const agent = exec?.agent;
    const state = stateFor(agent);

    // A render marks that there is now something to look at.
    if (RENDER_TOOLS.has(toolNameOf(exec))) {
      seen.set(state, true);
      return downstream;
    }

    if (isVisionCall(exec, cfg)) {
      // Looking counts even if the model reported "nothing wrong", but only when
      // the tool call itself did not fail.
      const failed = result?.ok === false || result?.isError === true;
      if (!failed) {
        noteReviewed(state);
        const findings = parseFindings(textOf(result) || textOf(exec?.result), state.rounds);
        for (const finding of findings) noteFinding(state, finding);
      }
      return downstream;
    }

    return downstream;
  });

  ctx.on('agent/turn-stopping', async (payload) => {
    const agent = payload?.agent;
    if (agent === null || agent === undefined) return;
    const state = stateFor(agent);

    // Nothing rendered this turn → nothing to review.
    if (seen.get(state) !== true) return;

    const verdict = reviewVerdict(state, cfg);
    if (verdict.action === 'accept') {
      resetReviewTurn(state);
      seen.delete(state);
      return;
    }
    // Exhausted the round ceiling: stop nudging and let the human decide.
    if (verdict.action === 'give-up') {
      resetReviewTurn(state);
      seen.delete(state);
      return;
    }

    state.refusals = (state.refusals ?? 0) + 1;
    const note = buildReviewMessage(verdict);
    if (typeof agent.steer === 'function') {
      agent.steer(
        createUserMessage({
          content: [{ type: 'text', text: note }],
          source: SOURCE,
        }),
      );
    }
  });
}
