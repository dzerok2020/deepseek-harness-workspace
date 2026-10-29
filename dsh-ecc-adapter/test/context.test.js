import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { Context } from '@deepseek-ai/cordis';
import Skills from '@deepseek-ai/dsh-skill';
import SystemPrompt, { renderContextSnapshot } from '@deepseek-ai/dsh-system-prompt';
import { createScope, scopeOf } from '@deepseek-ai/dsh-scope';
import { registerEccContext } from '../lib/context.js';

async function setup(t, options = {}, files = {}) {
  const root = await mkdtemp(join(tmpdir(), 'ecc-context-test-'));
  const ctx = new Context();
  const fibers = [ctx.plugin(Skills), ctx.plugin(SystemPrompt)];
  t.after(async () => {
    await ctx.fiber.dispose();
    assert.equal(resolve(root), root);
    assert.ok(root.startsWith(join(tmpdir(), 'ecc-context-test-')));
    await rm(root, { recursive: true, force: true });
  });
  await Promise.all(fibers.map(fiber => fiber.await()));
  for (const [path, body] of Object.entries({
    'skills/alpha/SKILL.md': '---\nname: alpha\ndescription: Alpha fixture\n---\nOriginal skill {{literal}}.',
    'skills/alpha/references/source.txt': 'Original resource',
    'rules/common/testing.md': '# Common\nCommon first {{not-a-variable}}.',
    'rules/typescript/testing.md': '---\npaths: ["**/*.ts"]\n---\n# TS\nTypeScript override.',
    'rules/python/testing.md': '---\npaths: ["**/*.py"]\n---\n# Python\nPython only.',
    ...files,
  })) {
    const full = join(root, path);
    await mkdir(resolve(full, '..'), { recursive: true });
    await writeFile(full, body);
  }
  const state = await registerEccContext(ctx, { eccRoot: root, ...options });
  return { root, ctx, state };
}

test('first-party filesystem provider registers full skills and preserves resource base', async t => {
  const { ctx, root, state } = await setup(t);
  const skills = await ctx.skills.list({ cwd: root });
  assert.equal(skills.length, 1);
  const skill = await ctx.skills.get('alpha', { cwd: root });
  assert.match(skill.content, /Original skill \{\{literal\}\}/);
  assert.equal(skill.resourceBase.path, join(root, 'skills/alpha'));
  assert.equal(state.skills.status, 'provider-registered');
});

test('existing native/user skill wins an ECC name collision', async t => {
  const { ctx, root, state } = await setup(t);
  ctx.skills.registerProvider(() => ({
    name: 'existing',
    list: async () => [{ name: 'alpha', description: 'User owner', rank: 400, provider: 'existing', source: 'user', locator: 'alpha', invocation: { modelInvocable: true, userInvocable: true } }],
    get: async candidate => ({ ...candidate, content: 'User owner body' }),
  }));
  assert.equal((await ctx.skills.get('alpha', { cwd: root })).provider, 'existing');
  const observation = await state.observeSkills(['alpha', 'missing'], { cwd: root });
  assert.equal(observation.complete, true);
  assert.deepEqual(observation.assets, [
    { name: 'alpha', status: 'shadowed', owner: 'existing' },
    { name: 'missing', status: 'unresolved', reason: 'No winning catalog entry was observed.' },
  ]);
  assert.equal(observation.collisions[0].name, 'alpha');
  assert.equal(observation.cwd, root);
});

test('skill diagnostics distinguish registered catalog entries from incomplete discovery', async t => {
  const { ctx, root, state } = await setup(t);
  let observation = await state.observeSkills(['alpha'], { cwd: root });
  assert.deepEqual(observation.assets, [{ name: 'alpha', status: 'native-registered', owner: 'ecc-upstream' }]);
  ctx.skills.registerProvider(() => ({ name: 'incomplete', list: async () => ({ candidates: [], complete: false }), get: async () => undefined }));
  observation = await state.observeSkills(['alpha'], { cwd: root });
  assert.equal(observation.complete, false);
  assert.equal(observation.assets[0].status, 'unresolved');
  assert.match(observation.assets[0].reason, /incomplete/i);
});

