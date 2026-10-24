/**
 * G5 — artifact review policy (pure, no I/O, no DSH imports).
 *
 * The point of G5: a proposer never accepts its own artifact. Something with a
 * different modality must *look* at the rendered artifact and write down what it
 * saw in a structured form — page, defect kind, severity — and the loop that
 * feeds those notes back must have a ceiling, or it becomes an infinite ping-pong.
 *
 * Everything here is deliberately synchronous and dependency-free so it can be
 * unit-tested without a Harness.
 */

/** Severity ladder, lowest first. Anything >= `blocking` stops acceptance. */
export const SEVERITIES = Object.freeze(['info', 'minor', 'major', 'blocking']);

/** Rank helper so callers never hard-code the ordering. */
export const SEVERITY_RANK = Object.freeze({ info: 0, minor: 1, major: 2, blocking: 3 });

/**
 * Defect taxonomy. Extraction and review are deliberately separate: the renderer
 * only produces pixels, the reviewer only names what is wrong.
 */
export const DEFECT_KINDS = Object.freeze([
  'overflow', // content spills out of its box / off the page
  'layout', // misaligned, overlapping, collapsed
  'missing', // expected element absent (icon, image, label)
  'contrast', // unreadable text/background
  'truncation', // text cut off mid-word
  'encoding', // mojibake, wrong glyphs
  'stale', // shows an old value/state
  'other',
]);

/** Defaults for the round ceiling. */
export const DEFAULTS_REVIEW = Object.freeze({
  enabled: true,
  maxRounds: 3,
  blockingSeverity: 'major',
  visionTool: 'read_image',
  requireVision: true,
});

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normaliseSeverity(value) {
  if (typeof value !== 'string') return undefined;
  const lowered = value.trim().toLowerCase();
  return SEVERITIES.includes(lowered) ? lowered : undefined;
}

function normaliseKind(value) {
  if (typeof value !== 'string') return undefined;
  const lowered = value.trim().toLowerCase();
  return DEFECT_KINDS.includes(lowered) ? lowered : 'other';
}

