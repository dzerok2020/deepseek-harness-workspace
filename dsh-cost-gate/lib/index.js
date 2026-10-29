// dsh-cost-gate — điểm vào plugin.
//
// Usage thresholds are warnings, not task completion evidence.
// Only proven serial tool failures are gated; the agent turn stays open.
//
// Không import package nào của DSH: chỉ dùng hook chung, tránh lỗi phân giải
// module khi chạy từ workspace (giống dsh-loop-guard).
//
// Tắt tạm: DSH_COST_GATE=off. Không dùng cost-gate-allow để bỏ qua quyền host.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  DEFAULT_LIMITS,
  applyUsage,
  createSession,
  evaluate,
  hitRate,
  missWarning,
  resetTurn,
} from './policy.js';

export const name = 'dsh-cost-gate';

// Không phụ thuộc service nào: hai hook đều là event chung.
export const inject = [];

const OFF_VALUES = new Set(['off', '0', 'false', 'no', 'tắt', 'tat']);
const STATUS_FILENAME = 'cost-gate-status.json';
const ALLOW_FILENAME = 'cost-gate-allow';
const STATUS_MIN_INTERVAL_MS = 2000;
const MAX_SESSIONS = 20;
const REPEAT_FAILURE_LIMIT = 3;

// Canonical JSON makes object key order immaterial. Keep only hashes in memory.
function fingerprint(value) {
  try {
    const text = JSON.stringify(value, (_key, item) => {
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        return Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]]));
      }
      return item;
    });
    if (typeof text !== 'string' || text.length > 65_536) return undefined;
    return createHash('sha256').update(text).digest('hex');
  } catch {
    return undefined;
  }
}

function dshHome() {
  const explicit = process.env.DSH_HOME;
  if (typeof explicit === 'string' && explicit !== '') return explicit;
  const home = process.env.HOME ?? process.env.USERPROFILE ?? '';
  return join(home, '.dsh');
}

function isOff() {
  const raw = process.env.DSH_COST_GATE;
  return typeof raw === 'string' && OFF_VALUES.has(raw.trim().toLowerCase());
}

function allowed() {
  try {
    return existsSync(join(dshHome(), ALLOW_FILENAME));
  } catch {
    return false;
  }
}

function safeLogger(ctx) {
  const logger = ctx?.logger;
  return {
    info: (message) => {
      try {
        logger?.info?.(message);
      } catch {
        /* logger của host có thể đã đóng */
      }
    },
    warn: (message) => {
      try {
        logger?.warn?.(message);
      } catch {
        /* bỏ qua */
      }
    },
  };
}