test('path rules are scope-local, common-first and preserve literal template text', async t => {
  const { ctx } = await setup(t);
  const first = createScope(ctx, {}), second = createScope(ctx, {});
  t.after(async () => { await first.dispose(); await second.dispose(); });
  const agent = { ctx: first.ctx };
  ctx.emit('tools/result', { agent, arguments: { path: 'src/example.ts' } }, { ok: true });
  const firstText = renderContextSnapshot(await ctx.systemPrompt.assemble({ scope: scopeOf(first.ctx) }));
  const secondText = renderContextSnapshot(await ctx.systemPrompt.assemble({ scope: scopeOf(second.ctx) }));
  assert.match(firstText, /\{\{not-a-variable\}\}/);
  assert.ok(firstText.indexOf('Common first') < firstText.indexOf('TypeScript override'));
  assert.doesNotMatch(firstText, /Python only/);
  assert.doesNotMatch(secondText, /TypeScript override|Python only/);
});

test('native batch-reader paths select all observed languages without crossing Agent scopes', async t => {
  const { ctx } = await setup(t);
  const first = createScope(ctx, {}), second = createScope(ctx, {});
  t.after(async () => { await first.dispose(); await second.dispose(); });
  ctx.emit('tools/result', {
    name: 'ops_read_files', agent: { ctx: first.ctx },
    arguments: { files: [{ path: 'src/example.py' }, { path: 'src/example.ts' }] },
  }, { ok: true });
  const firstText = renderContextSnapshot(await ctx.systemPrompt.assemble({ scope: scopeOf(first.ctx) }));
  const secondText = renderContextSnapshot(await ctx.systemPrompt.assemble({ scope: scopeOf(second.ctx) }));
  assert.match(firstText, /Python only/);
  assert.match(firstText, /TypeScript override/);
  assert.ok(firstText.indexOf('Common first') < firstText.indexOf('Python only'));
  assert.doesNotMatch(secondText, /Python only|TypeScript override/);
});

test('batch observations retain the native 32-file bound and existing path length cap', async t => {
  const { ctx } = await setup(t);
  const scope = createScope(ctx, {});
  t.after(() => scope.dispose());
  const agent = { ctx: scope.ctx };
  ctx.emit('tools/result', { name: 'ops_read_files', agent, arguments: {
    files: [...Array.from({ length: 32 }, (_, i) => ({ path: `docs/${i}.txt` })), { path: 'ignored.py' }],
  } }, { ok: true });
  ctx.emit('tools/result', { name: 'ops_read_files', agent, arguments: {
    files: [null, 'invalid.py', {}, { path: `${'x'.repeat(4097)}.py` }],
  } }, { ok: true });
  assert.doesNotMatch(renderContextSnapshot(await ctx.systemPrompt.assemble({ scope: scopeOf(scope.ctx) })), /Python only/);
  ctx.emit('tools/result', { name: 'ops_read_files', agent, arguments: { files: [{ path: 'src/valid.py' }] } }, { ok: true });
  assert.match(renderContextSnapshot(await ctx.systemPrompt.assemble({ scope: scopeOf(scope.ctx) })), /Python only/);
});

test('the default budget includes ordinary TypeScript rule context larger than 64 KiB', async t => {
  const largeRule = `---\npaths: ["**/*.ts"]\n---\n# TS\nTypeScript override.\n${'x'.repeat(68541)}`;
  const { ctx, state } = await setup(t, {}, { 'rules/typescript/testing.md': largeRule });
  const scope = createScope(ctx, {});
  t.after(() => scope.dispose());
  ctx.emit('tools/result', { agent: { ctx: scope.ctx }, arguments: { path: 'src/example.ts' } }, { ok: true });
  const text = renderContextSnapshot(await ctx.systemPrompt.assemble({ scope: scopeOf(scope.ctx) }));
  assert.equal(state.rules.maxBytes, 131072);
  assert.match(text, /Common first/);
  assert.match(text, /TypeScript override/);
  assert.doesNotMatch(text, /unavailable|omitted/i);
});

