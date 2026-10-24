/**
 * G4 — eval gate policy.
 *
 * A change is only "done" when it carries a pair of sentinels:
 *   - a must-change sentinel: a test that FAILED before the change and PASSES after
 *     (proof the new behaviour actually exists), and
 *   - a must-keep sentinel: a test that PASSED before and PASSES after
 *     (proof the old behaviour was not silently broken).
 *
 * This module is pure: no I/O, no clock. The plugin layer feeds it observations.
 */

export const SENTINEL_CHANGE = 'must-change';
export const SENTINEL_KEEP = 'must-keep';

export const DEFAULTS_EVAL = Object.freeze({
  enabled: true,
  changeGate: true,
  keepGate: true,
});

/** Compile the raw plugin config into a frozen, validated shape. */
export function compileEvalConfig(raw) {
  const input = raw !== null && typeof raw === 'object' ? raw : {};
  const enabled = input.enabled === undefined ? DEFAULTS_EVAL.enabled : input.enabled !== false;
  const changeGate = input.changeGate === undefined ? DEFAULTS_EVAL.changeGate : input.changeGate !== false;
  const keepGate = input.keepGate === undefined ? DEFAULTS_EVAL.keepGate : input.keepGate !== false;
  return Object.freeze({ enabled, changeGate, keepGate });
}

/** Mutable per-agent bookkeeping for one session. */
export function createEvalState() {
  return {
    // Files recorded as changed during the current turn.
    changedFiles: new Set(),
    // Sentinel results observed this turn: [{ name, kind, ok }]
    sentinels: [],
    // Total turns that were refused, for reporting.
    refusals: 0,
  };
}

/** Note that a file was written/edited in this turn. */
export function noteChange(state, filePath) {
  if (state === null || typeof state !== 'object') return;
  if (typeof filePath !== 'string' || filePath.trim() === '') return;
  state.changedFiles.add(filePath.trim());
}

/**
 * Record one sentinel observation.
 * @param {object} state ambient eval state
 * @param {{name?:string, kind?:string, ok?:boolean}} observation
 */
export function noteSentinel(state, observation) {
  if (state === null || typeof state !== 'object') return;
  if (observation === null || typeof observation !== 'object') return;
  const ok = observation.ok === true;
  const kind = observation.kind === SENTINEL_KEEP ? SENTINEL_KEEP : SENTINEL_CHANGE;
  const name = typeof observation.name === 'string' && observation.name.trim() !== ''
    ? observation.name.trim()
    : '(unnamed)';
  state.sentinels.push({ name, kind, ok });
}

/** Should this turn be refused? Returns null when the turn may stop. */
export function evalVerdict(state, cfg) {
  const config = cfg !== null && typeof cfg === 'object' ? cfg : DEFAULTS_EVAL;
  if (state === null || typeof state !== 'object') return null;
  if (state.changedFiles.size === 0) return null;

  const pass = (kind) => state.sentinels.some((s) => s.kind === kind && s.ok === true);
  const missing = [];
  if (config.changeGate && !pass(SENTINEL_CHANGE)) missing.push(SENTINEL_CHANGE);
  if (config.keepGate && !pass(SENTINEL_KEEP)) missing.push(SENTINEL_KEEP);
  if (missing.length === 0) return null;
  return { kind: 'eval', missing, changedCount: state.changedFiles.size };
}

/** Human-readable refusal returned to the agent as a steer message. */
export function buildEvalGateMessage(verdict) {
  if (verdict === null || typeof verdict !== 'object') return '';
  const lines = [];
  lines.push('EVAL GATE: this turn changed files but did not ship both sentinels.');
  lines.push(`changed files: ${verdict.changedCount}`);
  for (const kind of verdict.missing) {
    if (kind === SENTINEL_CHANGE) {
      lines.push('- missing must-change sentinel: run a test that FAILS before the change and PASSES after it.');
    } else {
      lines.push('- missing must-keep sentinel: run a test that PASSED before the change and still PASSES.');
    }
  }
  lines.push('Add the missing test, run it, then finish the turn.');
  return lines.join('\n');
}

/** Reset the turn-scoped part of the state (call when a turn ends normally). */
export function resetTurn(state) {
  if (state === null || typeof state !== 'object') return;
  state.changedFiles.clear();
  state.sentinels = [];
}
