import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const cli = new URL('../tools/harness-eval-terminal.sh', import.meta.url).pathname;
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'terminal-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const home = join(root, 'home');
  const profile = join(home, 'profiles/harness-eval');
  mkdirSync(profile, { recursive: true });
  writeFileSync(join(profile, 'package.json'), JSON.stringify({ dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-headless'] } } }));
  writeFileSync(join(profile, 'cordis.yml'), '[]\n');
  writeFileSync(join(profile, 'cordis.patch.yml'), '- id: llm-deepseek\n  config:\n    apiKeyEnv: OR_API_KEY\n- id: sandbox-policy\n  config:\n    mode: read-only\n');
  mkdirSync(join(profile, 'node_modules'));
  writeFileSync(join(profile, 'node_modules', 'fixture-marker'), 'local dependency');
  mkdirSync(join(home, 'profiles/web'), { recursive: true });
  writeFileSync(join(home, 'profiles/web/sentinel'), 'unchanged');
  const bin = join(root, 'bin'); mkdirSync(bin);
  const invoked = join(root, 'invocations.jsonl');
  writeFileSync(join(bin, 'dsh'), `#!/usr/bin/env node\nconst fs = require('node:fs');\nfs.appendFileSync(${JSON.stringify(invoked)}, JSON.stringify({argv:process.argv.slice(2),home:process.env.DSH_HOME,keyPresent:!!process.env.OR_API_KEY,dependencyRoot:fs.realpathSync(process.env.DSH_HOME+'/profiles/harness-eval/node_modules'),marker:fs.readFileSync(process.env.DSH_HOME+'/profiles/harness-eval/node_modules/fixture-marker','utf8')})+'\\n');\nprocess.stdout.write('fake result '+process.env.OR_API_KEY+'\\n');\nprocess.stderr.write('fake diagnostic '+process.env.OR_API_KEY+'\\n');\nprocess.exit(Number(fs.readFileSync(${JSON.stringify(join(root, 'exit-code'))}, 'utf8')));\n`);
  chmodSync(join(bin, 'dsh'), 0o700);
  const logs = join(root, 'logs');
  function run(input, exitCode = 0, args = []) {
    writeFileSync(join(root, 'exit-code'), String(exitCode));
    return spawnSync('bash', [cli, ...args], { input, encoding: 'utf8', timeout: 10000,
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, DSH_HOME: home, HARNESS_EVAL_LOG_DIR: logs } });
  }
  return { root, home, profile, invoked, logs, run };
}

test('one confirmed trial sanitizes output, avoids argv secrets and preserves DSH failure', t => {
  const f = fixture(t);
  const secret = 'sk-test-"\\backslash-and-$-secret';
  const result = f.run(`\n${secret}\ny\n`, 37);
  assert.equal(result.status, 37, result.stderr);
  const calls = readFileSync(f.invoked, 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].argv, ['--profile', 'harness-eval', '--json', 'Reply exactly HARNESS_EVAL_CONNECTIVITY_OK. Do not use tools or modify files.']);
  assert.equal(calls[0].keyPresent, true);
  assert.equal(calls[0].dependencyRoot.startsWith(calls[0].home + '/profiles/harness-eval/'), true, 'dependency realpaths must remain inside the isolated profile for DSH peer routing');
  assert.equal(calls[0].marker, 'local dependency');
  assert.notEqual(calls[0].home, f.home);
  assert.equal(existsSync(calls[0].home), false);
  assert.equal(JSON.stringify(calls).includes(secret), false);
  const log = readdirSync(f.logs).map(name => readFileSync(join(f.logs, name), 'utf8')).join('\n');
  for (const text of [log, result.stdout, result.stderr]) assert.equal(text.includes(secret), false);
  assert.match(log, /fake result \[REDACTED\]/);
  assert.match(log, /fake diagnostic \[REDACTED\]/);
  assert.match(log, /"exitCode":37/);
  assert.equal(readFileSync(join(f.home, 'profiles/web/sentinel'), 'utf8'), 'unchanged');
});

test('missing profile patch fails closed without invoking DSH', t => {
  const f = fixture(t);
  rmSync(join(f.profile, 'cordis.patch.yml'));
  const result = f.run('\nsecret\ny\n');
  assert.equal(result.status, 2);
  assert.equal(existsSync(f.invoked), false);
  assert.match(result.stderr, /prerequisite/i);
});

test('workspace-write profile is rejected before requesting a credential or invoking DSH', t => {
  const f = fixture(t);
  const patch = join(f.profile, 'cordis.patch.yml');
  writeFileSync(patch, readFileSync(patch, 'utf8').replace('mode: read-only', 'sandbox: workspace-write'));
  const result = f.run('\n');
  assert.equal(result.status, 2);
  assert.equal(existsSync(f.invoked), false);
  assert.equal(result.stdout.includes('Paste the OmniRoute API key'), false);
  assert.equal(existsSync(f.logs), false);
});

test('offline startup passes only the settled empty-task rejection and sends no credential', t => {
  const f = fixture(t);
  const executable = join(f.root, 'bin/dsh');
  writeFileSync(executable, `#!/usr/bin/env node
const fs = require('node:fs');
fs.appendFileSync(${JSON.stringify(f.invoked)}, JSON.stringify({argv:process.argv.slice(2), keyPresent:!!process.env.OR_API_KEY})+'\\n');
process.stderr.write('dsh: a task is required, for example: dsh --profile headless "run the tests"\\n');
process.exit(1);
`);
  const result = f.run('', 1, ['--check-startup']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Startup activation: PASS/);
  assert.equal(result.stdout.includes('Paste the OmniRoute API key'), false);
  const call = JSON.parse(readFileSync(f.invoked, 'utf8').trim());
  assert.deepEqual(call.argv, ['--profile', 'harness-eval', '--json']);
  assert.equal(call.keyPresent, false);
  const report = JSON.parse(readFileSync(join(f.logs, readdirSync(f.logs)[0]), 'utf8'));
  assert.equal(report.kind, 'startup-only');
  assert.equal(report.exitCode, 1);
  assert.equal(report.startupVerified, true);
});

test('offline startup rejects ordinary startup errors', t => {
  const f = fixture(t);
  const result = f.run('', 1, ['--check-startup']);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /Startup activation: FAIL/);
});

test('declining trial or EOF cancels without invoking DSH', t => {
  const f = fixture(t);
  for (const input of ['\nsecret-not-for-logs\nn\n', '']) {
    const result = f.run(input);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /cancel/i);
    assert.equal(existsSync(f.invoked), false);
  }
});
