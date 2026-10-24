/**
 * G6 — append guard policy (pure, no I/O, no DSH imports).
 *
 * The problem this solves: memory/retrieval plugins that INSERT or REWRITE in
 * the middle of a conversation invalidate the cached prompt prefix, so every
 * later turn pays full prompt cost again. Appending at the tail keeps the
 * prefix byte-identical and the KV-cache warm.
 *
 * This module decides two things and nothing else:
 *   1. `reviewAppend` — was this memory mutation an append? (append | insert | rewrite)
 *   2. `deferSuggestions` — which rarely used tools should the host mark `deferLoading`.
 *
 * Everything that touches DSH seams lives in ./index.js so this file stays
 * trivially testable.
 */

export const MUTATION_KINDS = Object.freeze(['append', 'insert', 'rewrite']);

/** Rollback/history uses that are never "insert in the middle" violations. */
export const BENIGN_REWRITE_TOOLS = Object.freeze([
  'forget',
  'delete',
  'restore',
  'archive',
  'undo',
]);

export const DEFAULTS_APPEND = Object.freeze({
  enabled: true,
  /** Only these tools are treated as memory mutations. */
  memoryTools: Object.freeze(['memory_remember', 'memory_profile_update', 'mnemon_remember']),
  /** Tools exempted from the append-only rule (rollback/history). */
  exemptTools: BENIGN_REWRITE_TOOLS,
  /** A tool used at most this many times in the window counts as rare. */
  rareToolUses: 1,
  /** Number of recent turns used to judge tool rarity. */
  rarityWindow: 20,
  /** Never suggest deferring these — orchestrating them away breaks the turn. */
  neverDefer: Object.freeze([
    'read',
    'write',
    'edit',
    'apply_patch',
    'bash',
    'ops_bash',
    'read_image',
    'web_search',
  ]),
  /** Emit a nudge at the end of the turn when a violation was seen. */
  nudgeOnStop: true,
});

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function stringList(value) {
  if (!Array.isArray(value)) return undefined;
  const out = [];
  for (const item of value) {
    if (typeof item === 'string' && item.length > 0) out.push(item);
  }
  return out;
}

