import test from 'node:test';
import assert from 'node:assert/strict';
import { Context } from '@deepseek-ai/cordis';
import Tools from '@deepseek-ai/dsh-tools';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { registerPayloadHooks } from '../lib/payload-hooks.js';

const receipt = { status: 'completed', complete: true, changed: 1, dryRun: false };
const write = (file_path = '/workspace/src/private-path.ts', content = 'console.log("private-payload");') => ({ file_path, content });
const edit = (file_path = '/workspace/src/a.ts', new_string = 'console.log(1);') => ({ file_path, old_string: 'before', new_string });
const normalized = value => typeof value === 'string' ? value.replaceAll('\r\n', '\n') : value;
// Public JSON Schema equivalent of native dsh-tool-fs 0.2.1-rc.2 output, not render text.
const nativeSchemas = {
  write: { type: 'object', additionalProperties: false, required: ['path', 'operation', 'before', 'after'], properties: { path: { type: 'string' }, operation: { type: 'string', enum: ['create', 'update'] }, before: { oneOf: [{ type: 'string' }, { type: 'null' }] }, after: { type: 'string' } } },
  edit: { type: 'object', additionalProperties: false, required: ['path', 'before', 'after'], properties: { path: { type: 'string' }, before: { type: 'string' }, after: { type: 'string' } } },
};
const nativeWrite = args => ({ path: args.file_path, operation: 'create', before: null, after: normalized(args.content) });
const nativeEdit = args => ({ path: args.file_path, before: normalized(args.old_string), after: normalized(args.new_string) });
const opsWrite = (path = 'src/a.ts', content = 'console.log(1);') => ({ path, content, expectedRevision: 'absent' });
const opsEdit = (edits = [{ oldText: 'before', newText: 'console.log(1);' }]) => ({ path: 'src/a.ts', expectedRevision: 'a'.repeat(64), edits });
const warnings = result => (result.additionalContexts ?? []).filter(message => message.source?.kind === 'ecc-payload-console-warning');
const text = message => message.content.map(block => block.text ?? '').join('\n');

