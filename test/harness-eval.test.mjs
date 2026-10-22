import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fixture, hash } from './fixtures/harness-eval/recorded-runs.mjs';

const cli = new URL('../tools/harness-eval.mjs', import.meta.url);
function run(data) {
  const child = spawnSync(process.execPath, [cli.pathname, '-'], { input: typeof data === 'string' ? data : JSON.stringify(data), encoding: 'utf8' });
  assert.equal(child.error, undefined);
  assert.ok(child.stdout, child.stderr);
  return { status: child.status, report: JSON.parse(child.stdout), stderr: child.stderr };
}
function rejectMutation(name, mutate, pattern) {
  test(name, () => {
    const data = fixture();
    mutate(data);
    const result = run(data);
    assert.equal(result.status, 2);
    assert.match(result.report.errors.join('\n'), pattern);
    assert.equal(result.report.autoDeploy, false);
  });
}

test('CLI accepts paired evidence for human review, reports all metrics, never deploys', () => {
  const result = run(fixture());
  assert.equal(result.status, 0);
  assert.equal(result.report.decision, 'candidate-for-review');
  assert.equal(result.report.autoDeploy, false);
  assert.equal(result.report.liveGainsVerified, false);
  assert.equal(result.report.synthetic, true);
  assert.equal(result.report.pairs.length, 12);
  assert.equal(result.report.delta.success, 2);
  assert.equal(result.report.delta.rework, -2);
  assert.equal(result.report.delta.timeMs, 0);
  assert.equal(result.report.delta.tokens, 0);
  assert.equal(result.report.delta.costUsd, null);
  assert.equal(result.report.recurringFailure.baseline, 2);
  assert.equal(result.report.recurringFailure.candidate, 0);
});

test('malformed JSON is a structured error', () => {
  const result = run('{');
  assert.equal(result.status, 2);
  assert.equal(result.report.decision, 'invalid');
  assert.match(result.report.errors.join(), /JSON/);
});
rejectMutation('requires 6–10 representative tasks', d => { d.tasks.pop(); }, /6.*10/);
rejectMutation('rejects extra schema fields', d => { d.autoDeploy = true; }, /unknown.*autoDeploy/);
rejectMutation('rejects changed tasks', d => { d.runs[0].taskFingerprint = hash('different'); }, /taskFingerprint/);
rejectMutation('rejects changed run conditions', d => { d.runs[0].conditionsFingerprint = hash('different'); }, /conditionsFingerprint/);
rejectMutation('rejects stale configuration fingerprints', d => { d.candidate.config.guidance = 'unrecorded'; }, /fingerprint/);
rejectMutation('rejects multi-factor changes', d => { d.candidate.config.model = 'another'; d.candidate.fingerprint = hash(d.candidate.config); }, /exactly one/);
rejectMutation('rejects undeclared factor', d => { d.factor = 'model'; }, /declared factor/);
rejectMutation('rejects duplicate task IDs', d => { d.tasks[1].id = d.tasks[0].id; }, /duplicate/);
rejectMutation('rejects missing pairs', d => { d.runs.pop(); }, /paired/);
rejectMutation('rejects duplicate pairs', d => { d.runs.push({ ...d.runs[0], id: 'other' }); }, /duplicate.*pair/);
rejectMutation('rejects duplicate run IDs', d => { d.runs[1].id = d.runs[0].id; }, /duplicate.*id/i);
rejectMutation('requires repeated baseline failures', d => { const r = d.runs.find(r => r.failureCodes.length); r.failureCodes = []; r.metrics.success = true; }, /recurring/);
rejectMutation('rejects failed runs without failure labels', d => { d.runs.find(r => r.failureCodes.length).failureCodes = []; }, /failureCodes/);
rejectMutation('rejects candidate recorded before approval', d => { d.runs.at(-1).recordedAt = '2026-01-01T00:00:00Z'; }, /approval/);
rejectMutation('requires baseline before approval', d => { d.runs[0].recordedAt = '2026-01-03T00:00:00Z'; }, /baseline.*approval/);
rejectMutation('requires evidence references', d => { d.runs[0].evidence = ''; }, /evidence/);
rejectMutation('rejects reused evidence masquerading as repeated trials', d => { d.runs[1].evidence = d.runs[0].evidence; }, /duplicate.*evidence/);
rejectMutation('rejects nonfinite numeric metrics', d => { d.runs[0].metrics.timeMs = null; }, /timeMs/);
rejectMutation('rejects unknown token count', d => { d.runs[0].metrics.tokens = null; }, /tokens/);
rejectMutation('rejects cost claims with unknown cost', d => { d.claim = 'costUsd'; }, /cost.*known/i);
rejectMutation('rejects absent safety label', d => { delete d.runs[0].metrics.safety; }, /safety/);
rejectMutation('rejects fractional repetitions', d => { d.runs[0].repetition = 1.5; }, /repetition/);

test('baseline wins ties', () => {
  const d = fixture();
  for (const r of d.runs.filter(r => r.arm === 'candidate' && r.taskId === 'clarify')) {
    r.metrics.success = false; r.metrics.rework = 1; r.failureCodes = ['redundant-question'];
  }
  const result = run(d);
  assert.equal(result.status, 1);
  assert.equal(result.report.decision, 'retain-baseline');
  assert.match(result.report.reasons.join(), /improvement/);
});
for (const [name, change] of [
  ['safety', r => { r.metrics.safety = false; }],
  ['quality', r => { r.metrics.quality = 0.9; }],
  ['success', r => { r.metrics.success = false; r.failureCodes = ['new-failure']; }],
  ['timeMs', r => { r.metrics.timeMs = 101; }],
  ['tokens', r => { r.metrics.tokens = 101; }],
  ['rework', r => { r.metrics.rework = 1; }],
]) test(`rejects per-pair ${name} regression despite aggregate success gain`, () => {
  const d = fixture();
  change(d.runs.find(r => r.arm === 'candidate' && r.taskId === 'inspect'));
  const result = run(d);
  assert.equal(result.status, 1);
  assert.equal(result.report.decision, 'retain-baseline');
  assert.match(result.report.reasons.join(), new RegExp(name));
});
test('known cost claim requires strict paired savings and target failure reduction', () => {
  const d = fixture(); d.claim = 'costUsd';
  for (const r of d.runs) r.metrics.costUsd = r.arm === 'baseline' ? 0.02 : 0.01;
  const result = run(d);
  assert.equal(result.status, 0);
  assert.ok(result.report.delta.costUsd < 0);
});
test('cost regression cannot hide behind unknown costs on another pair', () => {
  const d = fixture();
  d.runs[0].metrics.costUsd = 1;
  d.runs.find(r => r.arm === 'candidate' && r.taskId === 'inspect' && r.repetition === 1).metrics.costUsd = 2;
  const result = run(d);
  assert.equal(result.status, 1);
  assert.match(result.report.reasons.join(), /costUsd/);
});
test('same-schema fingerprints ignore object property order', () => {
  const d = fixture();
  d.candidate.config = { guardrails: 'fixed', guidance: 'candidate', model: 'fixture-model' };
  assert.equal(run(d).status, 0);
});
test('reports are deterministic', () => {
  assert.deepEqual(run(fixture()).report, run(fixture()).report);
});
