const REVIEWED_PIN = 'b92f181b3b748d1abbc2afd94af6aa7d8c8fca29';
const ACTIONS = ['include', 'native-equivalent', 'reference-only', 'memory-redirect', 'disabled', 'review-required'];
const PROMPT_KINDS = new Set(['skills', 'commands', 'agents', 'rules']);

// These are content-audited overlaps, not a name-based catalog of equivalents.
// Equivalence below concerns prompt intent only, never model/tool/runtime parity.
const REVIEWED = {
  'skills/agent-harness-construction': {
    owner: 'agent-harness-construction', equivalence: 'full',
    source: 'skills/agent-harness-construction/SKILL.md',
    detail: 'Compared the installed skill and pinned ECC guidance: action-space design, tool contracts, observations, and evaluation loop share the same core prompt intent.',
  },
  'skills/agent-introspection-debugging': {
    owner: 'agent-introspection-debugging', equivalence: 'full',
    source: 'skills/agent-introspection-debugging/SKILL.md',
    detail: 'Compared the installed skill and pinned ECC guidance: capture, failure classification, contained recovery, and an introspection report share the same core prompt intent.',
  },
  'skills/tdd-workflow': {
    owner: 'tdd', equivalence: 'partial', source: 'skills/tdd-workflow/SKILL.md',
    detail: 'Both require red-green tests; ECC additionally mandates 80% coverage and unit/integration/E2E layers, unlike the native public-seam TDD contract.',
  },
  'skills/verification-loop': {
    owner: 'verification-before-completion', equivalence: 'partial', source: 'skills/verification-loop/SKILL.md',
    detail: 'Both require fresh executable evidence; ECC prescribes build, type, lint, security, and diff phases while the existing skill governs claims and applicable acceptance commands.',
  },
  'skills/e2e-testing': {
    owner: 'webapp-testing', equivalence: 'partial', source: 'skills/e2e-testing/SKILL.md',
    detail: 'Both exercise real browsers; ECC prescribes a Playwright suite/CI/flaky-test workflow while the existing skill is a local application test toolkit.',
  },
  'skills/context-and-decisions': {
    owner: 'domain-modeling', equivalence: 'partial', source: 'skills/context-and-decisions/SKILL.md',
    detail: 'Shared language and decision context overlap, but ECC context-file conventions are not the same domain-modeling/ADR ownership contract.',
  },
  'skills/architecture-decision-records': {
    owner: 'recording-architecture-decisions', equivalence: 'partial', source: 'skills/architecture-decision-records/SKILL.md',
    detail: 'Both record architecture decisions, but templates and lifecycle/governance requirements differ; no exact document-contract equivalence is claimed.',
  },
  'commands/code-review': {
    owner: 'code-review', equivalence: 'partial', source: 'commands/code-review.md',
    detail: 'ECC accepts uncommitted changes or a PR; the installed review skill requires a fixed comparison and independent Standards/Spec axes. Review scope is not identical.',
  },
  'rules/common/agents': {
    owner: 'implement', equivalence: 'partial', source: 'rules/common/agents.md',
    detail: 'ECC requires Claude Agent(subagent_type) and ~/.claude/agents; existing implement/native orchestration has different delegation and approval boundaries.',
  },
  'rules/common/development-workflow': {
    owner: 'implement', equivalence: 'partial', source: 'rules/common/development-workflow.md',
    detail: 'Both govern implementation, but ECC mandates gh/Context7/Exa, planner documents, tdd-guide, and 80% coverage; these are not the existing native workflow contract.',
  },
};

