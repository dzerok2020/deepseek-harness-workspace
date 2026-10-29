import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../tools/dsh-health.sh', import.meta.url), 'utf8');

function section(start, end) {
  const first = source.indexOf(start);
  const last = source.indexOf(end, first + start.length);
  assert.ok(first >= 0 && last > first, `missing health section: ${start}`);
  return source.slice(first, last);
}

// Execute the real argument parser and the two affected sections, not the full
// health script: its unrelated regression runners would recursively run us.
// No fixture files, real profile, network, Git or child executors are used.
const prologue = section('#!/usr/bin/env bash', '# Sandbox của agent');
const configCheck = section('head_ "2.', 'head_ "3.');
const memoryCheck = section('head_ "10b.', 'head_ "11.');
const mocks = String.raw`
exec 3>&2
record() {
  printf 'CALL %s' "$1" >&3; shift
  if (( $# )); then printf ' <%s>' "$@" >&3; fi
  printf '\n' >&3
}
cd() { :; }
pwd() { printf '/mock\n'; }
dirname() { printf '/mock/tools\n'; }
dsh() {
  record dsh "$@"
  printf 'mock generated profile\n'
  return "$MOCK_DUMP_RC"
}
python3() { record python3 "$@"; return "$MOCK_PYTHON_RC"; }
node() {
  record node "$@"
  printf 'NODE_CODE\t%s\nNODE_PATH\t%s\n' "$2" "$3" >&3
  if [[ "$MOCK_NODE_RC" == 0 && "$MOCK_NODE_EMPTY" == 0 ]]; then printf '1\n'; fi
  return "$MOCK_NODE_RC"
}
mktemp() { record mktemp; printf '/dev/null\n'; }
rm() { record rm "$@"; }
wc() { record wc "$@"; printf '7\n'; }
grep() { return 1; }
head() { printf 'mock profile diagnostic\n'; }
sed() { local line; while IFS= read -r line; do printf '%s\n' "$line"; done; }
function [() {
  if [[ "$1" == -r && "$2" == /mock/profiles/web/cordis.yml ]]; then
    [[ "$CONFIG_PRESENT" == 1 ]]
  elif [[ "$1" == -s && "$2" == /dev/null ]]; then
    [[ "$MOCK_DUMP_WARNING" == 1 ]]
  else
    builtin [ "$@"
  fi
}
`;

function runHealth(args = [], env = {}, checks = `${configCheck}\n${memoryCheck}`) {
  const result = spawnSync('/bin/bash', ['-c', `${mocks}\n${prologue}\n${checks}\nprintf 'COUNTS %s %s %s\\n' "$PASS" "$FAIL" "$SKIP"`, 'dsh-health-test', ...args], {
    encoding: 'utf8',
    env: {
      PATH: '/no-external-commands', HOME: '/mock', DSH_HOME: '/mock',
      CONFIG_PRESENT: '1', MOCK_DUMP_RC: '0', MOCK_PYTHON_RC: '0', MOCK_DUMP_WARNING: '0', MOCK_NODE_RC: '0', MOCK_NODE_EMPTY: '0', ...env,
    },
  });
  assert.equal(result.error, undefined);
  return { ...result, calls: result.stderr.split('\n').filter(line => line.startsWith('CALL ')).map(line => line.slice(5)) };
}

function calls(result, command) {
  return result.calls.filter(line => line === command || line.startsWith(`${command} <`));
}

function assertNoRegeneration(result) {
  assert.deepEqual(calls(result, 'dsh'), []);
  assert.deepEqual(calls(result, 'mktemp'), []);
  assert.deepEqual(calls(result, 'rm'), []);
}

test('default reads existing generated config without regeneration or functional opt-in', () => {
  const result = runHealth();
  assert.equal(result.status, 0, result.stderr);
  assertNoRegeneration(result);
  assert.deepEqual(calls(result, 'wc'), ['wc <-l> </mock/profiles/web/cordis.yml>']);
  assert.deepEqual(calls(result, 'python3'), ['python3 </mock/tools/hindsight-health.py>']);
  assert.match(result.stdout, /BỎ QUA[^\n]*--refresh-config/);
  assert.match(result.stdout, /BỎ QUA[^\n]*--functional/);
  assert.doesNotMatch(result.stdout, /Hindsight qua kiểm chứng chức năng/);
});

test('missing generated config is honestly skipped without a repair attempt', () => {
  const result = runHealth([], { CONFIG_PRESENT: '0' });
  assert.equal(result.status, 0, result.stderr);
  assertNoRegeneration(result);
  assert.deepEqual(calls(result, 'wc'), []);
  assert.match(result.stdout, /BỎ QUA[^\n]*cordis\.yml/);
  assert.match(result.stdout, /--refresh-config/);
});

