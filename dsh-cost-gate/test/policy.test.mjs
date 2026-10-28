import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_LIMITS,
  applyUsage,
  createSession,
  evaluate,
  freshTokens,
  hitRate,
  missWarning,
  resetTurn,
} from '../lib/policy.js';

test('freshTokens = input chưa cache (dsh-llm khai báo disjoint)', () => {
  assert.equal(freshTokens({ inputTokens: 100_000, cacheReadTokens: 70_000 }), 100_000);
  assert.equal(freshTokens({ inputTokens: 5_000 }), 5_000);
  assert.equal(freshTokens({ inputTokens: 1_000, cacheReadTokens: 9_000 }), 1_000);
  assert.equal(freshTokens(undefined), 0);
});

test('applyUsage cộng dồn turn và session, giữ hitRate', () => {
  const state = createSession('s1');
  resetTurn(state, 1);
  applyUsage(state, { inputTokens: 100_000, cacheReadTokens: 80_000, outputTokens: 1_000 });
  applyUsage(state, { inputTokens: 50_000, cacheReadTokens: 40_000, outputTokens: 500 });
  assert.equal(state.turn, 1);
  assert.equal(state.turnFresh, 150_000);
  assert.equal(state.turnOutput, 1_500);
  assert.equal(state.fresh, 150_000);
  assert.equal(state.inputTokens, 150_000);
  assert.equal(state.cacheReadTokens, 120_000);
  assert.ok(Math.abs(hitRate(state) - 120_000 / 270_000) < 1e-9);
});

test('resetTurn reset bộ đếm turn nhưng giữ session', () => {
  const state = createSession('s1');
  resetTurn(state, 1);
  applyUsage(state, { inputTokens: 90_000, cacheReadTokens: 80_000, outputTokens: 2_000 });
  resetTurn(state, 2);
  assert.equal(state.turn, 2);
  assert.equal(state.steps, 0);
  assert.equal(state.turnFresh, 0);
  assert.equal(state.turnOutput, 0);
  assert.equal(state.fresh, 90_000, 'session fresh phải được giữ');
});

test('evaluate: ok rồi warn, không block theo ngân sách turn', () => {
  const state = createSession('s1');
  resetTurn(state, 1);
  state.steps = 1;
  applyUsage(state, { inputTokens: 30_000, cacheReadTokens: 100_000, outputTokens: 1_000 });
  assert.equal(evaluate(state, DEFAULT_LIMITS).level, 'ok');

  applyUsage(state, { inputTokens: 100_000, cacheReadTokens: 30_000, outputTokens: 10_000 });
  const warned = evaluate(state, DEFAULT_LIMITS);
  assert.equal(warned.level, 'warn');
  assert.equal(warned.block, false);
  assert.ok(warned.turnFreshRatio >= DEFAULT_LIMITS.warnRatio);

  applyUsage(state, { inputTokens: 30_000, cacheReadTokens: 0, outputTokens: 5_000 });
  const blocked = evaluate(state, DEFAULT_LIMITS);
  assert.equal(blocked.level, 'warn');
  assert.equal(blocked.block, false);
  assert.ok(blocked.reasons.includes('turn-fresh'));
});

test('evaluate: chỉ cảnh báo theo số bước và ngân sách session', () => {
  const state = createSession('s1');
  resetTurn(state, 1);
  state.steps = DEFAULT_LIMITS.maxStepsPerTurn;
  assert.ok(evaluate(state, DEFAULT_LIMITS).reasons.includes('steps'));
  assert.equal(evaluate(state, DEFAULT_LIMITS).block, false);
  assert.equal(evaluate(state, DEFAULT_LIMITS).level, 'warn');

  const session = createSession('s2');
  resetTurn(session, 1);
  applyUsage(session, { inputTokens: DEFAULT_LIMITS.sessionFreshTokens, cacheReadTokens: 0, outputTokens: 0 });
  assert.ok(evaluate(session, DEFAULT_LIMITS).reasons.includes('session-fresh'));
  assert.equal(evaluate(session, DEFAULT_LIMITS).block, false);
  assert.equal(evaluate(session, DEFAULT_LIMITS).level, 'warn');
});

// Lỗi 28/10/2026: 3 preset Vibe xong việc mà không có text nào — cost-gate chặn
// turn ngay khi output (gồm cả reasoning) vượt ngân sách, nên agent không kịp viết
// câu trả lời. Output phải là soft-limit: chỉ cảnh báo, không tự chặn turn.
test('evaluate: output vượt ngân sách chỉ cảnh báo, không chặn turn', () => {
  const state = createSession('s1');
  resetTurn(state, 1);
  applyUsage(state, { inputTokens: 10_000, cacheReadTokens: 0, outputTokens: DEFAULT_LIMITS.turnOutputTokens });
  const verdict = evaluate(state, DEFAULT_LIMITS);
  assert.ok(verdict.reasons.includes('turn-output'));
  assert.equal(verdict.block, false);
  assert.equal(verdict.level, 'warn');
});

test('missWarning cảnh báo khi fresh lớn mà không có cache read', () => {
  const state = createSession('s1');
  resetTurn(state, 1);
  for (let i = 0; i < DEFAULT_LIMITS.consecutiveMissWarn; i += 1) {
    applyUsage(state, { inputTokens: 60_000, cacheReadTokens: 0, outputTokens: 100 });
  }
  assert.match(missWarning(state, DEFAULT_LIMITS) ?? '', /bước liên tiếp/);

  applyUsage(state, { inputTokens: 60_000, cacheReadTokens: 30_000, outputTokens: 100 });
  assert.equal(missWarning(state, DEFAULT_LIMITS), null);
});