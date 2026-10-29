import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Trỏ trạng thái vào thư mục tạm TRƯỚC khi import plugin (plugin đọc DSH_HOME
// tại thời điểm gọi, nhưng giữ biến sớm cho chắc).
const previousHome = process.env.DSH_HOME;
const home = mkdtempSync(join(tmpdir(), 'cost-gate-'));
process.env.DSH_HOME = home;
after(() => {
  if (previousHome === undefined) delete process.env.DSH_HOME;
  else process.env.DSH_HOME = previousHome;
  assert.ok(home.startsWith(join(tmpdir(), 'cost-gate-')));
  rmSync(home, { recursive: true, force: true });
});
const { apply } = await import('../lib/index.js');

function harness(config) {
  const hooks = new Map();
  const ctx = { on: (name, fn) => hooks.set(name, fn), logger: { info() {}, warn() {} } };
  apply(ctx, config);
  const usage = async (sessionId, sample) => {
    const stream = hooks.get('llm/stream')({ sessionId }, async function* () {
      yield { type: 'usage', usage: sample };
    });
    for await (const _chunk of stream) {
      // tiêu thụ hết stream
    }
  };
  const step = (sessionId, turn, index) =>
    hooks.get('agent/pre-step')(
      { agent: { id: sessionId }, turn, step: index },
      async () => ({ kind: 'enter', messages: [] }),
    );
  return { usage, step };
}

test('vượt ngân sách turn thì bước kế tiếp vẫn được admit', async () => {
  const { usage, step } = harness({
    turnFreshTokens: 1_000,
    turnOutputTokens: 500,
    sessionFreshTokens: 100_000,
    maxStepsPerTurn: 8,
  });
  assert.equal((await step('s1', 1, 1)).kind, 'enter');
  await usage('s1', { inputTokens: 700, cacheReadTokens: 0, outputTokens: 10 });
  assert.equal((await step('s1', 1, 2)).kind, 'enter');
  await usage('s1', { inputTokens: 700, cacheReadTokens: 0, outputTokens: 10 });
  const decision = await step('s1', 1, 3);
  assert.equal(decision.kind, 'enter');
});

test('turn mới reset bộ đếm turn nhưng giữ session', async () => {
  const { usage, step } = harness({
    turnFreshTokens: 1_000,
    turnOutputTokens: 500,
    sessionFreshTokens: 100_000,
    maxStepsPerTurn: 8,
  });
  await step('s2', 1, 1);
  await usage('s2', { inputTokens: 1_200, cacheReadTokens: 0, outputTokens: 10 });
  assert.equal((await step('s2', 1, 2)).kind, 'enter');
  // Turn 2 mở lại: bộ đếm turn về 0 nên được đi tiếp.
  assert.equal((await step('s2', 2, 1)).kind, 'enter');
});

for (const [label, inputTokens, cacheReadTokens, expectedHitRate] of [
  ['fresh + cache', 100, 900, 0.9],
  ['chỉ cache', 0, 900, 1],
  ['chỉ fresh', 100, 0, 0],
  ['không có token', 0, 0, 0],
]) {
  test(`status hitRate dùng tổng fresh + cached: ${label}`, async () => {
    const { usage } = harness();
    await usage('status', { inputTokens, cacheReadTokens, outputTokens: 0 });
    const status = JSON.parse(readFileSync(join(home, 'cost-gate-status.json'), 'utf8'));
    assert.equal(status.sessions.status.inputTokens, inputTokens);
    assert.equal(status.sessions.status.fresh, inputTokens);
    assert.equal(status.sessions.status.cacheReadTokens, cacheReadTokens);
    assert.equal(status.sessions.status.hitRate, expectedHitRate);
  });
}

test('DSH_COST_GATE=off thì không đăng ký hook nào', async () => {
  const previousGate = process.env.DSH_COST_GATE;
  process.env.DSH_COST_GATE = 'off';
  try {
    const hooks = new Map();
    apply({ on: (name, fn) => hooks.set(name, fn), logger: { info() {}, warn() {} } }, {});
    assert.equal(hooks.size, 0);
  } finally {
    if (previousGate === undefined) delete process.env.DSH_COST_GATE;
    else process.env.DSH_COST_GATE = previousGate;
  }
});