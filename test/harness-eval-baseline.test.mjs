import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync, chmodSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, delimiter } from 'node:path';
import { spawnSync } from 'node:child_process';

import { collectBaseline } from '../tools/harness-eval-baseline.mjs';

const cli = new URL('../tools/harness-eval-baseline.mjs', import.meta.url).pathname;
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'baseline-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const home = join(root, 'source-home');
  const profile = join(home, 'profiles/harness-eval');
  mkdirSync(join(profile, 'node_modules'), { recursive: true });
  writeFileSync(join(profile, 'package.json'), JSON.stringify({ dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-headless'] } } }));
  writeFileSync(join(profile, 'cordis.yml'), '[]\n');
  writeFileSync(join(profile, 'cordis.patch.yml'), '- id: provider\n  config:\n    apiKeyEnv: OR_API_KEY\n- id: sandbox\n  config:\n    mode: read-only\n');
  writeFileSync(join(profile, 'node_modules/marker'), 'dependency');
  const bin = join(root, 'bin'); mkdirSync(bin);
  const calls = join(root, 'calls');
  writeFileSync(join(bin, 'dsh'), `#!/usr/bin/env node
const fs = require('node:fs');
fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify({args:process.argv.slice(2), cwd:process.cwd(), env:Object.keys(process.env), home:process.env.HOME, dshHome:process.env.DSH_HOME, dependency:fs.realpathSync(process.env.DSH_HOME+'/profiles/harness-eval/node_modules')})+'\\n');
if (!fs.readFileSync('shipping.mjs','utf8').includes('total > 500000')) process.exit(9);
fs.writeFileSync('observed.txt', 'snapshot '+process.env.OR_API_KEY);
console.log(JSON.stringify({type:'status', phase:'step_end', usage:{inputTokens:11, outputTokens:7}}));
console.log(JSON.stringify({type:'status', phase:'step_end', usage:{inputTokens:3, outputTokens:2}}));
console.log('echo '+process.env.OR_API_KEY+' Bearer fake-bearer');
`);
  chmodSync(join(bin, 'dsh'), 0o700);
  const output = join(root, 'artifacts');
  const env = { PATH: bin + delimiter + process.env.PATH, DSH_HOME: home, OR_API_KEY: 'fake-only-key', UNRELATED_SECRET: 'must-not-inherit' };
  const run = (args = []) => spawnSync(process.execPath, [cli, '--task', 'bug-boundary', '--repetition', '1', '--output-dir', output, ...args], { env, encoding: 'utf8', timeout: 10000 });
  const record = () => JSON.parse(readFileSync(join(output, readdirSync(output)[0]), 'utf8'));
  return { root, home, profile, calls, output, env, run, record };
}

test('default CLI denies live execution without opt-in', t => {
  const f = fixture(t);
  const result = f.run();
  assert.equal(result.status, 2);
  assert.match(result.stderr, /--allow-live/);
  assert.equal(existsSync(f.calls), false);
  assert.equal(existsSync(f.output), false);
});

test('one fake run materializes the fixed task, isolates config/dependencies, and redacts every artifact', t => {
  const f = fixture(t);
  const before = ['package.json', 'cordis.yml', 'cordis.patch.yml', 'node_modules/marker'].map(name => readFileSync(join(f.profile, name), 'utf8'));
  const result = f.run(['--allow-live']);
  assert.equal(result.status, 0, result.stderr);
  const calls = readFileSync(f.calls, 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args.slice(0, 3), ['--profile', 'harness-eval', '--json']);
  assert.match(calls[0].args[3], /500000/);
  assert.notEqual(calls[0].home, f.home);
  assert.equal(calls[0].dependency.startsWith(calls[0].dshHome + '/profiles/harness-eval/'), true);
  assert.equal(calls[0].env.includes('UNRELATED_SECRET'), false);
  assert.equal(existsSync(calls[0].home), false);
  assert.equal(existsSync(calls[0].cwd), false);
  const record = f.record();
  assert.equal(record.status, 'completed');
  assert.equal(record.scoring, 'unscored');
  assert.equal(record.observational, true);
  assert.equal(record.captureStatus, 'complete');
  assert.equal(record.exitCode, 0);
  assert.deepEqual(record.tokens, { input: 14, output: 9, total: 23 });
  assert.ok(record.timeMs >= 0);
  assert.ok(Date.parse(record.finishedAt) >= Date.parse(record.startedAt));
  assert.match(record.taskPackSha256, /^[a-f0-9]{64}$/);
  assert.match(record.configSha256, /^[a-f0-9]{64}$/);
  assert.match(record.environmentLimitations.join(' '), /read-only.*quality/);
  assert.equal(record.workspace.files.find(file => file.path === 'observed.txt').content, 'snapshot [REDACTED]');
  assert.match(record.workspace.files.find(file => file.path === 'shipping.mjs').content, /total > 500000/);
  assert.match(record.transcript.stdout, /Bearer \[REDACTED\]/);
  assert.equal(JSON.stringify(record).includes('fake-only-key'), false);
  assert.equal(JSON.stringify(record).includes('fake-bearer'), false);
  assert.deepEqual(['package.json', 'cordis.yml', 'cordis.patch.yml', 'node_modules/marker'].map(name => readFileSync(join(f.profile, name), 'utf8')), before);
});

for (const task of ['ui-evidence', 'permission-boundary']) test(`${task} skips missing evaluator environment without calling DSH`, t => {
  const f = fixture(t);
  const result = f.run(['--allow-live', '--task', task]);
  // Repeated task flags are rejected rather than silently overriding the selection.
  assert.equal(result.status, 2);
  const { record } = collectBaseline(['--allow-live', '--task', task, '--repetition', '2', '--output-dir', f.output], { env: { ...f.env, OR_API_KEY: undefined } });
  assert.equal(record.status, 'environment-unavailable');
  assert.equal(record.captureStatus, 'not-started');
  assert.equal(record.timeMs, null);
  assert.equal(record.tokens.total, null);
  assert.equal(existsSync(f.calls), false);
});

for (const [code, status] of [['ETIMEDOUT', 'timeout'], ['ENOENT', 'capture-error'], ['ENOBUFS', 'capture-error'], [null, 'process-error']]) {
  test(`collector records ${code || 'nonzero exit'} with no retry`, t => {
    const f = fixture(t);
    let calls = 0;
    const { record } = collectBaseline(['--allow-live', '--task', 'bug-boundary', '--repetition', '1', '--output-dir', f.output], {
      env: f.env,
      spawn(command, args, opts) {
        calls++;
        assert.equal(command, 'dsh');
        assert.equal(opts.timeout, 60000);
        assert.equal(opts.killSignal, 'SIGKILL');
        assert.equal(opts.input, '');
        return { status: code ? null : 7, signal: code === 'ETIMEDOUT' ? 'SIGKILL' : null, error: code ? { code } : undefined, stdout: 'partial fake-only-key', stderr: '' };
      }
    });
    assert.equal(calls, 1);
    assert.equal(record.status, status);
    assert.equal(record.captureError, code);
    assert.equal(record.tokens.total, null);
    assert.match(record.transcript.stdout, /\[REDACTED\]/);
  });
}

test('bounded snapshots do not follow symlinks and missing step usage stays unknown', t => {
  const f = fixture(t);
  const { record } = collectBaseline(['--allow-live', '--task', 'bug-boundary', '--repetition', '2', '--output-dir', f.output], {
    env: f.env,
    spawn(command, args, opts) {
      writeFileSync(join(opts.cwd, 'large.txt'), 'x'.repeat(100000));
      symlinkSync(join(f.profile, 'cordis.patch.yml'), join(opts.cwd, 'outside-link'));
      return { status: 0, stdout: [
        { type: 'status', phase: 'step_end', usage: { inputTokens: 10, outputTokens: 2 } },
        { type: 'status', phase: 'step_end' },
        { type: 'final', usage: { inputTokens: 999, outputTokens: 999 } }
      ].map(JSON.stringify).join('\n'), stderr: '' };
    }
  });
  assert.deepEqual(record.tokens, { input: null, output: null, total: null });
  const large = record.workspace.files.find(file => file.path === 'large.txt');
  assert.equal(large.truncated, true);
  assert.equal(large.content.length, 65536);
  assert.equal(record.workspace.files.find(file => file.path === 'outside-link').status, 'symlink-not-followed');
});

test('missing key and unsafe profile never invoke the fake command', t => {
  const f = fixture(t);
  delete f.env.OR_API_KEY;
  assert.equal(f.run(['--allow-live']).status, 2);
  f.env.OR_API_KEY = 'fake-only-key';
  writeFileSync(join(f.profile, 'cordis.patch.yml'), '  apiKeyEnv: OR_API_KEY\n  mode: workspace-write\n');
  assert.equal(f.run(['--allow-live']).status, 2);
  assert.equal(existsSync(f.calls), false);
});
