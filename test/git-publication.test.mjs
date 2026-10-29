import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cwd = fileURLToPath(new URL('../', import.meta.url));

function ignored(path) {
  const result = spawnSync('git', ['check-ignore', '--no-index', '--quiet', path], { cwd });
  assert.ok(result.status === 0 || result.status === 1, result.stderr?.toString());
  return result.status === 0;
}

test('publication excludes credential names without reading their contents', () => {
  for (const path of ['.env', '.env.local', 'nested/.env.production', 'credentials.json', 'private-key.pem', 'id_ed25519']) {
    assert.equal(ignored(path), true, `${path} must not be published accidentally`);
  }
});

test('safe environment templates remain available for publication', () => {
  for (const path of ['.env.example', '.env.sample', '.env.template']) {
    assert.equal(ignored(path), false, `${path} is a safe template name`);
  }
});

test('local cache and installer scratch are excluded without deleting them', () => {
  for (const path of ['.cache/audit-sample.txt', '.probe/audit-sample.txt', '.tmp-install/audit-sample.txt', 'output/tmp/audit-sample.txt']) {
    assert.equal(ignored(path), true, `${path} must remain local`);
  }
  assert.ok(execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8' }).trim());
});
