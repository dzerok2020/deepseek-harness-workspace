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

await test('LeanRea content and MIT license match the pinned upstream', async () => {
  assert.equal(
    sha256(skill.replace('disable-model-invocation: true\n', '')),
    '53581bd7fb1fae4352ab43252e67b84667b68895a68e372b99d302b58d9c782d',
  );
  const license = await readFile(new URL('LICENSE', skillUrl));
  assert.equal(
    sha256(license),
    'f126681f66a89b4f610999a64f1a1fc6da98d221a39f65799a6d6bb6e051d922',
  );
});

await test('DSH native provider discovers and loads LeanRea for manual use only', async () => {
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
  const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh');
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
    const options = { cwd: realpathSync(workspace), signal: controller.signal };
    const candidates = await provider.list(options);
    const matches = candidates.filter((candidate) => candidate.name === 'leanrea');
    assert.equal(matches.length, 1);
    const loaded = await provider.get(matches[0], options);
    assert.equal(loaded.name, 'leanrea');
    assert.ok(loaded.content.includes('## Router'));
    assert.deepEqual(loaded.invocation, { modelInvocable: false, userInvocable: true });
  } finally {
    await provider?.dispose();
    controller.abort();
    hooks.deregister();
  }
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
