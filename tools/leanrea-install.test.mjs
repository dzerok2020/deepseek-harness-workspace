import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createRequire, registerHooks } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const workspace = new URL('../', import.meta.url);
const skillUrl = new URL('.dsh/skills/leanrea/SKILL.md', workspace);
const skill = await readFile(skillUrl, 'utf8');
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh');
const globalSkillPath = join(dshHome, 'skills/leanrea/SKILL.md');

await test('LeanRea project and global copies match the pinned upstream and MIT license', async () => {
  assert.equal(
    sha256(skill
      .replace(/^description: .*$/m, 'description: Reverse engineer shipped software with plain local CLI tools, no MCP needed. Covers Electron/JS bundles, native Mach-O/ELF/PE, Go/Rust/.NET/Flutter/WASM binaries, APKs, SQLite, pcaps, firmware and websites. Use to explain how a feature works, extract versions/deps, compare builds, or rebuild a feature.')
      .replace(/^disable-model-invocation: (?:true|false)\n/m, '')
      .replace(/<!-- DSH adapter start -->\n[\s\S]*?<!-- DSH adapter end -->\n\n/, '')),
    '53581bd7fb1fae4352ab43252e67b84667b68895a68e372b99d302b58d9c782d',
  );
  const license = await readFile(new URL('LICENSE', skillUrl));
  assert.equal(
    sha256(license),
    'f126681f66a89b4f610999a64f1a1fc6da98d221a39f65799a6d6bb6e051d922',
  );
  assert.equal(await readFile(globalSkillPath, 'utf8'), skill);
  assert.deepEqual(await readFile(join(dshHome, 'skills/leanrea/LICENSE')), license);
});

await test('DSH loads auto-invocable LeanRea in project and outside workspaces', async () => {
  const dshBinary = execFileSync('which', ['dsh'], { encoding: 'utf8' }).trim();
  const host = createRequire(realpathSync(dshBinary));
  // Match the running DSH host's dependency resolution without changing packages.
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      try {
        return nextResolve(specifier, context);
      } catch (error) {
        if (error.code !== 'ERR_MODULE_NOT_FOUND' || !specifier.startsWith('@deepseek-ai/')) {
          throw error;
        }
        return nextResolve(pathToFileURL(host.resolve(specifier)).href, context);
      }
    },
  });
  const providerUrl = pathToFileURL(join(
    dshHome,
    'profiles/web/node_modules/@deepseek-ai/dsh-skill-filesystem/lib/index.js',
  ));
  let provider;
  const controller = new AbortController();
  try {
    const { FileSystemSkillProvider } = await import(providerUrl.href);
    provider = new FileSystemSkillProvider(
      { logger: console, get() {} },
      { signal: controller.signal, invalidate() {} },
      { watch: false, dshHome },
    );
    const scopes = [
      { cwd: realpathSync(workspace), source: 'project-dsh', path: realpathSync(skillUrl) },
      { cwd: '/tmp', source: 'user-dsh', path: globalSkillPath },
    ];
    for (const scope of scopes) {
      const options = { cwd: scope.cwd, signal: controller.signal };
      const candidates = await provider.list(options);
      const matches = candidates.filter((candidate) => (
        candidate.name === 'leanrea' && candidate.source === scope.source
      ));
      assert.equal(matches.length, 1, `LeanRea missing from ${scope.source} at ${scope.cwd}`);
      const loaded = await provider.get(matches[0], options);
      assert.equal(loaded.name, 'leanrea');
      assert.equal(loaded.path, realpathSync(scope.path));
      assert.equal(loaded.source, scope.source);
      assert.ok(loaded.content.includes('## Router'));
      assert.deepEqual(loaded.invocation, { modelInvocable: true, userInvocable: true });
      assert.match(loaded.description, /phân tích phần mềm <tệp\/thư mục\/link>/);
      assert.ok(loaded.content.includes('## DSH auto-invocation and safety'));
    }
  } finally {
    await provider?.dispose();
    controller.abort();
    hooks.deregister();
  }
});

await test('LeanRea advertises the short Vietnamese trigger with explicit read-only safeguards', () => {
  assert.match(skill, /^description: .*phân tích phần mềm <tệp\/thư mục\/link>/m);
  assert.match(skill, /^description: .*Not for general document\/data analysis or routine code review\.$/m);
  assert.equal((skill.match(/<!-- DSH adapter start -->/g) || []).length, 1);
  assert.equal((skill.match(/<!-- DSH adapter end -->/g) || []).length, 1);
  assert.ok(skill.includes('Default to read-only static analysis with tools already installed.'));
  assert.ok(skill.includes('Do not install tools or packages'));
  assert.ok(skill.includes('execute target software/scripts'));
  assert.ok(skill.includes('delete/move/overwrite user files'));
  assert.ok(skill.includes('unless the user explicitly authorizes that specific action'));
  assert.ok(skill.includes('Generic urgency or "do it all" is not authorization.'));
});

await test('LeanRea controlled pipeline resources are synchronized and callable outside the workspace', async () => {
  for (const relative of ['scripts/static_pipeline.py', 'scripts/public_https.py', 'references/static-pipeline.md']) {
    assert.deepEqual(await readFile(join(dshHome, 'skills/leanrea', relative)), await readFile(new URL(relative, skillUrl)));
  }
  assert.ok(skill.includes('scripts/static_pipeline.py'));
  assert.ok(skill.includes('references/static-pipeline.md'));
  const help = execFileSync('python3', [join(dshHome, 'skills/leanrea/scripts/static_pipeline.py'), '--help'], { cwd: '/tmp', encoding: 'utf8' });
  assert.ok(help.includes('--download'));
  assert.ok(help.includes('--output-root'));
});

await test('LeanRea installation notes retain sources and valid Markdown structure', async () => {
  const notes = await readFile(new URL('docs/leanrea-install-notes.md', workspace), 'utf8');
  assert.equal((notes.match(/\]\(https:/g) || []).length, 26);
  for (const content of [skill, notes]) {
    assert.ok(content.endsWith('\n'));
    assert.ok(content.split('\n').every((line) => line === line.trimEnd()));
    assert.equal((content.match(/^```/gm) || []).length, 4);
  }
  const lines = notes.split('\n');
  assert.ok(!lines.some((line, index) => (
    /^\|/.test(line) && index > 0 && lines[index - 1].trim() && !/^\|/.test(lines[index - 1])
  )));
});
