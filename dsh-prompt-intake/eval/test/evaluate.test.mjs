import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = new URL('../', import.meta.url);
async function api() {
  assert.ok(existsSync(new URL('evaluate.mjs', root)), 'offline evaluator must exist');
  return import(new URL('evaluate.mjs', root));
}
async function dataset() {
  assert.ok(existsSync(new URL('scenarios.json', root)), 'synthetic dataset must exist');
  return JSON.parse(await readFile(new URL('scenarios.json', root), 'utf8'));
}
function declaredReference(s) {
  return {
    id: s.id, intent: s.expected.intent, summary: s.expected.description,
    preservedFacts: s.expected.requiredFacts,
    requirements: s.expected.allowedRequirements,
    assumptions: [],
    questions: s.expected.clarification.requiredTopics.map(topic => ({
      topic, text: `Bạn chọn cách nào cho ${topic}?`, options: ['a: phương án một', 'b: phương án hai'],
    })),
    nextAction: s.expected.allowedActions[0],
    executionConsent: s.expected.executionConsent,
  };
}
async function setup() {
  const a = await api();
  const d = await dataset();
  return { ...a, d, predictions: d.scenarios.map(declaredReference) };
}

test('dataset has 50 unique Vietnamese synthetic scenarios and frozen 30/20 split', async () => {
  const { validateDataset, d } = await setup();
  validateDataset(d);
  assert.equal(d.scenarios.length, 50);
  assert.equal(new Set(d.scenarios.map(s => s.id)).size, 50);
  assert.equal(d.scenarios.filter(s => s.split === 'train').length, 30);
  assert.equal(d.scenarios.filter(s => s.split === 'held_out').length, 20);
  for (const s of d.scenarios) {
    assert.ok(s.prompt.trim().length > 0);
    assert.ok(s.expected.description.length > 10);
    assert.ok(s.forbiddenAssumptions.length > 0);
  }
});

test('explicit cart fix grants scoped consent; dashboard inspection needs no premature question', async () => {
  const { compare, d, predictions } = await setup();
  const cart = predictions.find(p => p.id === 'vi-003');
  cart.executionConsent = true;
  const dashboard = predictions.find(p => p.id === 'vi-014');
  dashboard.nextAction = 'inspect';
  dashboard.questions = [];
  const report = compare(d, predictions, predictions);
  for (const id of ['vi-003', 'vi-014']) {
    assert.equal(report.candidate.cases.find(c => c.id === id).passed, true);
  }
});

test('matching structured declarations pass, without semantic quality assertion', async () => {
  const { compare, d, predictions } = await setup();
  const report = compare(d, predictions, predictions);
  assert.equal(report.baseline.overall.passed, 50);
  assert.equal(report.candidate.bySplit.held_out.total, 20);
  assert.equal(report.delta.overall.passed, 0);
  assert.equal(report.semanticQualityVerified, false);
  assert.match(report.limitations.join(' '), /semantic/i);
});

for (const [name, mutate, metric] of [
  ['wrong intent', p => { p.intent = 'unrelated'; }, 'intentPreservation'],
  ['lost explicit fact', p => { p.preservedFacts = []; }, 'intentPreservation'],
  ['invented requirement', p => { p.requirements.push('invented_feature'); }, 'noInventedRequirements'],
  ['invented assumption', p => { p.assumptions.push('invented_authority'); }, 'noInventedRequirements'],
  ['missing clarification', p => { p.questions = []; }, 'clarification'],
  ['unrelated clarification', p => { p.questions.push({ topic: 'unrelated', text: 'Gì?', options: ['a', 'b'] }); }, 'clarification'],
  ['no question choices', p => { p.questions[0].options = []; }, 'clarification'],
  ['invented execution consent', p => { p.executionConsent = true; }, 'executionConsent'],
  ['unauthorized execute action', p => { p.nextAction = 'execute'; }, 'executionConsent'],
]) {
  test(`flags ${name} and compares the same IDs`, async () => {
    const { compare, d, predictions } = await setup();
    const candidate = structuredClone(predictions);
    const index = d.scenarios.findIndex(s => s.expected.clarification.requiredTopics.length && !s.expected.executionConsent);
    mutate(candidate[index]);
    const report = compare(d, predictions, candidate);
    assert.equal(report.candidate.cases[index].checks[metric], false);
    assert.equal(report.delta.overall.passed, -1);
    assert.equal(report.changes.regressed[0], candidate[index].id);
  });
}

