import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  SEVERITIES,
  SEVERITY_RANK,
  DEFECT_KINDS,
  DEFAULTS_REVIEW,
  compileReviewConfig,
  createReviewState,
  noteFinding,
  noteReviewed,
  reviewVerdict,
  buildReviewMessage,
  resetReviewTurn,
  parseFindings,
} from '../lib/policy.js';

test('severity ladder is ordered lowest first', () => {
  assert.deepEqual([...SEVERITIES], ['info', 'minor', 'major', 'blocking']);
  assert.ok(SEVERITY_RANK.info < SEVERITY_RANK.minor);
  assert.ok(SEVERITY_RANK.minor < SEVERITY_RANK.major);
  assert.ok(SEVERITY_RANK.major < SEVERITY_RANK.blocking);
});

test('defect kinds include the shapes we expect a vision pass to name', () => {
  for (const kind of ['overflow', 'layout', 'missing', 'contrast', 'truncation', 'encoding', 'stale', 'other']) {
    assert.ok(DEFECT_KINDS.includes(kind), `${kind} should be a defect kind`);
  }
});

test('compileReviewConfig keeps defaults', () => {
  const cfg = compileReviewConfig();
  assert.equal(cfg.enabled, true);
  assert.equal(cfg.maxRounds, DEFAULTS_REVIEW.maxRounds);
  assert.equal(cfg.blockingSeverity, 'major');
  assert.equal(cfg.visionTool, 'read_image');
  assert.equal(cfg.requireVision, true);
  assert.ok(Object.isFrozen(cfg));
});

test('compileReviewConfig clamps the round ceiling to at least 1', () => {
  assert.equal(compileReviewConfig({ maxRounds: 0 }).maxRounds, 1);
  assert.equal(compileReviewConfig({ maxRounds: -4 }).maxRounds, 1);
  assert.equal(compileReviewConfig({ maxRounds: 7.9 }).maxRounds, 7);
});

test('compileReviewConfig rejects unknown severities but accepts enabled:false', () => {
  const cfg = compileReviewConfig({ blockingSeverity: 'catastrophic', enabled: false });
  assert.equal(cfg.blockingSeverity, 'major');
  assert.equal(cfg.enabled, false);
});

test('noteFinding rejects findings with no usable severity', () => {
  const state = createReviewState();
  assert.equal(noteFinding(state, { kind: 'overflow', severity: 'nope' }), false);
  assert.equal(state.findings.length, 0);
});

test('noteFinding normalises page, kind and detail', () => {
  const state = createReviewState();
  const ok = noteFinding(state, { page: 'page-3', kind: 'Overflow', severity: 'Major', detail: '  footer clipped  ' });
  assert.equal(ok, true);
  assert.deepEqual(state.findings[0], {
    page: 3,
    kind: 'overflow',
    severity: 'major',
    detail: 'footer clipped',
    round: 0,
  });
});

test('noteFinding maps an unknown kind to other and slices long detail', () => {
  const state = createReviewState();
  noteFinding(state, { page: 1, kind: 'teleported', severity: 'minor', detail: 'x'.repeat(900) });
  assert.equal(state.findings[0].kind, 'other');
  assert.equal(state.findings[0].detail.length, 500);
});

test('noteReviewed advances rounds and flips looked', () => {
  const state = createReviewState();
  assert.equal(state.looked, false);
  assert.equal(noteReviewed(state), 1);
  assert.equal(noteReviewed(state), 2);
  assert.equal(state.looked, true);
});

test('reviewVerdict accepts when nothing reaches the blocking severity', () => {
  const state = createReviewState();
  noteReviewed(state);
  noteFinding(state, { page: 1, kind: 'contrast', severity: 'minor', detail: 'grey on grey' });
  const verdict = reviewVerdict(state, compileReviewConfig());
  assert.equal(verdict.action, 'accept');
  assert.equal(verdict.reason, 'no blocking findings');
});