function normalisePage(value) {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return Math.floor(value);
  if (typeof value === 'string') {
    const stripped = value.trim().replace(/^page[-\s]?/i, '');
    const parsed = Number.parseInt(stripped, 10);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return undefined;
}

export function compileReviewConfig(raw) {
  const source = isObject(raw) ? raw : {};
  const maxRoundsRaw = source.maxRounds;
  let maxRounds = DEFAULTS_REVIEW.maxRounds;
  if (typeof maxRoundsRaw === 'number' && Number.isFinite(maxRoundsRaw)) {
    maxRounds = Math.max(1, Math.floor(maxRoundsRaw));
  }
  const blockingSeverity = normaliseSeverity(source.blockingSeverity) ?? DEFAULTS_REVIEW.blockingSeverity;
  const visionTool =
    typeof source.visionTool === 'string' && source.visionTool.trim().length > 0
      ? source.visionTool.trim()
      : DEFAULTS_REVIEW.visionTool;

  return Object.freeze({
    enabled: source.enabled !== false,
    maxRounds,
    blockingSeverity,
    visionTool,
    requireVision: source.requireVision !== false,
  });
}

export function createReviewState() {
  return {
    rounds: 0,
    findings: [],
    looked: false, // has any reviewer actually seen a render?
    lastVerdict: undefined,
  };
}

/**
 * Record one structured finding.
 * @returns {boolean} true when the finding was accepted.
 */
export function noteFinding(state, finding) {
  if (!isObject(state) || !isObject(finding)) return false;
  const severity = normaliseSeverity(finding.severity);
  if (severity === undefined) return false;
  const kind = normaliseKind(finding.kind);
  const note = {
    page: normalisePage(finding.page),
    kind,
    severity,
    detail: typeof finding.detail === 'string' ? finding.detail.trim().slice(0, 500) : '',
    round: Number.isInteger(finding.round) ? finding.round : state.rounds,
  };
  state.findings.push(note);
  return true;
}

/** Called when a render+vision pass completed: the artifact was actually looked at. */
export function noteReviewed(state) {
  if (!isObject(state)) return 0;
  state.rounds += 1;
  state.looked = true;
  return state.rounds;
}

/**
 * The verdict for the current round.
 * - `accept`   : nothing at or above the blocking severity
 * - `rework`   : blocking findings exist and rounds remain
 * - `give-up`  : the ceiling was hit; hand it to a human instead of looping forever
 * - `blind`    : nothing ever looked at it (requireVision and no review happened)
 * @returns {{action: string, reason: string, rounds: number, blocking: object[]}}
 */
export function reviewVerdict(state, cfg) {
  const config = isObject(cfg) ? cfg : DEFAULTS_REVIEW;
  const empty = { action: 'accept', reason: 'nothing to review', rounds: 0, blocking: [] };
  if (!isObject(state)) return empty;
  if (!config.enabled) return { ...empty, rounds: state.rounds };

  const threshold = SEVERITY_RANK[config.blockingSeverity] ?? SEVERITY_RANK.major;
  const blocking = state.findings.filter((f) => (SEVERITY_RANK[f.severity] ?? 0) >= threshold);

  // A proposer may never accept its own artifact sight-unseen: "nothing blocking"
  // only counts once something actually looked at it.
  if (config.requireVision && !state.looked) {
    return {
      action: 'blind',
      reason: 'propogser accepted without a review pass',
      rounds: state.rounds,
      blocking,
    };
  }
  if (blocking.length === 0) {
    return { action: 'accept', reason: 'no blocking findings', rounds: state.rounds, blocking: [] };
  }
  if (state.rounds >= config.maxRounds) {
    return {
      action: 'give-up',
      reason: `round ceiling reached (${config.maxRounds})`,
      rounds: state.rounds,
      blocking,
    };
  }
  return {
    action: 'rework',
    reason: `${blocking.length} blocking finding(s)`,
    rounds: state.rounds,
    blocking,
  };
}

/** Human-readable, deterministic note fed back to the proposer. */
export function buildReviewMessage(verdict) {
  const lines = [`Artifact review round ${verdict.rounds}: ${verdict.action} (${verdict.reason}).`];
  if (Array.isArray(verdict.blocking) && verdict.blocking.length > 0) {
    lines.push('Blocking findings:');
    for (const item of verdict.blocking) {
      const page = item.page === undefined ? 'page ?' : `page ${item.page}`;
      lines.push(`- ${page} · ${item.kind} · ${item.severity}${item.detail ? ` — ${item.detail}` : ''}`);
    }
    lines.push('Fix these, re-render, and look again before claiming the artifact is ready.');
  }
  return lines.join('\n');
}

export function resetReviewTurn(state) {
  if (!isObject(state)) return;
  state.rounds = 0;
  state.findings = [];
  state.looked = false;
  state.lastVerdict = undefined;
}

/**
 * Parse a vision-model answer into structured findings.
 * The reviewer is asked for lines like: `page 2 | overflow | major | footer clipped`.
 * Anything unparsable is dropped rather than guessed — a wrong finding costs a
 * whole extra round.
 */
export function parseFindings(text, round) {
  if (typeof text !== 'string' || text.trim().length === 0) return [];
  const out = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith('#')) continue;
    const cells = line.replace(/^[-*]\s*/, '').split('|').map((c) => c.trim());
    if (cells.length < 3) continue;
    const severity = normaliseSeverity(cells[2]);
    if (severity === undefined) continue;
    const finding = {
      page: normalisePage(cells[0]),
      kind: normaliseKind(cells[1]),
      severity,
      detail: cells.slice(3).join(' | '),
      round: Number.isInteger(round) ? round : 0,
    };
    if (finding.page === undefined) delete finding.page;
    out.push(finding);
  }
  return out;
}
