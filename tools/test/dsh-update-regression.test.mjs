import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const version = '0.2.1-rc.2';
const previous = '0.1.9-rc.4';
const names = ['package.json', 'pnpm-workspace.yaml', 'pnpm-lock.yaml', 'cordis.patch.yml'];
const unpatched = '\tif (/\\b5\\d\\d\\b/.test(message)) return "SERVER";\n\tif (/\\btime(?:d)?\\s*out\\b|timeout/i.test(message)) return "TIMEOUT";\n';
const injected = '\ttry {\n\t\tconst payload = JSON.parse(message);\n\t\tconst error = payload?.type === "error" ? payload.error : void 0;\n\t\tif (error?.type === "server_error" || error?.type === "overloaded_error") return "SERVER";\n\t} catch {\n\t\t// Non-JSON messages retain the existing text-based classification.\n\t}\n';
const patched = unpatched.replace('\tif (/\\btime', injected + '\tif (/\\btime');

function fixture(t, installBody = unpatched) {
  const root = mkdtempSync(join(tmpdir(), 'dsh-update-offline-'));
  t.after(() => { assert.ok(root.startsWith(join(tmpdir(), 'dsh-update-offline-'))); rmSync(root, { recursive: true, force: true }); });
  const bin = join(root, 'bin');
  const tools = join(root, 'tools');
  const profile = join(root, '.dsh/profiles/web');
  const target = join(root, 'global/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-llm-pi-ai');
  for (const path of [bin, tools, profile, join(target, 'lib'), join(profile, 'node_modules/@deepseek-ai/dsh-skill-filesystem')]) mkdirSync(path, { recursive: true });
  copyFileSync(new URL('../dsh-update.sh', import.meta.url), join(tools, 'dsh-update.sh'));
  copyFileSync(new URL('../dsh-pi-ai-overload.patch', import.meta.url), join(tools, 'dsh-pi-ai-overload.patch'));
  writeFileSync(join(root, 'version'), previous);
  writeFileSync(join(root, 'install-body'), installBody);
  writeFileSync(join(target, 'lib/index.js'), unpatched);
  writeFileSync(join(profile, 'package.json'), '{"pnpm":{"overrides":{"@deepseek-ai/dsh-skill-filesystem": "0.2.0-rc.2"}}}\n');
  writeFileSync(join(profile, 'pnpm-workspace.yaml'), "overrides:\n  '@deepseek-ai/dsh-skill-filesystem': 0.2.0-rc.2\n");
  writeFileSync(join(profile, 'pnpm-lock.yaml'), 'original lock\n');
  writeFileSync(join(profile, 'cordis.patch.yml'), 'original cordis\n');
  writeFileSync(join(profile, 'node_modules/@deepseek-ai/dsh-skill-filesystem/package.json'), '{}');
  const originals = Object.fromEntries(names.map((name) => [name, readFileSync(join(profile, name), 'utf8')]));
  const stub = `#!${process.execPath}
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
const root = process.env.OFFLINE_ROOT;
if (!root || !root.includes('dsh-update-offline-')) throw new Error('unsafe fixture root');
const name = basename(process.argv[1]);
const args = process.argv.slice(2);
appendFileSync(join(root, 'commands'), JSON.stringify({name,args}) + '\\n');
if (name === 'dsh') console.log(readFileSync(join(root,'version'),'utf8'));
else if (name === 'npm' && args.join(' ') === 'root -g') console.log(join(root, 'global'));
else if (name === 'npm' && args[0] === 'install') {
  if (args[1] !== '-g' || !/^@deepseek-ai\\/dsh@[0-9A-Za-z.+-]+$/.test(args[2])) throw new Error('unexpected install');
  writeFileSync(join(root, 'version'), args[2].split('@').at(-1));
  writeFileSync(join(root,'global/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-llm-pi-ai/lib/index.js'), readFileSync(join(root,'install-body')));
} else if (name === 'pnpm') { if (args[0] === 'list') console.log('@deepseek-ai/dsh-skill-filesystem'); }
else if (name === 'patch') {
  const at = args.indexOf('-d');
  if (at < 0 || !resolve(args[at+1]).startsWith(root + '/global/')) throw new Error('patch escaped fixture');
  const result = spawnSync('/usr/bin/patch', args, {stdio: 'inherit'});
  process.exit(result.status ?? 99);
} else if (name !== 'ss') throw new Error('unexpected command ' + name);
`;
  for (const name of ['npm', 'pnpm', 'dsh', 'ss', 'patch']) writeFileSync(join(bin, name), stub, { mode: 0o755 });
  function run(...args) {
    const result = spawnSync('/bin/bash', [join(tools, 'dsh-update.sh'), ...args], {
      env: { ...process.env, HOME: root, PATH: bin + ':/usr/bin:/bin', OFFLINE_ROOT: root },
      encoding: 'utf8', timeout: 10000,
    });
    assert.equal(result.error, undefined);
    return result;
  }
  const commands = () => { try { return readFileSync(join(root, 'commands'), 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse); } catch { return []; } };
  function backup(savedVersion = previous) {
    const dir = join(root, '.dsh/backups/dsh-update-20000101-000000');
    mkdirSync(dir, { recursive: true });
    for (const name of names) writeFileSync(join(dir, name), originals[name]);
    if (savedVersion !== null) writeFileSync(join(dir, 'cli-version'), savedVersion + '\n');
    for (const name of names) writeFileSync(join(profile, name), 'upgraded ' + name + '\n');
    return dir;
  }
  return { root, profile, target, originals, run, commands, backup };
}