function positiveInt(value, fallback) {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

/** Resolve user config into a complete, frozen-ish config object. */
export function compileAppendConfig(raw) {
  const input = isPlainObject(raw) ? raw : {};
  return {
    enabled: input.enabled === false ? false : DEFAULTS_APPEND.enabled,
    memoryTools: stringList(input.memoryTools) ?? [...DEFAULTS_APPEND.memoryTools],
    exemptTools: stringList(input.exemptTools) ?? [...DEFAULTS_APPEND.exemptTools],
    rareToolUses: positiveInt(input.rareToolUses, DEFAULTS_APPEND.rareToolUses),
    rarityWindow: positiveInt(input.rarityWindow, DEFAULTS_APPEND.rarityWindow),
    neverDefer: stringList(input.neverDefer) ?? [...DEFAULTS_APPEND.neverDefer],
    nudgeOnStop: input.nudgeOnStop === false ? false : DEFAULTS_APPEND.nudgeOnStop,
  };
}

/** Fresh per-agent state. `entries` models the memory outline the plugin watches. */
export function createAppendState() {
  return {
    /** Snapshot of the memory outline BEFORE the current tool call. */
    before: [],
    /** Rolling counter: toolName -> uses in the last `rarityWindow` turns. */
    toolUses: {},
    /** Violations seen during the current turn. */
    violations: [],
    /** Turns observed so far. */
    turn: 0,
    refusals: 0,
  };
}

/**
 * Compare the memory outline before and after a mutation.
 *
 * Returns:
 *   { action: 'append',  prefixKept: true,  moved: [] }
 *   { action: 'insert',  prefixKept: false, moved: [{ from, to, key }] }
 *   { action: 'rewrite', prefixKept: false, moved: [...] }
 *
 * `keyOf` maps an entry to a stable identity so a moved entry can be tracked.
 */
/**
 * Positions (into `values`) of the longest strictly increasing subsequence.
 * O(n^2) is fine here: outlines are tiny.
 */
function longestIncreasingPositions(values) {
  const n = values.length;
  if (n === 0) return [];
  const best = new Array(n).fill(1);
  const back = new Array(n).fill(-1);
  let bestEnd = 0;
  for (let i = 1; i < n; i += 1) {
    for (let j = 0; j < i; j += 1) {
      if (values[j] < values[i] && best[j] + 1 > best[i]) {
        best[i] = best[j] + 1;
        back[i] = j;
      }
    }
    if (best[i] > best[bestEnd]) bestEnd = i;
  }
  const out = [];
  for (let p = bestEnd; p !== -1; p = back[p]) out.push(p);
  return out.reverse();
}

export function diffOutline(before, after, keyOf = (entry) => entry?.id ?? entry?.key ?? null) {
  const prev = Array.isArray(before) ? before : [];
  const next = Array.isArray(after) ? after : [];

  if (prev.length === 0) return { action: 'append', prefixKept: true, moved: [] };

  const prevIndex = new Map();
  for (let i = 0; i < prev.length; i += 1) {
    const key = keyOf(prev[i]);
    if (key !== null && key !== undefined) prevIndex.set(String(key), i);
  }

  // Relative-order check: an old entry is "moved" only when it breaks the
  // relative order of the old entries, not merely because its absolute index
  // shifted to make room for a new insert in the middle.
  const oldSeq = [];
  for (let i = 0; i < next.length; i += 1) {
    const key = keyOf(next[i]);
    if (key === null || key === undefined) continue;
    const beforeIndex = prevIndex.get(String(key));
    if (beforeIndex !== undefined) oldSeq.push({ i, beforeIndex });
  }
  const keptPositions = new Set(
    longestIncreasingPositions(oldSeq.map((s) => s.beforeIndex)).map(
      (pos) => oldSeq[pos].i,
    ),
  );

  const moved = [];
  let prefixKept = true;

  for (let i = 0; i < next.length; i += 1) {
    const key = keyOf(next[i]);
    if (key === null || key === undefined) continue;
    const beforeIndex = prevIndex.get(String(key));
    if (beforeIndex === undefined) {
      // Brand new entry that landed before existing ones = an insert in the middle.
      const isTail = i >= prev.length;
      if (!isTail) {
        prefixKept = false;
        moved.push({ key: String(key), from: null, to: i });
      }
      continue;
    }
    if (!keptPositions.has(i)) {
      prefixKept = false;
      moved.push({ key: String(key), from: beforeIndex, to: i });
    }
  }

  if (prefixKept && next.length < prev.length) {
    // Deleting history is even worse for the cache than inserting into it.
    return { action: 'rewrite', prefixKept: false, moved };
  }

  if (prefixKept) return { action: 'append', prefixKept: true, moved: [] };

  const anyDropped = prev.some((entry) => {
    const key = keyOf(entry);
    if (key === null || key === undefined) return false;
    return !next.some((item) => String(keyOf(item)) === String(key));
  });

  return { action: anyDropped ? 'rewrite' : 'insert', prefixKept: false, moved };
}

/** True when this tool is subject to the append-only rule. */
export function isGuardedMutation(toolName, config) {
  const cfg = config ?? compileAppendConfig(undefined);
  if (typeof toolName !== 'string' || toolName.length === 0) return false;
  if (cfg.exemptTools.includes(toolName)) return false;
  return cfg.memoryTools.includes(toolName);
}

/** Record one tool use for the rarity heuristic. */
export function noteToolUse(state, toolName) {
  if (!isPlainObject(state) || typeof toolName !== 'string') return state;
  if (!isPlainObject(state.toolUses)) state.toolUses = {};
  state.toolUses[toolName] = (state.toolUses[toolName] ?? 0) + 1;
  return state;
}

/** Record a rejected mutation for the end-of-turn nudge. */
export function noteViolation(state, violation) {
  if (!isPlainObject(state) || !isPlainObject(violation)) return state;
  if (!Array.isArray(state.violations)) state.violations = [];
  state.violations.push(violation);
  return state;
}

/**
 * Rarely used tools that the HOST could mark `deferLoading: true`.
 * Sorted by ascending use count, then alphabetically, for stable output.
 */
export function deferSuggestions(state, config) {
  const cfg = config ?? compileAppendConfig(undefined);
  const uses = isPlainObject(state) && isPlainObject(state.toolUses) ? state.toolUses : {};
  const out = [];
  for (const [toolName, count] of Object.entries(uses)) {
    if (cfg.neverDefer.includes(toolName)) continue;
    if (!Number.isFinite(count) || count > cfg.rareToolUses) continue;
    out.push({ tool: toolName, uses: count });
  }
  out.sort((a, b) => (a.uses === b.uses ? a.tool.localeCompare(b.tool) : a.uses - b.uses));
  return out;
}

/** The message the plugin steers back into the conversation. */
export function buildAppendMessage(violation) {
  const tool = violation?.tool ?? 'a memory tool';
  const action = violation?.action ?? 'insert';
  const moved = Array.isArray(violation?.moved) ? violation.moved : [];
  const detail =
    moved.length > 0
      ? moved.slice(0, 3).map((item) => `${item.key}@${item.to}`).join(', ')
      : 'no keyed entries';

  return [
    `append-guard: \`${tool}\` ${action === 'rewrite' ? 'rewrote existing memory' : 'inserted into the middle of memory'} (${detail}).`,
    'Cache prefix became invalid, so the next turn re-pays the whole prompt.',
    'Use append-only writes: add new entries at the tail, never reorder or rewrite earlier ones.',
    'If the mutation was intentional (correction/rollback), pass `append: "intentional"` for this one call.',
  ].join('\n');
}

/** Reset the per-turn slice of state, keeping the rolling tool-use counters. */
export function resetAppendTurn(state) {
  if (!isPlainObject(state)) return state;
  state.before = [];
  state.violations = [];
  return state;
}

/**
 * End-of-turn verdict.
 *   { action: 'ok' }                       — nothing to say
 *   { action: 'nudge', message, blocking } — steer one reminder into the turn
 */
export function appendVerdict(state, config) {
  const cfg = config ?? compileAppendConfig(undefined);
  if (!cfg.nudgeOnStop) return { action: 'ok' };
  const violations = isPlainObject(state) && Array.isArray(state.violations) ? state.violations : [];
  if (violations.length === 0) return { action: 'ok' };

  const blocking = violations.some((item) => item?.action === 'rewrite');
  return {
    action: 'nudge',
    blocking,
    message: buildAppendMessage(violations[0]),
    count: violations.length,
  };
}
