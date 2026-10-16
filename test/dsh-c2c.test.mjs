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
test('skill retains explicit consent and unverified remote boundary', () => {
  const skill = readFileSync(new URL('../dsh-with-chatgpt/SKILL.md', import.meta.url), 'utf8');
  assert.match(skill, /^---\nname: dsh-with-chatgpt\n/);
  assert.match(skill, /consent to share/);
  assert.match(skill, /Missing stages remain unverified/);
  assert.match(skill, /DSH execution still uses its API model/);
});
test('skill respects upstream browser requirement and forbids substituted C2C automation', () => {
  const skill = readFileSync(new URL('../dsh-with-chatgpt/SKILL.md', import.meta.url), 'utf8');
  assert.match(skill, /## Upstream compatibility boundary/);
  assert.match(skill, /control-in-app-browser/);
  assert.match(skill, /Do not use BrowserSkill for C2C/);
  assert.match(skill, /Never paste file contents, diffs or logs/);
  assert.match(skill, /automatic loop remains blocked/);
  assert.doesNotMatch(skill, /noClear: true|bsk_interact|inline-only/);
});
