import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Trỏ trạng thái vào thư mục tạm TRƯỚC khi import plugin (plugin đọc DSH_HOME
// tại thời điểm gọi, nhưng giữ biến sớm cho chắc).
const home = mkdtempSync(join(tmpdir(), 'cost-gate-'));
process.env.DSH_HOME = home;
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

test('vượt ngân sách turn thì bước kế tiếp bị reject', async () => {
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
  assert.equal(decision.kind, 'reject');
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
  assert.equal((await step('s2', 1, 2)).kind, 'reject');
  // Turn 2 mở lại: bộ đếm turn về 0 nên được đi tiếp.
  assert.equal((await step('s2', 2, 1)).kind, 'enter');
});

test('DSH_COST_GATE=off thì không đăng ký hook nào', async () => {
  process.env.DSH_COST_GATE = 'off';
  try {
    const hooks = new Map();
    apply({ on: (name, fn) => hooks.set(name, fn), logger: { info() {}, warn() {} } }, {});
    assert.equal(hooks.size, 0);
  } finally {
    delete process.env.DSH_COST_GATE;
  }
});