/** @param {import('@deepseek-ai/cordis').Context} ctx */
export function apply(ctx, config = {}) {
  const limits = { ...DEFAULT_LIMITS, ...(config && typeof config === 'object' ? config : {}) };
  if (isOff()) return;

  const log = safeLogger(ctx);
  const sessions = new Map();
  let lastWrite = 0;
  let lastWarn = 0;

  const sessionOf = (sessionId) => {
    const key = String(sessionId ?? '');
    if (key === '') return undefined;
    let state = sessions.get(key);
    if (state === undefined) {
      state = createSession(key);
      sessions.set(key, state);
      if (sessions.size > MAX_SESSIONS) {
        const oldest = [...sessions.values()].sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))[0];
        if (oldest) sessions.delete(oldest.sessionId);
      }
    }
    return state;
  };

  const writeStatus = (force = false) => {
    const now = Date.now();
    if (!force && now - lastWrite < STATUS_MIN_INTERVAL_MS) return;
    lastWrite = now;
    try {
      const payload = {
        updatedAt: new Date(now).toISOString(),
        limits,
        allowed: allowed(),
        sessions: Object.fromEntries(
          [...sessions.entries()].map(([id, s]) => [
            id,
            {
              turn: s.turn,
              steps: s.steps,
              inputTokens: s.inputTokens,
              fresh: s.fresh,
              cacheReadTokens: s.cacheReadTokens,
              outputTokens: s.outputTokens,
              turnFresh: s.turnFresh,
              turnOutput: s.turnOutput,
              hitRate: hitRate(s),
              misses: s.misses,
              blocked: s.blocked,
              updatedAt: s.updatedAt,
            },
          ]),
        ),
      };
      const file = join(dshHome(), STATUS_FILENAME);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    } catch (error) {
      log.warn(`dsh-cost-gate: không ghi được ${STATUS_FILENAME}: ${error?.message ?? error}`);
    }
  };

  // Cộng usage thật của từng request; stream được trả nguyên vẹn cho host.
  ctx.on('llm/stream', (options, next) => {
    const sessionId = options?.sessionId;
    return (async function* passthrough() {
      for await (const chunk of next()) {
        if (chunk?.type === 'usage' && chunk.usage !== undefined) {
          const state = sessionOf(sessionId);
          if (state !== undefined) {
            applyUsage(state, chunk.usage, limits);
            writeStatus();
          }
        }
        yield chunk;
      }
    })();
  });

  // The canonical tool-body middleware runs AFTER host permission/admission gates.
  // Reject only a serial duplicate after three identical structured failures.
  // Do not terminate the agent turn: it must explain/replan or work on another branch.
  ctx.on('tools/execute', async (exec, next) => {
    const session = sessionOf(exec?.agent?.id ?? exec?.agent?.session?.id);
    if (!session || exec?.signal?.aborted) return next();
    // PTC run_code awaits nested dispatch: parent and leaf calls are not peers.
    const wrapper = exec.name === 'run_code';
    const state = wrapper ? (session.wrapperTools ??= {}) : session;
    const leafGeneration = session.toolGeneration;
    const concurrent = (state.activeTools ?? 0) > 0;
    if (concurrent) state.repetition = undefined;
    const call = fingerprint([exec.name, exec.arguments]);
    const previous = state.repetition;
    if (call && previous?.call === call && previous.count >= REPEAT_FAILURE_LIMIT) {
      return {
        isError: true,
        content: [{ type: 'text', text: 'ANTI_WASTE_REPEAT: three identical calls returned the same error. This duplicate tool body was not executed. Change the hypothesis/arguments, obtain new evidence with another tool, or report the stuck branch and remaining work to the user. Do not repeat this call or bypass permissions.' }],
      };
    }
    const generation = state.toolGeneration = (state.toolGeneration ?? 0) + 1;
    const turn = session.turn;
    let result;
    state.activeTools = (state.activeTools ?? 0) + 1;
    try {
      result = await next();
    } catch (error) {
      if (state.toolGeneration === generation) state.repetition = undefined;
      throw error;
    } finally {
      state.activeTools -= 1;
    }
    // Concurrent/out-of-order results are not sufficient proof of a serial loop.
    if (concurrent || state.toolGeneration !== generation || session.turn !== turn) return result;
    if (wrapper && session.toolGeneration !== leafGeneration) {
      state.repetition = undefined;
      return result;
    }
    const failure = result?.isError === true ? fingerprint([result.error, result.content]) : undefined;
    state.repetition = call && failure ? {
      call, failure,
      count: previous?.call === call && previous.failure === failure ? previous.count + 1 : 1,
    } : undefined;
    if (state.repetition?.count === REPEAT_FAILURE_LIMIT) {
      log.warn('dsh-cost-gate: repeated identical tool failure; change strategy before retrying');
    }
    return result;
  });

  // Usage thresholds warn only; expensive work is not necessarily waste.
  ctx.on('agent/pre-step', async (payload, next) => {
    const agent = payload?.agent;
    const state = sessionOf(agent?.id ?? agent?.session?.id);
    if (state === undefined) return next();

    if (state.turn !== payload.turn) resetTurn(state, payload.turn);
    state.steps += 1;

    const verdict = evaluate(state, limits);
    state.updatedAt = new Date().toISOString();

    if (verdict.level !== 'ok') {
      const now = Date.now();
      if (verdict.level === 'warn' && now - lastWarn > 10_000) {
        lastWarn = now;
        log.warn(
          `dsh-cost-gate: turn ${state.turn} đã dùng ${state.turnFresh.toLocaleString('en-US')} token mới ` +
            `(${Math.round(verdict.turnFreshRatio * 100)}% ngân sách), ${state.steps} bước`,
        );
      }
      const miss = missWarning(state, limits);
      if (miss !== null && verdict.level === 'warn') log.warn(`dsh-cost-gate: ${miss}`);
    }

    writeStatus();
    return next();
  });
}