import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { readInventory, selectRules } from '../lib/inventory.js';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'ecc-inventory-test-'));
  t.after(async () => {
    assert.equal(resolve(root), root);
    assert.ok(root.startsWith(join(tmpdir(), 'ecc-inventory-test-')));
    await rm(root, { recursive: true, force: true });
  });
  async function put(path, body) {
    const target = join(root, path);
    await mkdir(resolve(target, '..'), { recursive: true });
    await writeFile(target, body);
  }
  await put('skills/alpha/SKILL.md', '---\nname: alpha\ndescription: Example\n---\nSkill body');
  await put('commands/plan.md', '---\ndescription: Plan\n---\nWait for confirmation.');
  await put('commands/build.md', '# Build');
  await put('agents/planner.md', '---\nname: planner\n---\nPlan');
  await put('rules/common/testing.md', '# Common\nCommon first.');
  await put('rules/typescript/testing.md', '---\npaths:\n  - "**/*.ts"\n  - "**/*.tsx"\n---\n# TypeScript\nSpecific overrides common.');
  await put('rules/python/testing.md', '---\npaths:\n  - "**/*.py"\n---\n# Python\nPython only.');
  await put('rules/README.md', '# Not a rule');
  await put('hooks/hooks.json', JSON.stringify({ hooks: {
    PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo safe', timeout: 5 }] }],
    SessionEnd: [{ hooks: [{ type: 'command', command: 'echo end', async: true }] }],
  } }));
  await put('mcp-configs/mcp-servers.json', JSON.stringify({ mcpServers: { example: { command: 'never-run' } } }));
  return { root, put };
}

test('inventory preserves all canonical asset classes and hook semantics without activation', async t => {
  const { root } = await fixture(t);
  const result = await readInventory(root);
  assert.deepEqual(result.counts, { skills: 1, commands: 2, agents: 1, rules: 3, hooks: 2, mcp: 1 });
  assert.equal(result.root, root);
  assert.equal(result.assets.hooks[1].event, 'SessionEnd');
  assert.equal(result.assets.hooks[1].async, true);
  assert.equal(result.assets.hooks[0].timeout, 5);
  assert.equal(result.assets.mcp[0].status, 'disabled');
  assert.ok(result.assets.skills.every(item => item.status === 'source-present'));
});

test('inventory never follows symlinked command or rule files', async t => {
  const { root } = await fixture(t);
  await symlink(join(root, 'commands/plan.md'), join(root, 'commands/alias.md'));
  await symlink(join(root, 'rules/common/testing.md'), join(root, 'rules/common/alias.md'));
  const result = await readInventory(root);
  assert.equal(result.counts.commands, 2);
  assert.equal(result.counts.rules, 3);
});

test('rules select common then matching language and retain original content', async t => {
  const { root } = await fixture(t);
  const selected = await selectRules(root, ['src/example.ts']);
  assert.deepEqual(selected.map(item => item.name), ['common/testing', 'typescript/testing']);
  assert.match(selected[1].content, /Specific overrides common/);
  assert.doesNotMatch(selected.map(item => item.content).join('\n'), /Python only/);
});

test('rules do not inject every language when no path is known', async t => {
  const { root } = await fixture(t);
  assert.deepEqual((await selectRules(root, [])).map(item => item.name), ['common/testing']);
});

test('missing source fails explicitly instead of claiming empty successful integration', async () => {
  await assert.rejects(readInventory('/tmp/ecc-source-does-not-exist-for-test'), /ECC source/);
});