test('reviewVerdict refuses to accept a blind review (requireVision)', () => {
  const state = createReviewState();
  noteFinding(state, { page: 2, kind: 'overflow', severity: 'blocking', detail: 'right column clipped' });
  const verdict = reviewVerdict(state, compileReviewConfig());
  assert.equal(verdict.action, 'blind');
  assert.equal(verdict.blocking.length, 1);
});

test('reviewVerdict allows a blind review when requireVision is off', () => {
  const state = createReviewState();
  noteFinding(state, { page: 2, kind: 'overflow', severity: 'blocking', detail: 'right column clipped' });
  const verdict = reviewVerdict(state, compileReviewConfig({ requireVision: false }));
  assert.equal(verdict.action, 'rework');
});

test('reviewVerdict asks for rework while rounds remain', () => {
  const state = createReviewState();
  noteReviewed(state);
  noteFinding(state, { page: 1, kind: 'layout', severity: 'major', detail: 'overlapping' });
  const verdict = reviewVerdict(state, compileReviewConfig({ maxRounds: 3 }));
  assert.equal(verdict.action, 'rework');
  assert.equal(verdict.rounds, 1);
});

test('reviewVerdict gives up at the round ceiling instead of looping forever', () => {
  const state = createReviewState();
  const cfg = compileReviewConfig({ maxRounds: 2 });
  noteReviewed(state);
  noteFinding(state, { page: 1, kind: 'layout', severity: 'major' });
  assert.equal(reviewVerdict(state, cfg).action, 'rework');
  noteReviewed(state);
  const verdict = reviewVerdict(state, cfg);
  assert.equal(verdict.action, 'give-up');
  assert.equal(verdict.reason, 'round ceiling reached (2)');
});

test('reviewVerdict is inert when disabled', () => {
  const state = createReviewState();
  noteFinding(state, { page: 1, kind: 'layout', severity: 'blocking' });
  const verdict = reviewVerdict(state, compileReviewConfig({ enabled: false }));
  assert.equal(verdict.action, 'accept');
});

test('buildReviewMessage lists blocking findings in structure form', () => {
  const state = createReviewState();
  noteReviewed(state);
  noteFinding(state, { page: 4, kind: 'truncation', severity: 'blocking', detail: 'title cut mid-word' });
  const text = buildReviewMessage(reviewVerdict(state, compileReviewConfig()));
  assert.match(text, /Artifact review round 1: rework \(1 blocking finding\(s\)\)\./);
  assert.match(text, /- page 4 · truncation · blocking — title cut mid-word/);
});

test('resetReviewTurn clears every field', () => {
  const state = createReviewState();
  noteReviewed(state);
  noteFinding(state, { page: 1, kind: 'layout', severity: 'major' });
  state.lastVerdict = 'rework';
  resetReviewTurn(state);
  assert.equal(state.rounds, 0);
  assert.equal(state.findings.length, 0);
  assert.equal(state.looked, false);
  assert.equal(state.lastVerdict, undefined);
});

test('parseFindings reads structured vision lines', () => {
  const text = [
    'page 1 | overflow | blocking | right column clipped',
    '- page 2 | contrast | minor | grey on grey',
    'garbage line without pipes',
    'page 3 | layout | catastrofic | not a severity',
  ].join('\n');
  const findings = parseFindings(text, 2);
  assert.equal(findings.length, 2);
  assert.deepEqual(findings[0], {
    page: 1,
    kind: 'overflow',
    severity: 'blocking',
    detail: 'right column clipped',
    round: 2,
  });
  assert.equal(findings[1].page, 2);
  assert.equal(findings[1].severity, 'minor');
});

test('parseFindings returns nothing for empty or non-string input', () => {
  assert.deepEqual(parseFindings(undefined, 1), []);
  assert.deepEqual(parseFindings('', 1), []);
  assert.deepEqual(parseFindings('   \n  ', 1), []);
});