for (const [name, body] of [['fresh install', unpatched], ['already applied install', patched]]) {
  test('update preserves managed overload patch for ' + name, (t) => {
    const f = fixture(t, body);
    const result = f.run();
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(readFileSync(join(f.target, 'lib/index.js'), 'utf8'), patched);
    const patches = f.commands().filter(({ name }) => name === 'patch');
    assert.ok(patches.length >= 2, 'must check forward then apply or reverse');
    assert.ok(patches.every(({ args }) => args.includes('--fuzz=0')));
    assert.ok(patches[0].args.includes('--dry-run'));
    if (body === patched) assert.ok(patches.some(({ args }) => args.includes('--reverse') && args.includes('--dry-run')));
  });
}

test('update rejects source drift without profile install or partial patch', (t) => {
  const drift = 'unsupported upgraded provider\n';
  const f = fixture(t, drift);
  const result = f.run();
  assert.notEqual(result.status, 0, result.stdout + result.stderr);
  assert.equal(readFileSync(join(f.target, 'lib/index.js'), 'utf8'), drift);
  assert.ok(!f.commands().some(({ name, args }) => name === 'pnpm' && args[0] === 'install'));
});

test('update records the actual old CLI version, not a hardcoded rollback version', (t) => {
  const f = fixture(t);
  const result = f.run();
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const backups = join(f.root, '.dsh/backups');
  const dir = readdirSync(backups).find((name) => name.startsWith('dsh-update-'));
  assert.equal(readFileSync(join(backups, dir, 'cli-version'), 'utf8'), previous + '\n');
});

test('rollback installs captured CLI, reapplies patch, and restores ALL four profile files', (t) => {
  const f = fixture(t);
  f.backup();
  const result = f.run('--rollback');
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const install = f.commands().find(({ name, args }) => name === 'npm' && args[0] === 'install');
  assert.equal(install.args[2], '@deepseek-ai/dsh@' + previous);
  assert.equal(readFileSync(join(f.target, 'lib/index.js'), 'utf8'), patched);
  for (const name of names) assert.equal(readFileSync(join(f.profile, name), 'utf8'), f.originals[name], name);
});

for (const [name, savedVersion] of [['missing', null], ['malformed', '0.1.9;bad']]) {
  test('rollback rejects ' + name + ' CLI provenance before install', (t) => {
    const f = fixture(t);
    f.backup(savedVersion);
    const result = f.run('--rollback');
    assert.notEqual(result.status, 0, result.stdout + result.stderr);
    assert.ok(!f.commands().some(({ name, args }) => name === 'npm' && args[0] === 'install'));
  });
}

test('rollback rejects absent fourth backup before install or profile restoration', (t) => {
  const f = fixture(t);
  const backup = f.backup();
  rmSync(join(backup, 'cordis.patch.yml'));
  const result = f.run('--rollback');
  assert.notEqual(result.status, 0, result.stdout + result.stderr);
  assert.ok(!f.commands().some(({ name, args }) => name === 'npm' && args[0] === 'install'));
});
