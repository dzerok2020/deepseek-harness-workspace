import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const repair = new URL('../tools/fix-cordis-budgets.sh', import.meta.url).pathname;
const profile = (cgwWindow = 1000000) => `# keep this comment
- id: llm-pi-ai
  config:
    providers:
      or:
        defaultContextWindow: 128000
        defaultMaxTokens: 16384
        models:
          - id: b-ai/glm-5.3-flash
            contextWindow: 1000000 # valid large model
            maxTokens: 16384
      cgw:
        defaultContextWindow: 128000
        defaultMaxTokens: 16384
        models:
          - id: chatgpt-web/gpt-6-sol
            contextWindow: ${cgwWindow} # repair only this number
            maxTokens: 16384
      untouched:
        models:
          - id: private-model
            contextWindow: 65000
            maxTokens: 131000
`;

function run(text, writerStopped = true) {
  const home = mkdtempSync(join(tmpdir(), 'model-budget-repair-'));
  const dir = join(home, 'profiles/web');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'cordis.patch.yml');
  writeFileSync(file, text, { mode: 0o600 });
  const result = spawnSync('bash', [repair, ...(writerStopped ? ['--writer-stopped'] : [])], { encoding: 'utf8', env: { ...process.env, DSH_HOME: home } });
  return { ...result, home, dir, file, text: readFileSync(file, 'utf8') };
}

test('repair fixes cgw 1M while preserving valid or 1M and unrelated bytes', () => {
  const r = run(profile());
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.text, profile(128000));
  const backups = readdirSync(r.dir).filter(name => name.startsWith('cordis.patch.yml.bak-'));
  assert.equal(backups.length, 1);
  assert.equal(readFileSync(join(r.dir, backups[0]), 'utf8'), profile());
});

test('clean policy is byte-identical, creates no backup, and repeat repair is idempotent', () => {
  const clean = run(profile(128000));
  assert.equal(clean.status, 0, clean.stderr);
  assert.equal(clean.text, profile(128000));
  assert.deepEqual(readdirSync(clean.dir), ['cordis.patch.yml']);
  const repaired = run(profile());
  assert.equal(repaired.status, 0, repaired.stderr);
  const before = readdirSync(repaired.dir);
  const again = spawnSync('bash', [repair], { encoding: 'utf8', env: { ...process.env, DSH_HOME: repaired.home } });
  assert.equal(again.status, 0, again.stderr);
  assert.equal(readFileSync(repaired.file, 'utf8'), profile(128000));
  assert.deepEqual(readdirSync(repaired.dir), before);
});

test('unknown model, malformed YAML, duplicate keys and aliases fail before write or backup', () => {
  for (const input of [
    profile().replace('chatgpt-web/gpt-6-sol', 'unknown-model'),
    profile() + '\n  broken: [',
    profile().replace('defaultContextWindow: 128000', 'defaultContextWindow: 128000\n        defaultContextWindow: 1000000'),
    profile().replace('contextWindow: 1000000 # valid large model', 'contextWindow: &shared 1000000').replace('contextWindow: 1000000 # repair only this number', 'contextWindow: *shared'),
  ]) {
    const r = run(input);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.equal(r.text, input);
    assert.deepEqual(readdirSync(r.dir), ['cordis.patch.yml']);
  }
});

test('repair corrects defaults and inserts missing explicit numeric fields', () => {
  const input = profile().replace('defaultContextWindow: 128000', 'defaultContextWindow: 872000')
    .replace('            maxTokens: 16384\n      cgw:', '      cgw:');
  const r = run(input);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.text, profile(128000));
});

test('quoted known model IDs and quoted numbers are handled without reserializing YAML', () => {
  const r = run(profile().replace('id: chatgpt-web/gpt-6-sol', 'id: "chatgpt-web/gpt-6-sol"')
    .replace('contextWindow: 1000000 # repair', 'contextWindow: "1000000" # repair'));
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.text, profile(128000).replace('id: chatgpt-web/gpt-6-sol', 'id: "chatgpt-web/gpt-6-sol"'));
});

test('repair preserves CRLF bytes and exact original backup', () => {
  const input = profile().replaceAll('\n', '\r\n');
  const r = run(input);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.text, profile(128000).replaceAll('\n', '\r\n'));
  const backup = readdirSync(r.dir).find(name => name.startsWith('cordis.patch.yml.bak-'));
  assert.deepEqual(readFileSync(join(r.dir, backup)), Buffer.from(input));
});

test('repair refuses to write or back up without stopped-writer confirmation', () => {
  const input = profile();
  const r = run(input, false);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--writer-stopped/);
  assert.equal(r.text, input);
  assert.deepEqual(readdirSync(r.dir), ['cordis.patch.yml']);
});