async function host(t, bodies = {}) {
  const ctx = new Context();
  t.after(() => ctx.fiber.dispose());
  await ctx.plugin(SystemPrompt).await();
  await ctx.plugin(Tools, {}).await();
  const calls = [];
  for (const name of ['write', 'edit', 'ops_write_file', 'ops_edit_file', 'ops_replace', 'unknown_write']) {
    ctx.tools.register({ name, description: 'Inert fixture, no filesystem effects', parameters: {},
      output: { schema: bodies[name] ? {} : nativeSchemas[name] ?? {}, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
      async execute(args, execution) {
        calls.push(name);
        return bodies[name] ? bodies[name](args, execution) : name.startsWith('ops_') ? { ...receipt } : name === 'edit' ? nativeEdit(args) : nativeWrite(args);
      },
    });
  }
  let id = 0;
  return { ctx, calls, run: (name, args, options = {}) => ctx.tools.execute({ name, arguments: args, callId: `payload-${++id}`, signal: new AbortController().signal, ...options }) };
}

test('disabled registers nothing; native success appends one static advisory', async t => {
  const h = await host(t), events = [], on = h.ctx.on.bind(h.ctx);
  h.ctx.on = (...args) => { events.push(args[0]); return on(...args); };
  const disabled = registerPayloadHooks(h.ctx);
  assert.equal(disabled.status, 'disabled');
  assert.deepEqual(disabled.disposers, []);
  assert.deepEqual(events, []);
  assert.equal(warnings(await h.run('write', write())).length, 0);
  const state = registerPayloadHooks(h.ctx, { enableHooks: true });
  assert.equal(state.status, 'partial');
  assert.equal(state.disposers.length, 1);
  assert.deepEqual(events, ['tools/post-execute']);
  assert.match(state.gaps.join(' '), /payload|Stop|AST/);
  for (const [name, args] of [['write', write()], ['edit', edit()]]) {
    const copy = structuredClone(args), result = await h.run(name, args);
    assert.equal(result.isError, false);
    assert.deepEqual(result.value, name === 'edit' ? nativeEdit(args) : nativeWrite(args));
    assert.deepEqual(args, copy);
    assert.equal(warnings(result).length, 1);
    assert.match(text(warnings(result)[0]), /console\.log/);
    assert.match(text(warnings(result)[0]), /payload.only/i);
    assert.doesNotMatch(text(warnings(result)[0]), /private-payload|private-path/);
  }
});

test('explicit reviewed OPS mappings inspect only exact known payload shapes', async t => {
  const h = await host(t);
  registerPayloadHooks(h.ctx, { enableHooks: true, toolMap: { Write: 'ops_write_file', Edit: 'ops_edit_file' } });
  for (const [name, args] of [['ops_write_file', opsWrite()], ['ops_edit_file', opsEdit()]]) {
    const result = await h.run(name, args);
    assert.equal(result.isError, false);
    assert.deepEqual(result.value, receipt);
    assert.equal(warnings(result).length, 1);
  }
  for (const [name, args] of [['write', write()], ['edit', edit()], ['ops_replace', { replacement: 'console.log(1)' }], ['ops_write_file', write()], ['ops_edit_file', edit()]]) assert.equal(warnings(await h.run(name, args)).length, 0, name);
});

test('unknown mappings stay unavailable with no fallback aliases', async t => {
  const h = await host(t);
  const state = registerPayloadHooks(h.ctx, { enableHooks: true, toolMap: { Write: 'unknown_write', Edit: 'ops_replace' } });
  assert.equal(state.status, 'unavailable');
  assert.deepEqual(state.disposers, []);
  assert.match(state.gaps.join(' '), /unsupported|unreviewed|mapping/i);
  assert.equal(warnings(await h.run('unknown_write', write())).length, 0);
  assert.equal(warnings(await h.run('write', write())).length, 0);
});

test('failed bodies and native monotonic denials never warn or bypass admission', async t => {
  const h = await host(t, { edit: () => { throw new Error('fixture edit failed'); } });
  registerPayloadHooks(h.ctx, { enableHooks: true });
  h.ctx.tools.guard(exec => exec.name === 'write' ? 'native denial' : undefined);
  const denied = await h.run('write', write());
  assert.equal(denied.isError, true);
  assert.equal(warnings(denied).length, 0);
  assert.deepEqual(h.calls, []);
  const failed = await h.run('edit', edit());
  assert.equal(failed.isError, true);
  assert.equal(warnings(failed).length, 0);
  assert.deepEqual(h.calls, ['edit']);
});

test('OPS requires positive completed complete changed non-preview receipt', async t => {
  let value;
  const h = await host(t, { ops_write_file: () => value });
  registerPayloadHooks(h.ctx, { enableHooks: true, toolMap: { Write: 'ops_write_file', Edit: 'ops_edit_file' } });
  for (value of [{ ...receipt, status: 'error' }, { ...receipt, status: 'rejected' }, { ...receipt, status: 'pending' }, { ...receipt, complete: false }, { ...receipt, changed: 0 }, { ...receipt, changed: '1' }, { ...receipt, dryRun: true }, { ...receipt, error: { code: 'failure' } }, { ...receipt, failed: 1 }, { status: 'completed' }, 'opaque']) {
    const result = await h.run('ops_write_file', opsWrite());
    assert.equal(result.isError, false);
    assert.equal(warnings(result).length, 0, JSON.stringify(value));
  }
  value = { ...receipt };
  assert.equal(warnings(await h.run('ops_write_file', { ...opsWrite(), dryRun: true })).length, 0);
});

test('JS/TS extensions and exclusions respect path segments and Windows separators', async t => {
  const h = await host(t);
  registerPayloadHooks(h.ctx, { enableHooks: true });
  for (const path of ['/workspace/src/a.js', '/workspace/src/a.jsx', '/workspace/src/a.ts', '/workspace/src/a.tsx', '/workspace/src/typescripts.js', 'C:\\workspace\\src\\component.tsx']) assert.equal(warnings(await h.run('write', write(path))).length, 1, path);
  for (const path of ['/workspace/src/a.json', '/workspace/src/a.py', '/workspace/src/a.mjs', '/workspace/src/a.ts.bak', '/workspace/src/a.test.ts', '/workspace/src/a.spec.jsx', '/workspace/vite.config.ts', '/workspace/src/x.config.tsx', '/workspace/scripts/x.js', '/workspace/nested/scripts/x.ts', '/workspace/__tests__/x.js', '/workspace/src/__mocks__/x.ts', 'C:\\workspace\\src\\__tests__\\x.ts', '', '/workspace/src/a.js\u0000']) assert.equal(warnings(await h.run('write', write(path))).length, 0, path);
});

test('literal console.log only in new text, without AST or old-text claims', async t => {
  const h = await host(t);
  registerPayloadHooks(h.ctx, { enableHooks: true });
  for (const content of ['export const a = 1;', 'console . log(1)', 'Console.log(1)', 'console.error(1)', '']) assert.equal(warnings(await h.run('write', write('src/a.ts', content))).length, 0);
  assert.equal(warnings(await h.run('edit', { ...edit('src/a.ts', 'removed'), old_string: 'console.log(1)' })).length, 0);
  assert.equal(warnings(await h.run('write', write('/workspace/src/a.ts', '// console.log is literal, not parsed'))).length, 1);
});

test('UTF-8 new-text and path bounds skip entire oversized payloads', async t => {
  const h = await host(t);
  registerPayloadHooks(h.ctx, { enableHooks: true });
  const exact = 'console.log' + 'x'.repeat(128 * 1024 - 'console.log'.length);
  assert.equal(warnings(await h.run('write', write('/workspace/src/a.ts', exact))).length, 1);
  for (const content of [exact + 'x', 'console.log' + 'é'.repeat(128 * 1024 / 2)]) assert.equal(warnings(await h.run('write', write('/workspace/src/a.ts', content))).length, 0);
  assert.equal(warnings(await h.run('write', write('/' + 'x'.repeat(4092) + '.ts'))).length, 1);
  assert.equal(warnings(await h.run('write', write('/' + 'x'.repeat(4093) + '.ts'))).length, 0);
  assert.equal(warnings(await h.run('write', write('/' + 'é'.repeat(2047) + '.ts'))).length, 0);
  assert.equal(warnings(await h.run('write', { file_path: 'src/a.ts', content: null })).length, 0);
});

test('OPS replacement bytes/count bounded together; separate fragments never joined', async t => {
  const h = await host(t);
  registerPayloadHooks(h.ctx, { enableHooks: true, toolMap: { Write: 'ops_write_file', Edit: 'ops_edit_file' } });
  assert.equal(warnings(await h.run('ops_edit_file', opsEdit(Array.from({ length: 100 }, () => ({ oldText: 'x', newText: 'console.log(1)' }))))).length, 1);
  for (const edits of [[], Array.from({ length: 101 }, () => ({ oldText: 'x', newText: 'console.log(1)' })), [{ newText: 'console.log' }, { newText: 'x'.repeat(128 * 1024) }], [{ newText: 'console.log' }, { newText: null }], [{ newText: 'console.' }, { newText: 'log(1)' }]]) assert.equal(warnings(await h.run('ops_edit_file', opsEdit(edits))).length, 0);
});

test('downstream projection and contexts survive; downstream block stays untouched', async t => {
  const h = await host(t);
  registerPayloadHooks(h.ctx, { enableHooks: true });
  const existing = createUserMessage({ content: [{ type: 'text', text: 'native context' }] });
  const off = h.ctx.on('tools/post-execute', async (_exec, result, next) => ({ ...await next(), value: { ...result.value }, additionalContexts: [existing] }));
  const accepted = await h.run('write', write());
  assert.equal(accepted.isError, false, JSON.stringify(accepted));
  assert.deepEqual(accepted.value, nativeWrite(write()));
  assert.equal(accepted.additionalContexts.length, 2);
  assert.equal(text(accepted.additionalContexts[0]), 'native context');
  assert.equal(warnings(accepted).length, 1);
  off();
  const offContent = h.ctx.on('tools/post-execute', async (_exec, _result, next) => ({ ...await next(), content: [{ type: 'text', text: 'native projection' }], additionalContexts: [existing] }));
  const contentOnly = await h.run('write', write());
  assert.equal(contentOnly.isError, false);
  assert.match(JSON.stringify(contentOnly.content), /native projection/);
  assert.equal(warnings(contentOnly).length, 1);
  assert.equal(text(contentOnly.additionalContexts[0]), 'native context');
  offContent();
  h.ctx.on('tools/post-execute', async () => ({ kind: 'block', feedback: [{ type: 'text', text: 'native block' }], additionalContexts: [existing] }));
  const blocked = await h.run('write', write());
  assert.equal(blocked.isError, true);
  assert.match(JSON.stringify(blocked.content), /native block/);
  assert.equal(warnings(blocked).length, 0);
  assert.equal(blocked.additionalContexts.length, 1);
});

test('cancellation before admission and during post-processing suppresses warnings', async t => {
  const h = await host(t);
  registerPayloadHooks(h.ctx, { enableHooks: true });
  const before = new AbortController(); before.abort();
  assert.equal(warnings(await h.run('write', write(), { signal: before.signal })).length, 0);
  assert.deepEqual(h.calls, []);
  const during = new AbortController();
  h.ctx.on('tools/post-execute', async (_exec, _result, next) => { const decision = await next(); during.abort(); return decision; });
  const result = await h.run('write', write(), { signal: during.signal });
  assert.equal(result.isError, true);
  assert.equal(warnings(result).length, 0);
});

test('idempotent disposal suppresses in-flight and future warnings with no Stop listener', async t => {
  const h = await host(t), events = [], on = h.ctx.on.bind(h.ctx);
  h.ctx.on = (...args) => { events.push(args[0]); return on(...args); };
  const state = registerPayloadHooks(h.ctx, { enableHooks: true });
  assert.deepEqual(events, ['tools/post-execute']);
  const entered = Promise.withResolvers(), release = Promise.withResolvers();
  const off = h.ctx.on('tools/post-execute', async (_exec, _result, next) => { const decision = await next(); entered.resolve(); await release.promise; return decision; });
  const pending = h.run('write', write());
  await entered.promise;
  for (const dispose of state.disposers) { dispose(); dispose(); }
  release.resolve();
  assert.equal(warnings(await pending).length, 0);
  off();
  assert.equal(warnings(await h.run('write', write())).length, 0);
});

test('native receipts prove changed write/create/update with normalized submitted content', async t => {
  let value;
  const h = await host(t, { write: () => value });
  const state = registerPayloadHooks(h.ctx, { enableHooks: true });
  assert.match(state.gaps.join(' '), /absolute|relative|symlink/i);
  const args = write('/workspace/src/a.ts', 'console.log(1);\r\n');
  for (value of [nativeWrite(args), { ...nativeWrite(args), operation: 'update', before: 'before\n' }]) {
    const result = await h.run('write', args);
    assert.equal(result.isError, false);
    assert.equal(warnings(result).length, 1);
    assert.doesNotMatch(text(warnings(result)[0]), /workspace|console\.log\(1\)/);
  }
});

test('native string/status/malformed/no-op and unknown-before updates never warn', async t => {
  let value;
  const h = await host(t, { write: () => value, edit: () => value });
  registerPayloadHooks(h.ctx, { enableHooks: true });
  const args = write(), base = nativeWrite(args);
  for (value of ['native completed', { status: 'completed' }, null, [], { ...base, extra: true }, { ...base, operation: 'delete' }, { path: base.path, operation: 'create', after: base.after }, { ...base, before: 'existing' }, { ...base, operation: 'update', before: null }, { ...base, operation: 'update', before: base.after }, { ...base, after: 'different' }, { ...base, after: 1 }]) {
    const result = await h.run('write', args);
    assert.equal(result.isError, false);
    assert.equal(warnings(result).length, 0, JSON.stringify(value));
  }
  const ea = edit(), eb = nativeEdit(ea);
  for (value of ['native completed', { ...eb, operation: 'update' }, { ...eb, before: null }, { ...eb, after: eb.before }, { ...eb, after: 'different' }, { path: eb.path, after: eb.after }]) assert.equal(warnings(await h.run('edit', ea)).length, 0, JSON.stringify(value));
});

test('native identity is absolute normalized request to canonical eligible receipt only', async t => {
  let value;
  const h = await host(t, { write: () => value });
  registerPayloadHooks(h.ctx, { enableHooks: true });
  const args = write('/workspace/src/../src/a.ts');
  value = { ...nativeWrite(args), path: '/workspace/src/a.ts' };
  assert.equal(warnings(await h.run('write', args)).length, 1);
  for (const path of ['src/a.ts', '/workspace/alias.ts', '/workspace/src/b.ts']) assert.equal(warnings(await h.run('write', { ...args, file_path: path })).length, 0, path);
  for (const path of ['src/a.ts', '/workspace/src/../src/a.ts', '/workspace/src/a.test.ts', '/workspace/scripts/a.ts', '/workspace/src/a.py', '/workspace/src/a.ts\u0000']) {
    value = { ...nativeWrite(args), path };
    assert.equal(warnings(await h.run('write', { ...args, file_path: path })).length, 0, path);
  }
});

test('native edit proves literal normalized replacement and replace_all multiplicity', async t => {
  let value;
  const h = await host(t, { edit: () => value });
  registerPayloadHooks(h.ctx, { enableHooks: true });
  const args = { ...edit('/workspace/src/a.ts', 'console.log(1);\r\n'), old_string: 'before\r\n' };
  value = { path: args.file_path, before: 'prefix\nbefore\nsuffix', after: 'prefix\nconsole.log(1);\nsuffix' };
  assert.equal(warnings(await h.run('edit', args)).length, 1);
  value = { ...value, before: 'before\nbefore\n', after: 'console.log(1);\nconsole.log(1);\n' };
  assert.equal(warnings(await h.run('edit', args)).length, 0);
  assert.equal(warnings(await h.run('edit', { ...args, replace_all: true })).length, 1);
  for (const replace_all of [false, 'true', 1, null]) assert.equal(warnings(await h.run('edit', { ...args, replace_all })).length, 0);
  for (const old_string of ['', 'missing', null]) assert.equal(warnings(await h.run('edit', { ...args, old_string, replace_all: true })).length, 0);
  value = { ...value, after: 'console.log(1);\nbefore\n' };
  assert.equal(warnings(await h.run('edit', { ...args, replace_all: true })).length, 0);
});

test('native before/after snapshots and edit input stay within 128KiB UTF-8 bounds', async t => {
  let value;
  const h = await host(t, { write: () => value, edit: () => value });
  registerPayloadHooks(h.ctx, { enableHooks: true });
  const args = write('/workspace/src/a.ts', 'console.log');
  value = { ...nativeWrite(args), operation: 'update', before: 'x'.repeat(128 * 1024) };
  assert.equal(warnings(await h.run('write', args)).length, 1);
  for (const before of ['x'.repeat(128 * 1024 + 1), 'é'.repeat(128 * 1024 / 2 + 1)]) {
    value = { ...value, before };
    assert.equal(warnings(await h.run('write', args)).length, 0);
  }
  const ea = edit();
  for (const oversized of ['x'.repeat(128 * 1024 + 1), 'é'.repeat(128 * 1024 / 2 + 1)]) {
    value = { path: ea.file_path, before: oversized, after: ea.new_string };
    assert.equal(warnings(await h.run('edit', { ...ea, old_string: oversized })).length, 0);
    value = { path: ea.file_path, before: ea.old_string, after: oversized };
    assert.equal(warnings(await h.run('edit', ea)).length, 0);
  }
});

test('retargeted or unbound downstream projection stays preserved without a warning', async t => {
  const h = await host(t, { write: nativeWrite });
  registerPayloadHooks(h.ctx, { enableHooks: true });
  const existing = createUserMessage({ content: [{ type: 'text', text: 'retained context' }] });
  let projected;
  h.ctx.on('tools/post-execute', async (_exec, _result, next) => ({ ...await next(), value: projected, additionalContexts: [existing] }));
  for (projected of ['native projection', { ...nativeWrite(write()), path: '/workspace/src/other.ts' }, { ...nativeWrite(write()), after: 'different' }]) {
    const result = await h.run('write', write());
    assert.equal(result.isError, false, JSON.stringify(result));
    assert.deepEqual(result.value, projected);
    assert.equal(warnings(result).length, 0);
    assert.equal(text(result.additionalContexts[0]), 'retained context');
  }
});

test('separate calls stay independent without file/content deduplication', async t => {
  const h = await host(t);
  registerPayloadHooks(h.ctx, { enableHooks: true });
  const results = await Promise.all([h.run('write', write()), h.run('edit', edit())]);
  assert.deepEqual(results.map(result => warnings(result).length), [1, 1]);
});