test('only --refresh-config permits the mocked dump-config command', () => {
  const result = runHealth(['--refresh-config']);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(calls(result, 'dsh'), ['dsh <--profile> <web> <--dump-config>']);
  assert.equal(calls(result, 'mktemp').length, 2);
  assert.deepEqual(calls(result, 'python3'), ['python3 </mock/tools/hindsight-health.py>']);
  assert.match(result.stdout, /dump-config chạy thành công/);
  assert.match(result.stdout, /BỎ QUA[^\n]*--functional/);
});

test('only --functional forwards the mocked LLM opt-in to Hindsight', () => {
  const result = runHealth(['--functional']);
  assert.equal(result.status, 0, result.stderr);
  assertNoRegeneration(result);
  assert.deepEqual(calls(result, 'python3'), ['python3 </mock/tools/hindsight-health.py> <--functional>']);
  assert.doesNotMatch(result.stdout, /BỎ QUA[^\n]*--functional/);
});

test('both independent opt-ins can be combined', () => {
  const result = runHealth(['--functional', '--refresh-config']);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(calls(result, 'dsh'), ['dsh <--profile> <web> <--dump-config>']);
  assert.deepEqual(calls(result, 'python3'), ['python3 </mock/tools/hindsight-health.py> <--functional>']);
});

test('regeneration errors and stderr warnings still fail their diagnostics', () => {
  for (const env of [{ MOCK_DUMP_RC: '1' }, { MOCK_DUMP_WARNING: '1' }]) {
    const result = runHealth(['--refresh-config'], env);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /LỖI/);
    assert.match(result.stdout, /COUNTS \d+ 1 \d+/);
    assert.match(result.stdout, /mock profile diagnostic/);
  }
});

test('passive and functional Hindsight errors remain failures', () => {
  for (const args of [[], ['--functional']]) {
    const result = runHealth(args, { MOCK_PYTHON_RC: '1' });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /LỖI[^\n]*Hindsight/);
    assert.match(result.stdout, /COUNTS \d+ 1 \d+/);
  }
});

test('unknown flags fail closed before any health executor', () => {
  for (const arg of ['--refesh-config', '--functonal', '--functional=1']) {
    const result = runHealth([arg]);
    assert.equal(result.status, 2, result.stdout);
    assert.deepEqual(result.calls, []);
  }
});

test('apostrophes in DSH_HOME stay data for all inline Node config probes', () => {
  const home = "/mock/O'Reilly";
  const probeLines = source.split('\n').filter(line => line.includes('node -p ')).map(line => {
    const command = line.match(/\$\((node -p .*)\)/);
    assert.ok(command, 'inline Node probe must remain covered');
    return command[1];
  }).join('\n');
  const result = runHealth([], { DSH_HOME: home }, probeLines);
  assert.equal(result.status, 0, result.stderr);
  const codes = [...result.stderr.matchAll(/^NODE_CODE\t(.*)$/gm)].map(match => match[1]);
  const paths = [...result.stderr.matchAll(/^NODE_PATH\t(.*)$/gm)].map(match => match[1]);
  const fixtures = new Map([
    [`${home}/profiles/web/package.json`, { dsh: { profile: { bundles: ['guard'] } } }],
    [`${home}/loop-guard-status.json`, { enabled: true, counters: { assemblies: 1, freezes: 2, reinserts: 3 }, activeSessions: 4 }],
    [`${home}/profiles/web/node_modules/@deepseek-ai/dsh-skill-filesystem/package.json`, { version: '0.3.2' }],
    [`${home}/profiles/web/node_modules/@openviking/dsh-memory-plugin/package.json`, { version: '0.5.19' }],
  ]);
  assert.equal(codes.length, fixtures.size);
  for (const [index, path] of [...fixtures.keys()].entries()) {
    const loaded = [];
    runInNewContext(codes[index], {
      process: { argv: ['node', paths[index]] },
      require(file) {
        loaded.push(file);
        assert.ok(fixtures.has(file), `unexpected config read: ${file}`);
        return fixtures.get(file);
      },
    });
    assert.equal(paths[index], path);
    assert.deepEqual(loaded, [path]);
    assert.ok(!codes[index].includes(home), 'path must not be interpolated into JavaScript source');
  }
});

test('a failed or empty Node bundle probe never reports a passing bundle count', () => {
  for (const env of [{ MOCK_NODE_RC: '1' }, { MOCK_NODE_EMPTY: '1' }]) {
    const result = runHealth([], env, section('head_ "3.', 'head_ "4.'));
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /LỖI[^\n]*không đọc được package\.json/);
    assert.doesNotMatch(result.stdout, /ĐẠT[^\n]*số bundle:/);
  }
});

test('help explains opt-in effects without running health executors', () => {
  const result = runHealth(['--help']);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.calls, []);
  assert.match(result.stdout, /--refresh-config/);
  assert.match(result.stdout, /--functional/);
  assert.match(result.stdout, /LLM/);
});
