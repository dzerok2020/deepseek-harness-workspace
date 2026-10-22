// Synthetic records for validator tests only; NOT historical/model measurements.
import { createHash } from 'node:crypto';
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
export const hash = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
export function fixture() {
  const baselineConfig = { model: 'fixture-model', guidance: 'baseline', guardrails: 'fixed' };
  const candidateConfig = { ...baselineConfig, guidance: 'candidate' };
  const tasks = ['inspect', 'clarify', 'bugfix', 'tests', 'review', 'docs'].map(id => ({ id, fingerprint: hash({ id, prompt: 'synthetic fixture' }) }));
  const conditionsFingerprint = hash({ environment: 'synthetic', seed: 1 });
  const data = {
    version: 1, synthetic: true, tasks, conditionsFingerprint,
    baseline: { config: baselineConfig, fingerprint: hash(baselineConfig) },
    candidate: { config: candidateConfig, fingerprint: hash(candidateConfig) },
    factor: 'guidance', targetFailure: { taskId: 'clarify', code: 'redundant-question' },
    approval: { approvedBy: 'fixture-reviewer', approvedAt: '2026-01-02T00:00:00Z' },
    claim: 'success', runs: [],
  };
  for (const arm of ['baseline', 'candidate']) for (const task of tasks) for (const repetition of [1, 2]) {
    const failed = arm === 'baseline' && task.id === 'clarify';
    data.runs.push({
      id: `${arm}-${task.id}-${repetition}`, arm, taskId: task.id, repetition,
      taskFingerprint: task.fingerprint, configFingerprint: data[arm].fingerprint, conditionsFingerprint,
      recordedAt: arm === 'baseline' ? '2026-01-01T00:00:00Z' : '2026-01-03T00:00:00Z',
      evidence: `fixture://${arm}/${task.id}/${repetition}`,
      metrics: { success: !failed, rework: failed ? 1 : 0, timeMs: 100, tokens: 100, costUsd: null, safety: true, quality: 1 },
      failureCodes: failed ? ['redundant-question'] : [],
    });
  }
  return data;
}
