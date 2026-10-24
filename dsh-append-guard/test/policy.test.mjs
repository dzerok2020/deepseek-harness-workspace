import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MUTATION_KINDS,
  DEFAULTS_APPEND,
  compileAppendConfig,
  createAppendState,
  diffOutline,
  isGuardedMutation,
  noteToolUse,
  noteViolation,
  deferSuggestions,
  buildAppendMessage,
  resetAppendTurn,
  appendVerdict,
} from '../lib/policy.js';

test('MUTATION_KINDS covers the three shapes the guard distinguishes', () => {
  assert.deepEqual([...MUTATION_KINDS], ['append', 'insert', 'rewrite']);
});

test('compileAppendConfig fills defaults', () => {
  const cfg = compileAppendConfig(undefined);
  assert.equal(cfg.enabled, true);
  assert.deepEqual(cfg.memoryTools, [...DEFAULTS_APPEND.memoryTools]);
  assert.deepEqual(cfg.exemptTools, [...DEFAULTS_APPEND.exemptTools]);
  assert.equal(cfg.rareToolUses, 1);
  assert.equal(cfg.rarityWindow, 20);
  assert.ok(cfg.neverDefer.includes('bash'));
  assert.equal(cfg.nudgeOnStop, true);
});

test('compileAppendConfig accepts overrides and keeps defaults for junk', () => {
  const cfg = compileAppendConfig({
    enabled: false,
    memoryTools: ['my_memory'],
    rareToolUses: 0,
    rarityWindow: 'nope',
    nudgeOnStop: false,
  });
  assert.equal(cfg.enabled, false);
  assert.deepEqual(cfg.memoryTools, ['my_memory']);
  assert.equal(cfg.rareToolUses, 1, 'zero is not a positive int, fall back');
  assert.equal(cfg.rarityWindow, 20);
  assert.equal(cfg.nudgeOnStop, false);
});

test('createAppendState starts empty', () => {
  const state = createAppendState();
  assert.deepEqual(state.before, []);
  assert.deepEqual(state.toolUses, {});
  assert.deepEqual(state.violations, []);
  assert.equal(state.turn, 0);
  assert.equal(state.refusals, 0);
});

test('diffOutline reports a pure tail append', () => {
  const before = [{ id: 'a' }, { id: 'b' }];
  const after = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const diff = diffOutline(before, after);
  assert.equal(diff.action, 'append');
  assert.equal(diff.prefixKept, true);
  assert.deepEqual(diff.moved, []);
});

test('diffOutline reports an insert in the middle', () => {
  const before = [{ id: 'a' }, { id: 'c' }];
  const after = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const diff = diffOutline(before, after);
  assert.equal(diff.action, 'insert');
  assert.equal(diff.prefixKept, false);
  assert.equal(diff.moved.length, 1);
  assert.equal(diff.moved[0].key, 'b');
  assert.equal(diff.moved[0].to, 1);
});

test('diffOutline reports a rewrite when an entry is dropped', () => {
  const before = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const after = [{ id: 'a' }, { id: 'c' }];
  const diff = diffOutline(before, after);
  assert.equal(diff.action, 'rewrite');
  assert.equal(diff.prefixKept, false);
});

test('diffOutline reports a rewrite when order changes', () => {
  const before = [{ id: 'a' }, { id: 'b' }];
  const after = [{ id: 'b' }, { id: 'a' }];
  const diff = diffOutline(before, after);
  assert.notEqual(diff.action, 'append');
  assert.equal(diff.prefixKept, false);
});

test('diffOutline treats an empty history as append', () => {
  assert.deepEqual(diffOutline([], [{ id: 'a' }]), { action: 'append', prefixKept: true, moved: [] });
});

test('diffOutline honours a custom keyOf', () => {
  const before = [{ name: 'x' }, { name: 'y' }];
  const after = [{ name: 'x' }, { name: 'z' }, { name: 'y' }];
  const diff = diffOutline(before, after, (entry) => entry.name);
  assert.equal(diff.action, 'insert');
  assert.equal(diff.moved[0].key, 'z');
});

test('isGuardedMutation only guards configured memory tools', () => {
  const cfg = compileAppendConfig(undefined);
  assert.equal(isGuardedMutation('memory_remember', cfg), true);
  assert.equal(isGuardedMutation('mnemon_remember', cfg), true);
  assert.equal(isGuardedMutation('read', cfg), false);
  assert.equal(isGuardedMutation('forget', cfg), false, 'rollback tools are exempt');
  assert.equal(isGuardedMutation('', cfg), false);
  assert.equal(isGuardedMutation(undefined, cfg), false);
});

