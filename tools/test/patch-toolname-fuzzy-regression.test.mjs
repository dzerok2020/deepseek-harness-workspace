import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Execute only in a VM with an in-memory filesystem. No installed bundle is read
// or patched and the syntax-check command is a local VM parse, not a child process.
const source = readFileSync(new URL('../patch-toolname-fuzzy.mjs', import.meta.url), 'utf8')
  .replace(/^import .*;\n/gm, '');
const target = '/fixture/index.js';
const backup = target + '.dsh-fuzzy-toolname.bak';
const bundle = (version) => `const release = '${version}';
class Tools {
\tresolveExecution(name, scope, nested) {
\t\tconst tool = this.get(name, scope);
\t\tif (tool === void 0) return void 0;
\t\tif (this.collapses(name, scope, nested)) return void 0;
\t\treturn tool;
\t}
}
`;

function run(mode, text, staleBackup) {
  const files = new Map([[target, text]]);
  if (staleBackup !== undefined) files.set(backup, staleBackup);
  const output = [];
  const writes = [];
  const read = (path) => {
    assert.ok(files.has(path), 'unexpected read: ' + path);
    return files.get(path);
  };
  const context = vm.createContext({
    process: { argv: ['node', '/fixture/patch.mjs', mode, target], execPath: '/fixture/node', exitCode: 0 },
    console: { log: (line) => output.push(line), error: (line) => output.push(line) },
    existsSync: (path) => files.has(path), readFileSync: read,
    writeFileSync: (path, value) => { writes.push(path); files.set(path, value); },
    copyFileSync: (from, to) => { writes.push(to); files.set(to, read(from)); },
    renameSync: (from, to) => { writes.push(to); files.set(to, read(from)); files.delete(from); },
    rmSync: (path) => files.delete(path),
    execFileSync: (command, args) => {
      assert.equal(command, '/fixture/node');
      assert.equal(args[0], '--check');
      new vm.Script(read(args[1]));
    },
  });
  vm.runInContext(source, context, { timeout: 1000 });
  return { code: context.process.exitCode, text: files.get(target), files, writes, report: JSON.parse(output.at(-1)) };
}

function applied(version = 'upgraded') {
  const result = run('--apply', bundle(version));
  assert.equal(result.code, 0, JSON.stringify(result.report));
  return result.text;
}

test('revert leaves the upgraded unpatched current bundle intact despite a stale backup', () => {
  const current = bundle('upgraded');
  const result = run('--revert', current, bundle('obsolete'));
  assert.equal(result.code, 0);
  assert.equal(result.text, current);
  assert.equal(result.report.changed, false);
  assert.deepEqual(result.writes, []);
});

test('revert removes exact injected regions from upgraded CURRENT, never copies stale backup', () => {
  const result = run('--revert', applied(), bundle('obsolete'));
  assert.equal(result.code, 0, JSON.stringify(result.report));
  assert.equal(result.text, bundle('upgraded'));
  assert.equal(result.files.get(backup), bundle('obsolete'));
  assert.equal(result.report.changed, true);
});

test('revert works without a backup and is idempotent', () => {
  const result = run('--revert', applied());
  assert.equal(result.code, 0);
  assert.equal(result.text, bundle('upgraded'));
  const again = run('--revert', result.text);
  assert.equal(again.code, 0);
  assert.equal(again.report.changed, false);
});

for (const [name, mutate] of [
  ['edited injected head', (text) => text.replace('let lookup = name;', 'let lookup = String(name);')],
  ['missing collapse injection', (text) => text.replace('this.collapses(lookup, scope, nested)', 'this.collapses(name, scope, nested)')],
  ['missing marker', (text) => text.replace('[dsh-fuzzy-toolname]', 'removed-marker')],
  ['duplicate injected regions', (text) => text + text],
  ['injected regions outside the supported method', (text) => text.replace('resolveExecution(name, scope, nested)', 'otherMethod(name, scope, nested)')],
]) {
  test(`revert rejects ${name} without writing current or trusting backup`, () => {
    const current = mutate(applied());
    const result = run('--revert', current, bundle('obsolete'));
    assert.notEqual(result.code, 0, 'drift must fail closed');
    assert.equal(result.text, current);
    assert.deepEqual(result.writes, []);
  });
}

test('apply and verify retain behavior and already-applied idempotence', () => {
  const patched = applied();
  assert.equal(run('--verify', patched).report.ok, true);
  const again = run('--apply', patched, bundle('obsolete'));
  assert.equal(again.code, 0);
  assert.equal(again.report.changed, false);
  assert.equal(again.text, patched);
});