test('a smaller overflowing budget retains common rules and explicitly omits language rules', async t => {
  const { ctx, state } = await setup(t, { maxRuleBytes: 600 }, {
    'rules/typescript/testing.md': `---\npaths: ["**/*.ts"]\n---\n# TS\nTypeScript override.\n${'x'.repeat(1000)}`,
  });
  const first = createScope(ctx, {}), second = createScope(ctx, {});
  t.after(async () => { await first.dispose(); await second.dispose(); });
  ctx.emit('tools/result', { agent: { ctx: first.ctx }, arguments: { path: 'src/example.ts' } }, { ok: true });
  const text = renderContextSnapshot(await ctx.systemPrompt.assemble({ scope: scopeOf(first.ctx) }));
  assert.match(text, /Common first \{\{not-a-variable\}\}/);
  assert.match(text, /ECC rules partial.*600-byte.*language-specific.*omitted/i);
  assert.doesNotMatch(text, /TypeScript override/);
  assert.ok(Buffer.byteLength(text, 'utf8') <= 600);
  assert.equal(state.rules.status, 'budget-partial');
  const commonOnly = renderContextSnapshot(await ctx.systemPrompt.assemble({ scope: scopeOf(second.ctx) }));
  assert.match(commonOnly, /Common first/);
  assert.doesNotMatch(commonOnly, /partial|omitted/i);
  assert.equal(state.rules.status, 'native-registered');
});

test('tight partial budget prioritizes complete common rules over duplicated context boilerplate', async t => {
  const { ctx, state } = await setup(t, { maxRuleBytes: 300 }, {
    'rules/typescript/testing.md': `---\npaths: ["**/*.ts"]\n---\n${'x'.repeat(1000)}`,
  });
  const scope = createScope(ctx, {});
  t.after(() => scope.dispose());
  ctx.emit('tools/result', { agent: { ctx: scope.ctx }, arguments: { files: [{ path: 'src/example.ts' }] } }, { ok: true });
  const assembly = await ctx.systemPrompt.assemble({ scope: scopeOf(scope.ctx) });
  const context = assembly.contexts.find(entry => entry.name === 'ecc-upstream-rules').text;
  assert.match(context, /Common first \{\{not-a-variable\}\}/);
  assert.match(context, /ECC rules partial.*language-specific.*omitted/i);
  assert.ok(Buffer.byteLength(context, 'utf8') <= 300);
  assert.equal(state.rules.status, 'budget-partial');
});

test('pinned ECC TypeScript rules fit the default budget with faithful upstream globs', { skip: !process.env.ECC_ROOT }, async t => {
  const ctx = new Context();
  t.after(() => ctx.fiber.dispose());
  await Promise.all([ctx.plugin(Skills), ctx.plugin(SystemPrompt)].map(fiber => fiber.await()));
  const state = await registerEccContext(ctx, { eccRoot: process.env.ECC_ROOT });
  const scope = createScope(ctx, {});
  t.after(() => scope.dispose());
  ctx.emit('tools/result', { agent: { ctx: scope.ctx }, arguments: { files: [{ path: 'src/example.ts' }] } }, { ok: true });
  const text = renderContextSnapshot(await ctx.systemPrompt.assemble({ scope: scopeOf(scope.ctx) }));
  assert.equal(state.rules.maxBytes, 131072);
  assert.equal((text.match(/^### ECC /gm) ?? []).length, 29);
  assert.match(text, /### ECC common\//);
  assert.match(text, /### ECC typescript\//);
  assert.doesNotMatch(text, /ECC rules unavailable|ECC rules partial/);
  assert.equal(state.rules.status, 'native-registered');
});

test('rule budget overflow is explicit instead of silently dropping upstream rules', async t => {
  const { ctx, state } = await setup(t, { maxRuleBytes: 12 });
  const text = renderContextSnapshot(await ctx.systemPrompt.assemble());
  assert.match(text, /ECC rules unavailable.*budget/i);
  assert.equal(state.rules.status, 'budget-exceeded');
});