test('isGuardedMutation defaults to the compiled config', () => {
  assert.equal(isGuardedMutation('memory_remember'), true);
});

test('noteToolUse accumulates counts', () => {
  const state = createAppendState();
  noteToolUse(state, 'read');
  noteToolUse(state, 'read');
  noteToolUse(state, 'bash');
  assert.deepEqual(state.toolUses, { read: 2, bash: 1 });
});

test('noteViolation appends to the turn list', () => {
  const state = createAppendState();
  noteViolation(state, { tool: 'memory_remember', action: 'insert', moved: [] });
  assert.equal(state.violations.length, 1);
});

test('deferSuggestions names rarely used tools and skips neverDefer', () => {
  const state = createAppendState();
  noteToolUse(state, 'read');
  noteToolUse(state, 'acp_status');
  noteToolUse(state, 'acp_cache');
  noteToolUse(state, 'acp_cache');
  const cfg = compileAppendConfig(undefined);
  const out = deferSuggestions(state, cfg);
  assert.deepEqual(out, [
    { tool: 'acp_status', uses: 1 },
    { tool: 'read', uses: 1 },
  ].filter((item) => item.tool !== 'read'));
});

test('deferSuggestions sorts by uses then name', () => {
  const state = createAppendState();
  noteToolUse(state, 'zeta');
  noteToolUse(state, 'alpha');
  const out = deferSuggestions(state, compileAppendConfig(undefined));
  assert.deepEqual(out.map((item) => item.tool), ['alpha', 'zeta']);
});

test('buildAppendMessage explains the cache cost and the escape hatch', () => {
  const text = buildAppendMessage({
    tool: 'memory_remember',
    action: 'insert',
    moved: [{ key: 'a', to: 0 }, { key: 'b', to: 1 }, { key: 'c', to: 2 }, { key: 'd', to: 3 }],
  });
  assert.ok(text.includes('memory_remember'));
  assert.ok(text.includes('inserted into the middle'));
  assert.ok(text.includes('a@0, b@1, c@2'), 'only the first three keys are listed');
  assert.ok(!text.includes('d@3'));
  assert.ok(text.includes('append-only'));
  assert.ok(text.includes('append: "intentional"'));
});

test('buildAppendMessage labels a rewrite', () => {
  const text = buildAppendMessage({ tool: 'memory_remember', action: 'rewrite', moved: [] });
  assert.ok(text.includes('rewrote existing memory'));
  assert.ok(text.includes('no keyed entries'));
});

test('resetAppendTurn clears the per-turn slice but keeps counters', () => {
  const state = createAppendState();
  noteToolUse(state, 'read');
  noteViolation(state, { tool: 'x', action: 'insert', moved: [] });
  state.before = [{ id: 'a' }];
  resetAppendTurn(state);
  assert.deepEqual(state.before, []);
  assert.deepEqual(state.violations, []);
  assert.deepEqual(state.toolUses, { read: 1 });
});

test('appendVerdict is ok when nothing happened', () => {
  assert.deepEqual(appendVerdict(createAppendState(), compileAppendConfig(undefined)), { action: 'ok' });
});

test('appendVerdict nudges with blocking on a rewrite', () => {
  const state = createAppendState();
  noteViolation(state, { tool: 'memory_remember', action: 'rewrite', moved: [] });
  const verdict = appendVerdict(state, compileAppendConfig(undefined));
  assert.equal(verdict.action, 'nudge');
  assert.equal(verdict.blocking, true);
  assert.equal(verdict.count, 1);
  assert.ok(typeof verdict.message === 'string' && verdict.message.length > 0);
});

test('appendVerdict nudges without blocking on an insert', () => {
  const state = createAppendState();
  noteViolation(state, { tool: 'memory_remember', action: 'insert', moved: [{ key: 'a', to: 0 }] });
  const verdict = appendVerdict(state, compileAppendConfig(undefined));
  assert.equal(verdict.action, 'nudge');
  assert.equal(verdict.blocking, false);
});

test('appendVerdict stays quiet when nudgeOnStop is off', () => {
  const state = createAppendState();
  noteViolation(state, { tool: 'memory_remember', action: 'rewrite', moved: [] });
  assert.deepEqual(appendVerdict(state, compileAppendConfig({ nudgeOnStop: false })), { action: 'ok' });
});
