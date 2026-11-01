import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { readInventory } from '../lib/inventory.js';
import { applySkillAllowlist, buildIntegrationPolicy } from '../lib/integration-policy.js';

const PIN = 'b92f181b3b748d1abbc2afd94af6aa7d8c8fca29';
const actions = ['include', 'native-equivalent', 'reference-only', 'memory-redirect', 'disabled', 'review-required'];
const source = (name, content = 'Use this domain guidance when the user requests it.') => ({ name, path: `/ecc/${name}.md`, content });
const inventory = (assets, revision = PIN) => ({ revision, assets });
const row = (policy, kind, name) => policy.assets.find(asset => asset.kind === kind && asset.name === name);

function freeze(value) {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

test('public policy covers every inventory row once without mutating input or shared decisions', () => {
  const input = freeze(inventory({ skills: [source('sql-tuning')], commands: [source('verify')], agents: [source('architect')], rules: [source('typescript/testing')], hooks: [{ name: 'PostToolUse/0/0', command: 'node scripts/check.js' }], mcp: [{ name: 'github' }] }));
  const options = freeze({ availableSkills: [] });
  const policy = buildIntegrationPolicy(input, options);
  assert.equal(policy.schemaVersion, 1);
  assert.equal(policy.mode, 'selective-native');
  assert.equal(policy.memoryOwner, 'hindsight');
  assert.equal(policy.assets.length, 6);
  assert.equal(policy.counts.total, 6);
  assert.equal(Object.values(policy.counts.byAction).reduce((sum, count) => sum + count, 0), 6);
  assert.deepEqual(Object.keys(policy.counts.byAction).sort(), actions.slice().sort());
  assert.equal(policy.counts.byKind.skills, 1);
  for (const asset of policy.assets) {
    assert.ok(actions.includes(asset.action));
    for (const key of ['kind', 'name', 'path', 'owner', 'equivalence', 'reason', 'evidence']) assert.ok(Object.hasOwn(asset, key), key);
    assert.ok(asset.reason.length > 0);
    assert.ok(asset.evidence.length > 0);
    assert.ok(!Object.hasOwn(asset, 'content'), 'policy must not duplicate full source bodies');
  }
  policy.assets[0].evidence[0].detail = 'caller edit';
  assert.notDeepEqual(buildIntegrationPolicy(input, options), policy);
});

test('reviewed same-intent native skills have one available owner, not duplicate ECC activation', () => {
  const names = ['agent-harness-construction', 'agent-introspection-debugging'];
  const input = inventory({ skills: names.map(name => ({ name, path: `/ecc/${name}/SKILL.md` })) });
  const policy = buildIntegrationPolicy(input, { availableSkills: names });
  for (const asset of policy.assets) {
    assert.equal(asset.action, 'native-equivalent');
    assert.equal(asset.owner, asset.name);
    assert.equal(asset.equivalence, 'full');
    assert.ok(asset.evidence.some(item => item.type === 'reviewed-content'));
    assert.match(asset.reason, /prompt|intent/i);
  }
  const missing = buildIntegrationPolicy(input);
  assert.ok(missing.assets.every(asset => asset.action === 'review-required'));
});

test('partial overlaps remain reference-only with explicit differences rather than parity claims', () => {
  const pairs = [['tdd-workflow', 'tdd'], ['verification-loop', 'verification-before-completion'], ['e2e-testing', 'webapp-testing'], ['context-and-decisions', 'domain-modeling'], ['architecture-decision-records', 'recording-architecture-decisions']];
  const policy = buildIntegrationPolicy(inventory({ skills: pairs.map(([name]) => source(name)), commands: [source('code-review')], rules: [source('common/agents'), source('common/development-workflow')] }), { availableSkills: [...pairs.map(([, owner]) => owner), 'code-review', 'implement'] });
  for (const [name, owner] of [...pairs, ['code-review', 'code-review'], ['common/agents', 'implement'], ['common/development-workflow', 'implement']]) {
    const asset = policy.assets.find(item => item.name === name);
    assert.equal(asset.action, 'reference-only', name);
    assert.equal(asset.owner, owner, name);
    assert.equal(asset.equivalence, 'partial', name);
    assert.ok(asset.evidence.some(item => item.type === 'reviewed-content'), name);
  }
  assert.match(row(policy, 'skills', 'tdd-workflow').reason, /80%/);
  assert.match(row(policy, 'commands', 'code-review').reason, /fixed|uncommitted/i);
  assert.match(row(policy, 'rules', 'common/agents').reason, /Agent|Claude/);
});

test('reviewed ownership is conditional on source pin and real native skill availability', () => {
  const input = inventory({ skills: [source('tdd-workflow')] });
  assert.equal(buildIntegrationPolicy(input).assets[0].action, 'include');
  const changed = buildIntegrationPolicy(inventory(input.assets, 'another-revision'), { availableSkills: ['tdd'] }).assets[0];
  assert.equal(changed.action, 'review-required');
  assert.match(changed.reason, /pin|revision/i);
  const unpinned = buildIntegrationPolicy(inventory(input.assets, null), { availableSkills: ['tdd'] }).assets[0];
  assert.equal(unpinned.action, 'review-required');
});

test('known persistent learning and memory entrypoints redirect intent without executing raw stores', () => {
  const skills = ['continuous-learning', 'continuous-learning-v2', 'unified-memory', 'knowledge-ops'];
  const commands = ['learn', 'learn-eval', 'evolve', 'instinct-export', 'instinct-import', 'instinct-status', 'projects', 'promote', 'save-session', 'resume-session', 'sessions'];
  const policy = buildIntegrationPolicy(inventory({ skills: skills.map(name => ({ name })), commands: commands.map(name => ({ name })) }));
  assert.equal(policy.assets.length, skills.length + commands.length);
  for (const asset of policy.assets) {
    assert.equal(asset.action, 'memory-redirect', asset.name);
    assert.equal(asset.owner, 'hindsight', asset.name);
    assert.equal(asset.equivalence, 'partial', asset.name);
    assert.match(asset.reason, /raw|withheld/i);
    assert.match(asset.reason, /replacement|bridge/i);
    assert.match(asset.reason, /not|does not/i);
  }
});

test('memory MCP alternatives redirect, other MCP stay disabled pending credential review', () => {
  const names = ['ecc-memory-vault', 'memory', 'omega-memory', 'longhand', 'github'];
  const policy = buildIntegrationPolicy(inventory({ mcp: names.map(name => ({ name })) }));
  for (const name of names.slice(0, 4)) assert.equal(row(policy, 'mcp', name).action, 'memory-redirect');
  assert.equal(row(policy, 'mcp', 'github').action, 'disabled');
  assert.match(row(policy, 'mcp', 'longhand').reason, /session|transcript|parity/i);
});

test('renamed persistent-store and learning assets are detected through content, descriptions and hook commands', () => {
  const policy = buildIntegrationPolicy(inventory({
    skills: [source('renamed-notes', 'Write durable context into .ecc/memory/project/notes.md.'), { name: 'renamed-vault', description: 'Store cross-session knowledge in the ECC Memory Vault.' }],
    commands: [{ name: 'renamed-learning', metadata: { description: 'Extract learned instincts into ~/.claude/homunculus/instincts/.' } }],
    agents: [source('renamed-observer', 'Append session observations to ~/.claude/homunculus/observations.jsonl.')],
    rules: [source('common/renamed-memory', 'Persist learned patterns in ~/.claude/skills/learned/.')],
    hooks: [{ name: 'PostToolUse/99/0', command: 'python scripts/continuous-learning-v2/observe.py' }],
  }));
  assert.ok(policy.assets.every(asset => asset.action === 'memory-redirect'));
  assert.ok(policy.assets.every(asset => asset.evidence.some(item => item.type === 'memory-boundary')));
});

test('renamed explicit persistent memory backends cannot be included as ordinary guidance', () => {
  const policy = buildIntegrationPolicy(inventory({ skills: [
    source('renamed-omega', 'Persist durable project memories using omega-memory MCP.'),
    source('renamed-server', 'Use @modelcontextprotocol/server-memory for persistent project knowledge.'),
    source('renamed-codex-store', 'Write cross-session memories into ~/.codex/memories/notes.md.'),
  ] }));
  assert.ok(policy.assets.every(asset => asset.action === 'memory-redirect'));
});

test('external CLI flags, process APIs and package launchers do not bypass the runtime boundary', () => {
  const policy = buildIntegrationPolicy(inventory({ skills: [
    source('renamed-process', 'Use spawn("codex", ["exec", prompt]) to implement the change.'),
    source('renamed-flags', 'Run claude --model sonnet -p "$PROMPT" to implement.'),
    source('renamed-package', 'Execute npx -y @google/gemini-cli to do the work.'),
  ] }));
  assert.ok(policy.assets.every(asset => asset.action === 'review-required'));
  assert.ok(policy.assets.every(asset => asset.evidence.some(item => item.type === 'external-runtime')));
});

test('memory boundary wins over familiar names and advertised native owners', () => {
  const policy = buildIntegrationPolicy(inventory({ skills: [source('agent-harness-construction', 'Save decisions in .ecc/memory/project/notes.md.')] }), { availableSkills: ['agent-harness-construction'] });
  assert.equal(policy.assets[0].action, 'memory-redirect');
  assert.equal(policy.assets[0].owner, 'hindsight');
});

test('mandatory external harness execution is withheld even when renamed or only in metadata', () => {
  const policy = buildIntegrationPolicy(inventory({ skills: [
    { name: 'renamed-dmux', description: 'Multi-agent orchestration using dmux (tmux pane manager for AI agents).' },
    source('renamed-shell', 'Run codeagent-wrapper --backend codex to execute the implementation.'),
    source('renamed-cli', 'Run claude -p "$PROMPT" to complete this task.'),
    { name: 'renamed-gemini', metadata: { description: 'Requires gemini CLI for all task execution.' } },
  ] }));
  assert.ok(policy.assets.every(asset => asset.action === 'review-required'));
  assert.ok(policy.assets.every(asset => asset.evidence.some(item => item.type === 'external-runtime')));
  assert.ok(policy.assets.every(asset => /not executed|withheld/i.test(asset.reason)));
});

test('host-specific files are not silently enabled as portable domain instructions', () => {
  const policy = buildIntegrationPolicy(inventory({ commands: [source('renamed-session', 'Read ~/.claude/sessions/latest.md and save the next session there.')], rules: [source('common/alien-agent', 'Invoke Agent(subagent_type="ecc:planner") before every implementation.')] }));
  assert.equal(row(policy, 'commands', 'renamed-session').action, 'memory-redirect');
  assert.equal(row(policy, 'rules', 'common/alien-agent').action, 'review-required');
});

test('unreviewed prompt assets fail closed when content is absent, not a name whitelist', () => {
  const policy = buildIntegrationPolicy(inventory({ skills: [{ name: 'unknown' }], commands: [{ name: 'unknown' }], agents: [{ name: 'unknown' }], rules: [{ name: 'unknown' }] }));
  assert.ok(policy.assets.every(asset => asset.action === 'review-required'));
  assert.ok(policy.assets.every(asset => /content|text/i.test(asset.reason)));
});

test('ordinary domain guidance can be included but text screening never claims semantic or runtime parity', () => {
  const policy = buildIntegrationPolicy(inventory({ skills: [source('sql-tuning', 'Explain query memory usage, SQL model design, database caching, and optional cloud services.')], commands: [source('verify', 'Run the project test command after user approval.')] }));
  assert.ok(policy.assets.every(asset => asset.action === 'include'));
  assert.ok(policy.assets.every(asset => asset.owner === 'ecc'));
  assert.ok(policy.assets.every(asset => asset.equivalence === 'unverified'));
  assert.ok(policy.assets.every(asset => asset.evidence.some(item => item.type === 'inventory-text-checked')));
  assert.ok(policy.assets.every(asset => /not.*parity|not.*equivalence/i.test(asset.reason)));
});

test('pinned ECC inventory receives a complete content-screened policy with memory alternatives withheld', { skip: !process.env.ECC_ROOT }, async () => {
  const input = await readInventory(process.env.ECC_ROOT);
  assert.equal(input.revision, PIN);
  for (const kind of ['skills', 'commands', 'agents', 'rules']) {
    for (const asset of input.assets[kind]) asset.content = await readFile(asset.path, 'utf8');
  }
  const policy = buildIntegrationPolicy(input, { availableSkills: ['agent-harness-construction', 'agent-introspection-debugging', 'tdd', 'verification-before-completion', 'webapp-testing', 'domain-modeling', 'recording-architecture-decisions', 'code-review', 'implement'] });
  assert.equal(policy.assets.length, Object.values(input.assets).reduce((sum, list) => sum + list.length, 0));
  assert.equal(policy.counts.total, policy.assets.length);
  for (const name of ['continuous-learning', 'continuous-learning-v2', 'unified-memory', 'knowledge-ops']) assert.equal(row(policy, 'skills', name).action, 'memory-redirect');
  for (const name of ['ecc-memory-vault', 'memory', 'omega-memory', 'longhand']) assert.equal(row(policy, 'mcp', name).action, 'memory-redirect');
  assert.equal(row(policy, 'skills', 'dmux-workflows').action, 'review-required');
  assert.ok(policy.assets.filter(asset => asset.action === 'include').every(asset => asset.equivalence === 'unverified'));
  console.log(`policy inventory: ${JSON.stringify(policy.counts)}`);
});

test('empty inventory still has stable explicit count buckets', () => {
  const policy = buildIntegrationPolicy(inventory({}));
  assert.deepEqual(policy.assets, []);
  assert.equal(policy.counts.total, 0);
  assert.ok(actions.every(action => policy.counts.byAction[action] === 0));
});

test('applySkillAllowlist: allowlist rỗng giữ nguyên policy', () => {
  const allowed = ['alpha', 'beta'];
  assert.deepEqual(applySkillAllowlist(allowed, []), { skills: allowed, unknown: [] });
  assert.deepEqual(applySkillAllowlist(allowed), { skills: allowed, unknown: [] });
});

test('applySkillAllowlist: chỉ giữ tên có trong cả policy và allowlist, báo tên lạ', () => {
  const result = applySkillAllowlist(['alpha', 'beta', 'gamma'], ['gamma', 'alpha', 'typo']);
  assert.deepEqual(result.skills, ['alpha', 'gamma']);
  assert.deepEqual(result.unknown, ['typo']);
});

test('applySkillAllowlist: allowlist không giao gì thì catalog rỗng, không âm thầm fallback', () => {
  assert.deepEqual(applySkillAllowlist(['alpha'], ['beta']), { skills: [], unknown: ['beta'] });
});
