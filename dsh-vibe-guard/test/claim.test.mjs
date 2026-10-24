import test from 'node:test';
import assert from 'node:assert/strict';

import {
  compileConfig,
  createState,
  detectUnverifiedClaim,
  noteClaimBlocked,
  buildClaimGateMessage,
  summarize,
} from '../lib/policy.js';

const config = compileConfig({});

function stateAfterEdit({ verified = false, verifyOk = false } = {}) {
  const state = createState();
  state.edits = 1;
  state.lastEditAt = 10;
  if (verified) {
    state.lastVerifyAt = 20;
    state.lastVerifyOk = verifyOk;
  }
  return state;
}

test('claim gate is on by default and wired through compileConfig', () => {
  assert.equal(config.claimGate, true);
  assert.ok(Array.isArray(config.re.DEFAULTS_CLAIM ?? config.re.claim));
  assert.ok(config.re.claim && config.re.claim.length > 0);
  assert.equal(compileConfig({ claimGate: false }).claimGate, false);
});

test('a claim after an unverified edit is detected', () => {
  const state = stateAfterEdit();
  const info = detectUnverifiedClaim('Done. The bug is fixed.', state, config);
  assert.ok(info);
  assert.equal(info.reason, 'no-verification');
  assert.equal(typeof info.phrase, 'string');
});

test('a claim after a failed verification is detected and says why', () => {
  const state = stateAfterEdit({ verified: true, verifyOk: false });
  const info = detectUnverifiedClaim('All tests pass now.', state, config);
  assert.ok(info);
  assert.equal(info.reason, 'last-verification-failed');
});

test('no claim when there is no unverified change', () => {
  const state = stateAfterEdit({ verified: true, verifyOk: true });
  assert.equal(detectUnverifiedClaim('Done. The bug is fixed.', state, config), null);
});

test('no claim when nothing was edited at all', () => {
  const state = createState();
  assert.equal(detectUnverifiedClaim('Everything works and is done.', state, config), null);
});

test('questions and plans are exempt', () => {
  const state = stateAfterEdit();
  assert.equal(detectUnverifiedClaim('Should I mark this done?', state, config), null);
  assert.equal(detectUnverifiedClaim('I will fix this next.', state, config), null);
  assert.equal(detectUnverifiedClaim('If the tests pass, it is fixed.', state, config), null);
  assert.equal(detectUnverifiedClaim('Đã xong chưa?', state, config), null);
});

test('claims in Vietnamese are detected', () => {
  const state = stateAfterEdit();
  assert.ok(detectUnverifiedClaim('Đã sửa xong lỗi này rồi.', state, config));
  assert.ok(detectUnverifiedClaim('Hoàn thành phần cấu hình.', state, config));
});

test('the exempt sentence does not shield a following claim', () => {
  const state = stateAfterEdit();
  const info = detectUnverifiedClaim('Should I continue? Done, fixed.', state, config);
  assert.ok(info);
});

test('claim gate can be turned off by config', () => {
  const off = compileConfig({ claimGate: false });
  const state = stateAfterEdit();
  assert.equal(detectUnverifiedClaim('Done. Fixed.', state, off), null);
});

test('noteClaimBlocked records the block in state', () => {
  const state = stateAfterEdit();
  const info = detectUnverifiedClaim('Done. Fixed.', state, config);
  noteClaimBlocked(state, info);
  assert.equal(state.claimsBlocked, 1);
  assert.equal(state.lastClaimPhrase, info.phrase);
  assert.ok(state.lastClaimAt >= 0);
});

test('gate message names the claim and the next step', () => {
  const state = stateAfterEdit();
  const info = detectUnverifiedClaim('Done. Fixed.', state, config);
  const text = buildClaimGateMessage(info, config);
  assert.match(text, /claim-gate/);
  assert.match(text, /test|lint|typecheck|build/i);
});

test('custom claimMessage overrides the default wording', () => {
  const custom = compileConfig({ claimMessage: 'CUSTOM-CLAIM-TEXT' });
  const state = stateAfterEdit();
  const info = detectUnverifiedClaim('Done. Fixed.', state, custom);
  assert.equal(buildClaimGateMessage(info, custom), 'CUSTOM-CLAIM-TEXT');
});

test('summarize exposes the claim gate counters', () => {
  const state = stateAfterEdit();
  const info = detectUnverifiedClaim('Done. Fixed.', state, config);
  noteClaimBlocked(state, info);
  const summary = summarize(state, config);
  assert.equal(summary.claimGate, true);
  assert.equal(summary.claimsBlocked, 1);
  assert.equal(summary.lastClaim, info.phrase);
});
