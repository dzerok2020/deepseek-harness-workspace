import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const wrapper = new URL('../tools/dsh-c2c', import.meta.url).pathname;
for (const command of ['setup', 'sandbox-allow', 'update', 'unknown']) {
  test(`DSH wrapper rejects ${command} before upstream execution`, () => {
    const result = spawnSync('bash', [wrapper, command], { encoding: 'utf8' });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /Usage: dsh-c2c/);
  });
}
test('retired wrapper rejects starting or pairing old integration', () => {
  for (const command of ['start', 'pair', 'record', 'session']) {
    const result = spawnSync('bash', [wrapper, command], { encoding: 'utf8' });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /retired/);
  }
});
test('skill retires C2C and does not claim new bridge compatibility', () => {
  const skill = readFileSync(new URL('../dsh-with-chatgpt/SKILL.md', import.meta.url), 'utf8');
  assert.match(skill, /^---\nname: dsh-with-chatgpt\n/);
  assert.match(skill, /C2C is retired/);
  assert.match(skill, /miuuyy\/codex-chatgpt-web/);
  assert.match(skill, /not yet verified/);
  assert.doesNotMatch(skill, /INIT → PLAN|c2c_control.*begin|start -w/);
});
