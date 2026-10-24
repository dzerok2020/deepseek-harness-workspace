import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SENTINEL_CHANGE,
  SENTINEL_KEEP,
  DEFAULTS_EVAL,
  compileEvalConfig,
  createEvalState,
  noteChange,
  noteSentinel,
  evalVerdict,
  buildEvalGateMessage,
  resetTurn,
} from '../lib/policy.js';

test('DEFAULTS_EVAL enables all three switches', () => {
  assert.equal(DEFAULTS_EVAL.enabled, true);
  assert.equal(DEFAULTS_EVAL.changeGate, true);
  assert.equal(DEFAULTS_EVAL.keepGate, true);
});

test('compileEvalConfig defaults when raw is missing', () => {
  assert.deepEqual(compileEvalConfig(undefined), DEFAULTS_EVAL);
  assert.deepEqual(compileEvalConfig(null), DEFAULTS_EVAL);
});

test('compileEvalConfig only honours a literal false', () => {
  const cfg = compileEvalConfig({ enabled: 'yes', changeGate: 0, keepGate: false });
  assert.equal(cfg.enabled, true);
  assert.equal(cfg.changeGate, true);
  assert.equal(cfg.keepGate, false);
  assert.throws(() => { cfg.keepGate = true; }, TypeError);
});

test('createEvalState starts empty', () => {
  const state = createEvalState();
  assert.equal(state.changedFiles.size, 0);
  assert.deepEqual(state.sentinels, []);
  assert.equal(state.refusals, 0);
});

test('noteChange ignores blank paths and bad state', () => {
  const state = createEvalState();
  noteChange(state, '   ');
  noteChange(state, undefined);
  noteChange(state, '  lib/a.js  ');
  noteChange(null, 'lib/b.js');
  assert.deepEqual([...state.changedFiles], ['lib/a.js']);
});

test('noteSentinel normalises kind and name', () => {
  const state = createEvalState();
  noteSentinel(state, { ok: true });
  noteSentinel(state, { kind: SENTINEL_KEEP, name: ' keeps old path ', ok: true });
  noteSentinel(state, { kind: 'bogus', ok: false });
  assert.deepEqual(state.sentinels, [
    { name: '(unnamed)', kind: SENTINEL_CHANGE, ok: true },
    { name: 'keeps old path', kind: SENTINEL_KEEP, ok: true },
    { name: '(unnamed)', kind: SENTINEL_CHANGE, ok: false },
  ]);
});

test('evalVerdict passes when nothing changed', () => {
  const state = createEvalState();
  assert.equal(evalVerdict(state, DEFAULTS_EVAL), null);
});

test('evalVerdict passes when both sentinels are green', () => {
  const state = createEvalState();
  noteChange(state, 'lib/a.js');
  noteSentinel(state, { kind: SENTINEL_CHANGE, ok: true });
  noteSentinel(state, { kind: SENTINEL_KEEP, ok: true });
  assert.equal(evalVerdict(state, DEFAULTS_EVAL), null);
});

test('evalVerdict reports both missing sentinels', () => {
  const state = createEvalState();
  noteChange(state, 'lib/a.js');
  noteChange(state, 'lib/b.js');
  const verdict = evalVerdict(state, DEFAULTS_EVAL);
  assert.deepEqual(verdict, { kind: 'eval', missing: [SENTINEL_CHANGE, SENTINEL_KEEP], changedCount: 2 });
});

test('evalVerdict ignores a red sentinel', () => {
  const state = createEvalState();
  noteChange(state, 'lib/a.js');
  noteSentinel(state, { kind: SENTINEL_CHANGE, ok: false });
  noteSentinel(state, { kind: SENTINEL_KEEP, ok: true });
  assert.deepEqual(evalVerdict(state, DEFAULTS_EVAL).missing, [SENTINEL_CHANGE]);
});

test('evalVerdict honours the per-side switches', () => {
  const state = createEvalState();
  noteChange(state, 'lib/a.js');
  noteSentinel(state, { kind: SENTINEL_KEEP, ok: true });
  assert.deepEqual(evalVerdict(state, compileEvalConfig({ keepGate: false })).missing, [SENTINEL_CHANGE]);
  assert.equal(evalVerdict(state, compileEvalConfig({ changeGate: false })), null);
});

test('buildEvalGateMessage names the missing halves', () => {
  const both = buildEvalGateMessage({ changedCount: 3, missing: [SENTINEL_CHANGE, SENTINEL_KEEP] });
  assert.match(both, /^EVAL GATE: this turn changed files but did not ship both sentinels\./);
  assert.match(both, /changed files: 3/);
  assert.match(both, /missing must-change sentinel/);
  assert.match(both, /missing must-keep sentinel/);
  assert.match(both, /Add the missing test, run it, then finish the turn\./);

  const one = buildEvalGateMessage({ changedCount: 1, missing: [SENTINEL_KEEP] });
  assert.doesNotMatch(one, /missing must-change sentinel/);
  assert.equal(buildEvalGateMessage(null), '');
});

test('resetTurn clears only turn-scoped data', () => {
  const state = createEvalState();
  noteChange(state, 'lib/a.js');
  noteSentinel(state, { kind: SENTINEL_CHANGE, ok: true });
  state.refusals = 4;
  resetTurn(state);
  assert.equal(state.changedFiles.size, 0);
  assert.deepEqual(state.sentinels, []);
  assert.equal(state.refusals, 4);
});