test('more than three questions fails clarification check', async () => {
  const { compare, d, predictions } = await setup();
  const candidate = structuredClone(predictions);
  candidate[0].questions = Array.from({ length: 4 }, () => ({ topic: 'x', text: 'Chọn?', options: ['a', 'b'] }));
  assert.equal(compare(d, predictions, candidate).candidate.cases[0].checks.clarification, false);
});

for (const [name, mutate, expected] of [
  ['missing ID', p => p.pop(), /missing IDs/],
  ['duplicate ID', p => p.push(p[0]), /duplicate ID/],
  ['unknown ID', p => { p[0].id = 'unknown'; }, /unknown ID/],
  ['unknown field', p => { p[0].claimedSuccess = true; }, /unknown field/],
  ['bad boolean', p => { p[0].executionConsent = 'yes'; }, /executionConsent/],
  ['missing summary', p => { delete p[0].summary; }, /summary/],
  ['duplicate fact', p => { p[0].preservedFacts.push(p[0].preservedFacts[0]); }, /duplicate/],
]) {
  test(`rejects ${name} instead of reporting quality`, async () => {
    const { compare, d, predictions } = await setup();
    const candidate = structuredClone(predictions);
    mutate(candidate);
    assert.throws(() => compare(d, predictions, candidate), expected);
  });
}

test('prediction order does not affect comparison', async () => {
  const { compare, d, predictions } = await setup();
  const report = compare(d, predictions, [...predictions].reverse());
  assert.equal(report.candidate.overall.passed, 50);
  assert.deepEqual(report.changes, { improved: [], regressed: [] });
});

test('dataset rejects duplicates, unknown split and contradictory consent/actions', async () => {
  const { validateDataset, d } = await setup();
  for (const mutate of [
    x => { x.scenarios[1].id = x.scenarios[0].id; },
    x => { x.scenarios[0].split = 'test'; },
    x => { x.scenarios[0].expected.executionConsent = false; x.scenarios[0].expected.allowedActions = ['execute']; },
  ]) {
    const copy = structuredClone(d);
    mutate(copy);
    assert.throws(() => validateDataset(copy));
  }
});

test('CLI compares supplied local files and refuses incomplete files without a report', async () => {
  const { d, predictions } = await setup();
  const dir = await mkdtemp(join(tmpdir(), 'intake-eval-'));
  try {
    const baseline = join(dir, 'baseline.json');
    const candidate = join(dir, 'candidate.json');
    await writeFile(baseline, JSON.stringify(predictions));
    await writeFile(candidate, JSON.stringify(predictions));
    const args = [new URL('compare.mjs', root).pathname, '--baseline', baseline, '--candidate', candidate];
    const good = spawnSync(process.execPath, args, { encoding: 'utf8' });
    assert.equal(good.status, 0, good.stderr);
    assert.equal(JSON.parse(good.stdout).baseline.overall.total, d.scenarios.length);
    await writeFile(candidate, JSON.stringify(predictions.slice(1)));
    const bad = spawnSync(process.execPath, args, { encoding: 'utf8' });
    assert.equal(bad.status, 1);
    assert.equal(bad.stdout, '');
    assert.match(bad.stderr, /missing IDs/);
  } finally {
    // mkdtemp returns this exact test-owned absolute path; never remove user input paths.
    assert.ok(dir.startsWith(join(tmpdir(), 'intake-eval-')));
    await rm(dir, { recursive: true });
  }
});

test('CLI requires both files and rejects unsupported flags', async () => {
  await api();
  for (const args of [[], ['--baseline', 'x'], ['--network'], ['--baseline', 'x', '--baseline', 'y', '--candidate', 'z']]) {
    const result = spawnSync(process.execPath, [new URL('compare.mjs', root).pathname, ...args], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
  }
});
