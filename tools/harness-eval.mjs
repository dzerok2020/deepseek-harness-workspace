#!/usr/bin/env node
// Offline recorded-evidence gate. Usage: node tools/harness-eval.mjs <runs.json|->
// Exit: 0 candidate for human review; 1 retain baseline; 2 invalid evidence.
// Config fingerprints = SHA-256(JSON.stringify(recursively key-sorted JSON)).
// A factor is ONE scalar top-level config key, not a bundle of nested changes.
// Include model/provider, prompt/tool/guardrail versions, dataset, environment,
// sampling settings and budgets in config or conditions fingerprints when recording.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const ensure = (condition, message) => { if (!condition) throw new Error(message); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value, name) => ensure(typeof value === 'string' && value.trim().length > 0, `${name}: expected nonempty string`);
const fingerprint = (value, name) => ensure(typeof value === 'string' && /^[a-f0-9]{64}$/.test(value), `${name}: expected SHA-256 fingerprint`);
function fields(value, names, name) {
  ensure(object(value), `${name}: expected object`);
  for (const key of Object.keys(value)) ensure(names.includes(key), `${name}: unknown field ${key}`);
  for (const key of names) ensure(Object.hasOwn(value, key), `${name}: missing ${key}`);
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!object(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
}
export const hash = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
function timestamp(value, name) {
  text(value, name);
  ensure(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(value) && Number.isFinite(Date.parse(value)), `${name}: expected timestamp with timezone`);
  return Date.parse(value);
}
const metricNames = ['success', 'rework', 'timeMs', 'tokens', 'costUsd', 'safety', 'quality'];
const lowerBetter = ['rework', 'timeMs', 'tokens', 'costUsd'];
const claims = ['success', ...lowerBetter];

export function validate(data) {
  fields(data, ['version', 'synthetic', 'tasks', 'conditionsFingerprint', 'baseline', 'candidate', 'factor', 'targetFailure', 'approval', 'claim', 'runs'], 'input');
  ensure(data.version === 1, 'input.version: expected 1');
  ensure(typeof data.synthetic === 'boolean', 'input.synthetic: expected boolean');
  ensure(Array.isArray(data.tasks) && data.tasks.length >= 6 && data.tasks.length <= 10, 'tasks: expected 6 to 10 representative tasks');
  const tasks = new Map();
  for (const task of data.tasks) {
    fields(task, ['id', 'fingerprint'], 'task');
    text(task.id, 'task.id'); fingerprint(task.fingerprint, 'task.fingerprint');
    ensure(!tasks.has(task.id), `tasks: duplicate ID ${task.id}`);
    tasks.set(task.id, task);
  }
  fingerprint(data.conditionsFingerprint, 'conditionsFingerprint');
  for (const arm of ['baseline', 'candidate']) {
    fields(data[arm], ['config', 'fingerprint'], arm);
    ensure(object(data[arm].config) && Object.keys(data[arm].config).length > 0, `${arm}.config: expected nonempty object`);
    fingerprint(data[arm].fingerprint, `${arm}.fingerprint`);
    ensure(hash(data[arm].config) === data[arm].fingerprint, `${arm}.fingerprint: does not match config`);
  }
  const before = data.baseline.config, after = data.candidate.config;
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changed = [...keys].filter(key => JSON.stringify(canonical(before[key])) !== JSON.stringify(canonical(after[key])));
  ensure(changed.length === 1, 'config: change exactly one factor');
  ensure(changed[0] === data.factor, 'config: changed key must equal declared factor');
  ensure(Object.hasOwn(before, data.factor) && Object.hasOwn(after, data.factor), 'config: declared factor must exist in both arms');
  for (const value of [before[data.factor], after[data.factor]]) ensure(value !== null && ['string', 'boolean', 'number'].includes(typeof value), 'config: declared factor must be scalar, not a bundle');
  fields(data.targetFailure, ['taskId', 'code'], 'targetFailure');
  ensure(tasks.has(data.targetFailure.taskId), 'targetFailure.taskId: unknown task'); text(data.targetFailure.code, 'targetFailure.code');
  fields(data.approval, ['approvedBy', 'approvedAt'], 'approval');
  text(data.approval.approvedBy, 'approval.approvedBy');
  const approvedAt = timestamp(data.approval.approvedAt, 'approval.approvedAt');
  ensure(claims.includes(data.claim), 'claim: invalid metric');
  ensure(Array.isArray(data.runs), 'runs: expected array');
  const ids = new Set(), evidence = new Set(), index = new Map();
  for (const run of data.runs) {
    fields(run, ['id', 'arm', 'taskId', 'repetition', 'taskFingerprint', 'configFingerprint', 'conditionsFingerprint', 'recordedAt', 'evidence', 'metrics', 'failureCodes'], 'run');
    text(run.id, 'run.id');
    ensure(!ids.has(run.id), `run: duplicate id ${run.id}`); ids.add(run.id);
    ensure(['baseline', 'candidate'].includes(run.arm), 'run.arm: invalid');
    ensure(tasks.has(run.taskId), 'run.taskId: unknown task');
    ensure(Number.isSafeInteger(run.repetition) && run.repetition > 0, 'run.repetition: expected positive integer');
    ensure(run.taskFingerprint === tasks.get(run.taskId).fingerprint, 'run.taskFingerprint: changed task');
    ensure(run.configFingerprint === data[run.arm].fingerprint, 'run.configFingerprint: changed config');
    ensure(run.conditionsFingerprint === data.conditionsFingerprint, 'run.conditionsFingerprint: changed conditions');
    const recordedAt = timestamp(run.recordedAt, 'run.recordedAt');
    ensure(run.arm === 'baseline' ? recordedAt < approvedAt : recordedAt > approvedAt, `${run.arm}: baseline must precede approval; candidate must follow approval`);
    text(run.evidence, 'run.evidence');
    fields(run.metrics, metricNames, 'run.metrics');
    const m = run.metrics;
    for (const key of ['success', 'safety']) ensure(typeof m[key] === 'boolean', `metrics.${key}: expected boolean`);
    for (const key of ['rework', 'tokens']) ensure(Number.isSafeInteger(m[key]) && m[key] >= 0, `metrics.${key}: expected nonnegative integer`);
    for (const key of ['timeMs', 'quality']) ensure(typeof m[key] === 'number' && Number.isFinite(m[key]) && m[key] >= 0, `metrics.${key}: expected finite nonnegative number`);
    ensure(m.quality <= 1, 'metrics.quality: expected 0 to 1 on the fixed task rubric');
    ensure(m.costUsd === null || (typeof m.costUsd === 'number' && Number.isFinite(m.costUsd) && m.costUsd >= 0), 'metrics.costUsd: expected nonnegative USD or null');
    ensure(Array.isArray(run.failureCodes), 'run.failureCodes: expected array');
    run.failureCodes.forEach(code => text(code, 'failureCodes'));
    ensure(new Set(run.failureCodes).size === run.failureCodes.length, 'failureCodes: duplicate');
    ensure(m.success ? run.failureCodes.length === 0 : run.failureCodes.length > 0, 'failureCodes: failures need labels; successes must have no failure labels');
    const key = JSON.stringify([run.taskId, run.repetition, run.arm]);
    ensure(!index.has(key), 'runs: duplicate task/repetition/arm pair'); index.set(key, run);
    ensure(!evidence.has(run.evidence), 'runs: duplicate evidence reference'); evidence.add(run.evidence);
  }
  const pairs = [];
  for (const taskId of tasks.keys()) {
    const baseline = data.runs.filter(r => r.taskId === taskId && r.arm === 'baseline').sort((a, b) => a.repetition - b.repetition);
    ensure(baseline.length >= 2, `${taskId}: requires at least two paired repetitions`);
    for (const b of baseline) {
      const c = index.get(JSON.stringify([taskId, b.repetition, 'candidate']));
      ensure(c, `${taskId}: missing paired candidate repetition ${b.repetition}`);
      pairs.push({ baseline: b, candidate: c });
    }
  }
  ensure(pairs.length * 2 === data.runs.length, 'runs: unpaired candidate runs');
  const countFailure = arm => data.runs.filter(r => r.arm === arm && r.taskId === data.targetFailure.taskId && r.failureCodes.includes(data.targetFailure.code)).length;
  ensure(countFailure('baseline') >= 2, 'targetFailure: needs recurring baseline failure on same task in at least two repetitions');
  if (data.claim === 'costUsd') ensure(data.runs.every(r => r.metrics.costUsd !== null), 'cost claim: all costs must be known (null is not zero)');
  return { pairs, recurringFailure: { ...data.targetFailure, baseline: countFailure('baseline'), candidate: countFailure('candidate') } };
}

export function evaluate(data) {
  const { pairs, recurringFailure } = validate(data);
  const reasons = [];
  const paired = pairs.map(({ baseline: b, candidate: c }) => {
    const regressions = [];
    for (const key of ['success', 'safety', 'quality']) if (Number(c.metrics[key]) < Number(b.metrics[key])) regressions.push(key);
    // Unsafe candidate runs are never admissible, even if baseline was unsafe too.
    if (!c.metrics.safety && !regressions.includes('safety')) regressions.push('safety');
    for (const key of lowerBetter) {
      if (b.metrics[key] !== null && c.metrics[key] === null) regressions.push(`${key}: lost measurement`);
      else if (b.metrics[key] !== null && c.metrics[key] > b.metrics[key]) regressions.push(key);
    }
    for (const key of regressions) reasons.push(`${b.taskId}/${b.repetition}: ${key} regression`);
    return { taskId: b.taskId, repetition: b.repetition, baselineId: b.id, candidateId: c.id, baseline: b.metrics, candidate: c.metrics, regressions };
  });
  const total = arm => Object.fromEntries(claims.map(key => [key, data.runs.some(r => r.arm === arm && r.metrics[key] === null) ? null : data.runs.filter(r => r.arm === arm).reduce((sum, r) => sum + Number(r.metrics[key]), 0)]));
  const baseline = total('baseline'), candidate = total('candidate');
  const delta = Object.fromEntries(claims.map(key => [key, baseline[key] === null || candidate[key] === null ? null : candidate[key] - baseline[key]]));
  ensure(Object.values(baseline).every(v => v === null || Number.isFinite(v)) && Object.values(candidate).every(v => v === null || Number.isFinite(v)), 'metric totals overflow');
  if (!(data.claim === 'success' ? delta.success > 0 : delta[data.claim] < 0)) reasons.push(`No strict ${data.claim} improvement; baseline wins ties`);
  if (recurringFailure.candidate >= recurringFailure.baseline) reasons.push('Target recurring failure did not decrease');
  return {
    reportVersion: 1, synthetic: data.synthetic, autoDeploy: false, liveGainsVerified: false,
    decision: reasons.length ? 'retain-baseline' : 'candidate-for-review',
    factor: data.factor, claim: data.claim, conditionsFingerprint: data.conditionsFingerprint,
    configFingerprints: { baseline: data.baseline.fingerprint, candidate: data.candidate.fingerprint },
    approval: data.approval, recurringFailure, baseline, candidate, delta, pairs: paired, reasons,
    limitations: [
      'Offline checks only: task representativeness, labels, timestamps, evidence references and approval identity are supplied, not authenticated.',
      'Task and condition fingerprints must cover prompts, rubrics, environment, tools, sampling and budgets; this tool cannot detect omitted conditions.',
      'Synthetic fixture results are NOT real model trials, historical measurements or evidence of live DSH gains.',
      'Repeated pairs are a minimum evidence gate, not statistical significance or proof of causality; human artifact review remains required.',
      'Unknown costs remain null; token reductions alone are not monetary savings. No network, runtime mutation or automatic deployment occurs.',
    ],
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let report;
  try {
    ensure(process.argv.length === 3, 'Usage: node tools/harness-eval.mjs <runs.json|->');
    const source = readFileSync(process.argv[2] === '-' ? 0 : process.argv[2], 'utf8');
    let data;
    try { data = JSON.parse(source); } catch { throw new Error('input: invalid JSON'); }
    report = evaluate(data);
    process.exitCode = report.decision === 'candidate-for-review' ? 0 : 1;
  } catch (error) {
    report = { reportVersion: 1, decision: 'invalid', autoDeploy: false, liveGainsVerified: false, errors: [error.message] };
    process.exitCode = 2;
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
