// dsh-cost-gate — luật thuần (không phụ thuộc DSH) để test được bằng node:test.

/** Ngân sách mặc định cho một agent turn. */
export const DEFAULT_LIMITS = Object.freeze({
  /** Token "mới" (input trừ cache read) tối đa cho một turn. */
  turnFreshTokens: 150_000,
  /**
   * Output token (gồm cả reasoning) cho một turn. Chỉ là mốc CẢNH BÁO, không chặn:
   * chặn theo output làm turn chết im lặng, agent không kịp viết câu trả lời.
   */
  turnOutputTokens: 60_000,
  /** Token mới tối đa cho cả session (nhiều turn). */
  sessionFreshTokens: 3_000_000,
  /** Số bước (một bước = một request model) tối đa cho một turn. */
  maxStepsPerTurn: 60,
  /** Tỉ lệ ngân sách bắt đầu cảnh báo (chỉ ghi status, không chặn). */
  warnRatio: 0.8,
  /** Fresh input tối thiểu để coi là "cache miss đáng ngờ". */
  missFreshThreshold: 50_000,
  /** Số cache miss liên tiếp trong một turn trước khi ghi cảnh báo. */
  consecutiveMissWarn: 3,
});

function num(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * Token thật sự phải trả giá đầy đủ.
 * dsh-llm khai báo `inputTokens` là input CHƯA cache (disjoint với
 * cacheReadTokens), nên không trừ lần nữa — trừ sẽ ra 0 sai.
 */
export function freshTokens(usage) {
  return num(usage?.inputTokens);
}

/** Tỉ lệ cache hit của một state (0..1); 0 khi chưa có token nào. */
export function hitRate(state) {
  const cached = num(state?.cacheReadTokens);
  const fresh = num(state?.fresh);
  const total = cached + fresh;
  return total === 0 ? 0 : cached / total;
}

export function createSession(sessionId) {
  return {
    sessionId: String(sessionId ?? 'unknown'),
    turn: 0,
    steps: 0,
    inputTokens: 0,
    fresh: 0,
    cacheReadTokens: 0,
    outputTokens: 0,
    turnFresh: 0,
    turnOutput: 0,
    misses: 0,
    warnStreak: 0,
    blocked: null,
    updatedAt: new Date().toISOString(),
  };
}

/** Bắt đầu turn mới: reset bộ đếm theo turn, giữ bộ đếm session. */
export function resetTurn(state, turn) {
  state.turn = Number.isFinite(turn) ? turn : state.turn + 1;
  state.steps = 0;
  state.turnFresh = 0;
  state.turnOutput = 0;
  state.misses = 0;
  state.warnStreak = 0;
  state.blocked = null;
  state.updatedAt = new Date().toISOString();
  return state;
}

/** Cộng một mẫu usage vào state; trả về state đã cập nhật. */
export function applyUsage(state, usage, limits = DEFAULT_LIMITS) {
  const fresh = freshTokens(usage);
  state.inputTokens += num(usage?.inputTokens);
  state.cacheReadTokens += num(usage?.cacheReadTokens);
  state.outputTokens += num(usage?.outputTokens);
  state.fresh += fresh;
  state.turnFresh += fresh;
  state.turnOutput += num(usage?.outputTokens);
  const missed = fresh >= limits.missFreshThreshold && num(usage?.cacheReadTokens) === 0;
  state.misses = missed ? state.misses + 1 : 0;
  state.updatedAt = new Date().toISOString();
  return state;
}

/**
 * Đánh giá state trước một bước.
 * @returns {{level: 'ok'|'warn'|'block', block: boolean, reasons: string[],
 *   turnFreshRatio: number, turnOutputRatio: number, sessionRatio: number,
 *   stepsRatio: number, hitRate: number}}
 */
export function evaluate(state, limits = DEFAULT_LIMITS) {
  const turnFreshRatio = state.turnFresh / limits.turnFreshTokens;
  const turnOutputRatio = state.turnOutput / limits.turnOutputTokens;
  const sessionRatio = state.fresh / limits.sessionFreshTokens;
  const stepsRatio = state.steps / limits.maxStepsPerTurn;
  const hard = [];
  if (turnFreshRatio >= 1) hard.push('turn-fresh');
  if (sessionRatio >= 1) hard.push('session-fresh');
  if (stepsRatio >= 1) hard.push('steps');
  // Output chỉ cảnh báo (soft-limit): nếu chặn ở đây, turn kết thúc với `blocked`
  // và người dùng không nhận được một chữ nào — đúng lỗi 3 preset Vibe ngày 28/10.
  const reasons = turnOutputRatio >= 1 ? [...hard, 'turn-output'] : hard;
  const block = hard.length > 0;
  const warn = !block && Math.max(turnFreshRatio, turnOutputRatio, sessionRatio) >= limits.warnRatio;
  return {
    level: block ? 'block' : warn ? 'warn' : 'ok',
    block,
    reasons,
    turnFreshRatio,
    turnOutputRatio,
    sessionRatio,
    stepsRatio,
    hitRate: hitRate(state),
  };
}

/** Cảnh báo "cache miss" chỉ để ghi log, không chặn. */
export function missWarning(state, limits = DEFAULT_LIMITS) {
  return state.misses >= limits.consecutiveMissWarn
    ? `${state.misses} bước liên tiếp có fresh input ≥ ${limits.missFreshThreshold} token và cacheRead = 0`
    : null;
}