const MEMORY_SKILLS = new Set(['continuous-learning', 'continuous-learning-v2', 'unified-memory', 'knowledge-ops']);
const MEMORY_COMMANDS = new Set(['learn', 'learn-eval', 'evolve', 'instinct-export', 'instinct-import', 'instinct-status', 'projects', 'promote', 'save-session', 'resume-session', 'sessions']);
const MEMORY_MCP = new Set(['ecc-memory-vault', 'memory', 'omega-memory', 'longhand']);
const MEMORY_PATTERNS = [
  /ECC Memory Vault|\becc(?:-memory-mcp|\s+memory)\b|\bomega-memory\b|@modelcontextprotocol\/server-memory/i,
  /\.ecc[\\/]memory(?:[\\/]|\b)|\.codex[\\/]memories(?:[\\/]|\b)/i,
  /\.claude[\\/](?:homunculus|sessions|skills[\\/]learned)(?:[\\/]|\b)/i,
  /\.claude[\\/]projects[\\/][^\s`"']*[\\/]memory(?:[\\/]|\b)/i,
  /continuous-learning(?:-v2)?[\\/]|instinct-cli\.py|observations\.jsonl/i,
  /\b(?:save|write|persist|store|append)\b[^\n.]{0,100}\b(?:durable context|learned (?:skills|patterns|instincts)|cross-session (?:knowledge|memory))\b/i,
];
const EXTERNAL_PATTERNS = [
  /\b(?:codeagent-wrapper|ccg-workflow)\b/i,
  /\b(?:using|install|run|requires?)\b[^\n.]{0,100}\bdmux\b/i,
  /\bclaude\b[^\n]{0,160}\s(?:--print|-p)\b|\bcodex\s+(?:exec|e)\b|\bgemini\b[^\n]{0,160}\s(?:--prompt|-p)\b|\bopencode\s+run\b/i,
  /\b(?:spawn|execFile|exec|popen|subprocess\.run)\s*\(\s*["'](?:claude|codex|gemini|opencode)["']/i,
  /@(?:anthropic-ai\/claude-code|openai\/codex|google\/gemini-cli)\b/i,
  /\brequires?\b[^\n.]{0,100}\b(?:claude|codex|gemini|dmux)\s+(?:Code\s+)?CLI\b/i,
];
const HOST_PATTERNS = [
  /CLAUDE_PLUGIN_ROOT|CODEX_HOME|\.claude[\\/]|\.codex[\\/]/i,
  /\b(?:Agent|Task)\s*\([^\n)]*subagent_type\s*[:=]/,
];

function textOf(asset) {
  return [asset.content, asset.description, asset.metadata?.description, asset.command]
    .filter(value => typeof value === 'string').join('\n');
}

function matchEvidence(patterns, text) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[0].slice(0, 180);
  }
  return null;
}

function decision(action, owner, equivalence, reason, evidence) {
  return { action, owner, equivalence, reason, evidence };
}

function memoryDecision(asset, signal) {
  return decision('memory-redirect', 'hindsight', 'partial',
    'Raw ECC persistence/learning/session entrypoint withheld. Hindsight is the only memory owner; a native replacement/bridge is required, not verified active by this policy. Skill generation, vault, and session/transcript restoration parity is not claimed.',
    [{ type: 'memory-boundary', source: asset.path ?? null, detail: signal }]);
}

function classify(kind, asset, revision, availableSkills) {
  const text = textOf(asset);
  const knownMemory = (kind === 'skills' && MEMORY_SKILLS.has(asset.name))
    || (kind === 'commands' && MEMORY_COMMANDS.has(asset.name))
    || (kind === 'mcp' && MEMORY_MCP.has(asset.name));
  const memorySignal = matchEvidence(MEMORY_PATTERNS, text);
  if (knownMemory || memorySignal) return memoryDecision(asset, memorySignal ?? `Reviewed ECC ${kind}/${asset.name} persists learning, memory, or session state outside Hindsight.`);

  if (kind === 'mcp') return decision('disabled', null, 'none',
    'MCP source configuration is inventory only; enablement requires separate configuration, credential, and capability review.',
    [{ type: 'configuration-review', source: asset.path ?? 'mcp-configs/mcp-servers.json', detail: 'No MCP server is launched by the policy.' }]);

  const externalSignal = matchEvidence(EXTERNAL_PATTERNS, text);
  if (externalSignal) return decision('review-required', null, 'unverified',
    'Mandatory or executable external agent/harness dependency is withheld and not executed. A native implementation must be reviewed separately.',
    [{ type: 'external-runtime', source: asset.path ?? null, detail: externalSignal }]);

  const reviewed = REVIEWED[`${kind}/${asset.name}`];
  if (reviewed) {
    const evidence = [{ type: 'reviewed-content', source: reviewed.source, detail: reviewed.detail }];
    if (revision !== REVIEWED_PIN) return decision('review-required', null, 'unverified',
      'Reviewed overlap is tied to the pinned ECC revision; a missing or changed source pin requires renewed content review.', evidence);
    if (availableSkills.has(reviewed.owner)) return decision(
      reviewed.equivalence === 'full' ? 'native-equivalent' : 'reference-only', reviewed.owner, reviewed.equivalence,
      reviewed.equivalence === 'full'
        ? 'Reviewed prompt intent matches the available native skill; that skill is the single owner. This is not model/tool/runtime parity.'
        : `Existing native skill owns the overlapping function; ECC is reference-only, not full equivalence. ${reviewed.detail}`,
      evidence);
  }

  const hostSignal = matchEvidence(HOST_PATTERNS, text);
  if (hostSignal) return decision('review-required', null, 'unverified',
    'Host-specific files or invocation syntax are withheld; portable native behavior has not been established.',
    [{ type: 'host-contract', source: asset.path ?? null, detail: hostSignal }]);

  if (PROMPT_KINDS.has(kind) && (typeof asset.content !== 'string' || !asset.content.trim())) {
    return decision('review-required', null, 'unverified',
      'Full prompt content is absent; names/descriptions alone cannot authorize upstream activation or establish equivalence.',
      [{ type: 'missing-content', source: asset.path ?? null, detail: 'Provide the full readonly pinned source text before screening.' }]);
  }
  if (!PROMPT_KINDS.has(kind) && kind !== 'hooks') return decision('review-required', null, 'unverified',
    'Unknown asset kind requires a native consumer and capability review.',
    [{ type: 'unknown-kind', source: asset.path ?? null, detail: kind }]);
  if (kind === 'hooks' && !text.trim()) return decision('review-required', null, 'unverified',
    'Hook command text is absent; no execution capability is inferred.',
    [{ type: 'missing-content', source: asset.path ?? null, detail: 'Provide the hook command for screening.' }]);

  return decision('include', 'ecc', 'unverified',
    'Source-only guidance passed bounded memory/external/host text screening. This is not semantic equivalence or native runtime parity; the native consumer must still enforce supported capability contracts.',
    [{ type: 'inventory-text-checked', source: asset.path ?? null, detail: 'Full supplied content screened; not a complete semantic, safety, or execution audit.' }]);
}

/**
 * Pure, non-activating inventory policy. availableSkills contains actual native
 * skill IDs, not an intended catalog. No filesystem, model, MCP, or memory calls.
 */
export function buildIntegrationPolicy(inventory, { availableSkills = [] } = {}) {
  const available = new Set(availableSkills.filter(value => typeof value === 'string'));
  const assets = [];
  const counts = { total: 0, byAction: Object.fromEntries(ACTIONS.map(action => [action, 0])), byKind: {} };
  for (const [kind, entries] of Object.entries(inventory.assets ?? {})) {
    counts.byKind[kind] = entries.length;
    for (const asset of entries) {
      const result = { kind, name: asset.name, path: asset.path ?? null, ...classify(kind, asset, inventory.revision, available) };
      assets.push(result);
      counts.total++;
      counts.byAction[result.action]++;
    }
  }
  return { schemaVersion: 1, mode: 'selective-native', memoryOwner: 'hindsight', assets, counts };
}

/**
 * Thu hẹp danh sách skill đã được policy duyệt bằng một allowlist cục bộ của profile.
 * Đây chỉ là phép giao: không thêm skill mà policy chưa duyệt, không đoán tên. Tên trong
 * allowlist mà policy không cấp được trả về ở `unknown` để /ecc-status báo thẳng.
 */
export function applySkillAllowlist(allowed, allowlist = []) {
  const wanted = (Array.isArray(allowlist) ? allowlist : []).filter(name => typeof name === 'string' && name.length > 0);
  if (wanted.length === 0) return { skills: allowed, unknown: [] };
  const set = new Set(wanted);
  return { skills: allowed.filter(name => set.has(name)), unknown: wanted.filter(name => !allowed.includes(name)) };
}
