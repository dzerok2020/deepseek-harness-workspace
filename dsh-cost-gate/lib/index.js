// dsh-cost-gate — điểm vào plugin.
//
// Vai trò: mỗi bước agent là một request model, tức một lần đốt token. Plugin
// này cộng usage THẬT từ chunk `usage` của `llm/stream` (không đọc lại session
// log, vì assistant/message không mang usage), rồi chặn bước kế tiếp bằng
// `agent/pre-step` khi turn/session vượt ngân sách. Chặn = trả
// `{ kind: 'reject' }`; agent-loop kết thúc turn với lý do `blocked` thay vì
// gọi model thêm lần nữa.
//
// Không import package nào của DSH: chỉ dùng hook chung, tránh lỗi phân giải
// module khi chạy từ workspace (giống dsh-loop-guard).
//
// Tắt tạm: DSH_COST_GATE=off. Cho qua một lần: tạo file
// $DSH_HOME/cost-gate-allow (xoá file để bật lại cổng).

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  DEFAULT_LIMITS,
  applyUsage,
  createSession,
  evaluate,
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
              hitRate: s.inputTokens === 0 ? 0 : s.cacheReadTokens / s.inputTokens,
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

  // Cổng chặn: chạy trước mỗi bước, sau khi system prompt đã assemble.
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

    if (verdict.block && !allowed()) {
      state.blocked = {
        at: new Date().toISOString(),
        reasons: verdict.reasons,
        turn: state.turn,
        steps: state.steps,
        turnFresh: state.turnFresh,
        turnOutput: state.turnOutput,
        sessionFresh: state.fresh,
      };
      writeStatus(true);
      log.warn(
        `dsh-cost-gate: chặn turn ${state.turn} (${verdict.reasons.join(', ')}); ` +
          `tạo ${join('%DSH_HOME%', ALLOW_FILENAME)} để cho qua một lần`,
      );
      // Không gọi next(): bước này không được admit, turn kết thúc với `blocked`.
      return { kind: 'reject' };
    }

    writeStatus();
    return next();
  });
}