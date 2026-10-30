import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { createHindsightMemory } from '../lib/memory.js';
import { Context } from '@deepseek-ai/cordis';
import Tools from '@deepseek-ai/dsh-tools';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import { registerMemoryTools } from '../lib/memory-tools.js';

const eccRoot = process.env.ECC_ROOT || '/home/dzerok/.dsh/ecc/source';
async function fixture(t, options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'ecc-memory-test-'));
  const project = join(root, 'project');
  await mkdir(project);
  execFileSync('git', ['init', '-q', project]);
  t.after(async () => { assert.ok(resolve(root).startsWith(join(tmpdir(), 'ecc-memory-test-'))); await rm(root, { recursive: true, force: true }); });
  const configPath = join(root, 'coding-agent.json');
  const base = { harnesses: { dsh: { serverMode: 'self-hosted', apiUrl: 'http://127.0.0.1:9077', bankIdTemplate: 'coding-agent::{gitProject}', dynamicBankId: true, resolveWorktrees: false, optInOnly: true, optInPaths: [project], apiToken: 'test-token-one' } } };
  const update = async (patch) => { Object.assign(base.harnesses.dsh, patch); await writeFile(configPath, JSON.stringify(base)); };
  await update({});
  const docs = new Map(); const calls = []; let fail = false; let status = 'completed';
  const fetchImpl = async (input, init = {}) => {
    const url = new URL(input); const method = init.method || 'GET'; const body = init.body && JSON.parse(init.body);
    calls.push({ url, method, body, token: init.headers?.Authorization });
    if (fail) return Response.json({ detail: 'private-token-do-not-echo' }, { status: 503 });
    const path = decodeURIComponent(url.pathname);
    if (method === 'GET' && path.endsWith('/documents')) return Response.json({ items: [...docs.keys()].map(id => ({ id })), total: docs.size, offset: 0, limit: 100 });
    if (method === 'GET' && path.includes('/documents/')) { const doc = docs.get(path.split('/documents/')[1]); return doc ? Response.json(doc) : Response.json({}, { status: 404 }); }
    if (method === 'POST' && path.endsWith('/memories')) {
      const item = body.items[0]; docs.set(item.document_id, { id: item.document_id, original_text: item.content, document_metadata: item.metadata, tags: item.tags });
      return Response.json({ success: true, bank_id: 'coding-agent::project', items_count: 1, async: true, operation_id: body.operation_id });
    }
    if (method === 'GET' && path.includes('/operations/')) return Response.json({ operation_id: path.split('/').at(-1), status });
    if (method === 'POST' && path.endsWith('/memories/recall')) return Response.json({ results: [{ id: '12345678-1234-4234-8234-123456789abc', text: 'Existing Hindsight fact', document_id: 'session-old' }] });
    if (method === 'GET' && path.includes('/memories/')) return Response.json({ id: '12345678-1234-4234-8234-123456789abc', text: 'Existing Hindsight fact', document_id: 'session-old', fact_type: 'world' });
    throw new Error(`Unexpected fixture request: ${method} ${path}`);
  };
  const settings = { eccRoot, configPath, workspaceRoot: project, env: {}, fetchImpl, ...options };
  return { root, project, settings, calls, docs, update, fetch: fetchImpl, create: () => createHindsightMemory(settings), setFail: v => { fail = v; }, setStatus: v => { status = v; } };
}

async function publicTools(t, f) {
  const ctx = new Context();
  t.after(() => ctx.fiber.dispose());
  await ctx.plugin(SystemPrompt).await();
  await ctx.plugin(Tools, {}).await();
  registerMemoryTools(ctx, f.settings);
  return (name, args = {}, { workspace = f.project, signal = new AbortController().signal } = {}) => ctx.tools.execute({
    name, arguments: args, callId: name, agent: { session: { header: { cwd: workspace, origin: 'user' } } }, signal,
  });
}

function value(result) { assert.equal(result.isError, false, JSON.stringify(result)); return JSON.parse(result.value); }

function assertReceipt(result, post) {
  const receipt = value(result);
  assert.equal(receipt.status, 'unknown');
  assert.equal(receipt.documentId, post.items[0].document_id);
  assert.equal(receipt.operationId, post.operation_id);
  assert.match(receipt.retry, /do not|never/i);
  assert.ok(JSON.stringify(receipt.inspect).includes(receipt.operationId));
  assert.ok(JSON.stringify(receipt.inspect).includes(receipt.documentId));
  assert.ok(!JSON.stringify(result).includes('fixture-private-response'));
}

test('ECC save/search/read uses one native bank, stable metadata, receipts and a fresh bridge instance', async t => {
  const f = await fixture(t);
  const first = await f.create();
  const saved = await first.save({ title: 'Deployment approval', body: 'Release requires a green integration suite.', kind: 'decision', tags: ['release'], targetHarnesses: ['dsh'] });
  assert.equal(saved.status, 'completed'); assert.match(saved.memory.id, /^mem_[a-z0-9_-]+$/);
  const second = await f.create();
  const found = await second.search({ query: 'Deployment', includeNative: false });
  assert.equal(found.results[0].id, saved.memory.id); assert.equal(found.ranking, 'ecc-lexical');
  const result = await second.read({ id: saved.memory.id });
  assert.equal(result.memory.body, 'Release requires a green integration suite.'); assert.equal(result.memory.kind, 'decision');
  assert.deepEqual(result.memory.tags, ['release']); assert.deepEqual(result.memory.targetHarnesses, ['dsh']); assert.equal(result.memory.trust, 'unreviewed');
  assert.equal(result.memory.scope, 'project'); assert.equal(result.owner, 'Hindsight');
  assert.ok(f.calls.every(x => x.url.pathname.includes('/banks/coding-agent%3A%3Aproject/')));
  assert.deepEqual(await readdir(f.project), ['.git']);
});

test('pending retain and failed operation are not reported as saved', async t => {
  const f = await fixture(t); const bridge = await f.create(); f.setStatus('pending');
  const receipt = await bridge.save({ title: 'Pending', body: 'Still processing.' });
  assert.equal(receipt.status, 'pending'); assert.ok(receipt.operationId);
  f.setStatus('failed');
  await assert.rejects(bridge.save({ title: 'Failed', body: 'Not retained.' }), /operation.*failed/i);
});

test('native opt-out and unsupported scope fail before any request; credentials are reloaded without leaking errors', async t => {
  const f = await fixture(t); const bridge = await f.create();
  await assert.rejects(bridge.save({ title: 'No', body: 'No.', scope: 'user' }), /project.*scope|scope.*project/i);
  assert.equal(f.calls.length, 0);
  await f.update({ disabled: true });
  await assert.rejects(bridge.search({ query: 'anything' }), /disabled|opt.in/i); assert.equal(f.calls.length, 0);
  await f.update({ disabled: false, apiToken: 'test-token-two' });
  await bridge.search({ query: '', includeNative: false }); assert.equal(f.calls.at(-1).token, 'Bearer test-token-two');
  f.setFail(true);
  await assert.rejects(bridge.search({ query: '', includeNative: false }), e => !e.message.includes('private-token') && /503/.test(e.message));
});

test('routing refuses unknown overrides, opt-in path escapes, remote endpoints and environment divergence', async t => {
  const f = await fixture(t); const b = await f.create();
  for (const patch of [{ paths: { '/': { bankId: 'other' } } }, { apiUrl: 'https://unreviewed.example' }, { optInPaths: [f.project + '-other'] }]) {
    if (patch.paths) { await f.update({ paths: patch.paths }); } else { await f.update({ paths: undefined, apiUrl: 'http://127.0.0.1:9077', optInPaths: [f.project], ...patch }); }
    await assert.rejects(b.doctor(), /unsupported|opt.in|loopback|routing/i);
  }
  assert.equal(f.calls.length, 0);
  await f.update({ optInPaths: [f.project] });
  const divergent = await createHindsightMemory({ ...f.settings, env: { HINDSIGHT_BANK_ID: 'other' } });
  await assert.rejects(divergent.doctor(), /environment|routing/i);
});

test('search can read existing Hindsight facts without making them executable ECC policy', async t => {
  const f = await fixture(t); const bridge = await f.create();
  const result = await bridge.search({ query: 'Existing' });
  const native = result.nativeResults[0]; assert.equal(native.owner, 'Hindsight'); assert.equal(native.trust, 'unreviewed');
  const read = await bridge.read({ id: native.id });
  assert.equal(read.memory.body, 'Existing Hindsight fact'); assert.equal(read.backlinksComplete, false);
  const doctor = await bridge.doctor(); assert.equal(doctor.owner, 'Hindsight'); assert.ok(doctor.unsupported.includes('filesystem-vault-audit'));
});

test('native session cwd routes root and nested workspaces to their respective banks', async t => {
  const f = await fixture(t); const run = await publicTools(t, f);
  const nested = join(f.project, 'nested'); await mkdir(nested);
  assert.equal(value(await run('memory_doctor')).bank, 'coding-agent::project');
  assert.equal(value(await run('memory_doctor', {}, { workspace: nested })).bank, 'coding-agent::nested');
  assert.ok(f.calls.at(-1).url.pathname.includes('coding-agent%3A%3Anested'));
});

for (const failure of ['submission response lost', 'operation response lost']) test(`public save preserves uncertain IDs when ${failure}`, async t => {
  const f = await fixture(t); let post;
  f.settings.fetchImpl = async (url, init) => {
    const response = await f.fetch(url, init);
    if (init.method === 'POST' && new URL(url).pathname.endsWith('/memories')) {
      post = JSON.parse(init.body);
      if (failure.startsWith('submission')) throw new Error('fixture-private-response');
    }
    if (failure.startsWith('operation') && new URL(url).pathname.includes('/operations/')) throw new Error('fixture-private-response');
    return response;
  };
  const run = await publicTools(t, f);
  assertReceipt(await run('memory_save', { title: 'Uncertain fixture', body: 'Not a real retain.' }), post);
  assert.equal(f.calls.filter(call => call.method === 'POST').length, 1);
  assert.equal(f.docs.size, 1);
});

for (const [label, pollId] of [['mismatched', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'], ['missing', undefined], ['malformed', 7]]) test(`public save preserves original IDs for ${label} poll identity`, async t => {
  const f = await fixture(t); let post;
  f.settings.fetchImpl = async (url, init) => {
    const response = await f.fetch(url, init);
    const path = new URL(url).pathname;
    if (init.method === 'POST' && path.endsWith('/memories')) post = JSON.parse(init.body);
    if (path.includes('/operations/')) return Response.json({ status: 'completed', ...(pollId === undefined ? {} : { operation_id: pollId }) });
    return response;
  };
  const run = await publicTools(t, f);
  assertReceipt(await run('memory_save', { title: 'Poll identity fixture', body: 'Not a real retain.' }), post);
  assert.ok(f.calls.find(call => call.url.pathname.includes('/operations/')).url.pathname.endsWith(post.operation_id));
  assert.equal(f.calls.filter(call => call.method === 'POST').length, 1);
});

test('public ECC read rejects another document even when its envelope is internally consistent', async t => {
  const f = await fixture(t); const run = await publicTools(t, f);
  const saved = value(await run('memory_save', { title: 'Identity fixture', body: 'Not policy.' }));
  const wrong = 'mem_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const doc = f.docs.get(saved.memory.id); const envelope = JSON.parse(doc.document_metadata.ecc_memory_v1);
  f.docs.set(saved.memory.id, { ...doc, id: wrong, document_metadata: { ecc_memory_v1: JSON.stringify({ ...envelope, id: wrong }) } });
  const result = await run('memory_read', { id: saved.memory.id });
  assert.equal(result.isError, true); assert.match(JSON.stringify(result), /identity|mismatch/i);
});

test('public native fact read binds response UUID to requested stable ID', async t => {
  const f = await fixture(t); const run = await publicTools(t, f);
  const result = await run('memory_read', { id: 'mem_hs_22222222222242228222222222222222' });
  assert.equal(result.isError, true); assert.match(JSON.stringify(result), /identity|mismatch/i);
});

test('native explicit-null token overrides the environment and removal restores fallback', async t => {
  const f = await fixture(t, { env: { HINDSIGHT_API_TOKEN: 'fixture-env-token' } }); const run = await publicTools(t, f);
  await f.update({ apiToken: null }); value(await run('memory_doctor'));
  assert.equal(f.calls.at(-1).token, undefined);
  await f.update({ apiToken: undefined }); value(await run('memory_doctor'));
  assert.equal(f.calls.at(-1).token, 'Bearer fixture-env-token');
});

test('cancelled preflight never submits and fetch receives the combined execution signal', async t => {
  const f = await fixture(t); const controller = new AbortController(); let observed;
  f.settings.fetchImpl = async (url, init) => {
    observed = init.signal;
    const response = await f.fetch(url, init);
    controller.abort();
    return response;
  };
  const run = await publicTools(t, f);
  const result = await run('memory_save', { title: 'Cancelled fixture', body: 'No submission.' }, { signal: controller.signal });
  assert.equal(result.isError, true);
  assert.equal(observed.aborted, true);
  assert.equal(f.calls.filter(call => call.method === 'POST').length, 0);
  assert.ok(!JSON.stringify(result).includes('documentId'));
});

test('cancellation after submission keeps IDs in the native final result without a second POST', async t => {
  const f = await fixture(t); const controller = new AbortController(); let post;
  f.settings.fetchImpl = async (url, init) => {
    const response = await f.fetch(url, init);
    if (init.method === 'POST' && new URL(url).pathname.endsWith('/memories')) {
      post = JSON.parse(init.body); controller.abort(); throw new Error('fixture-private-response');
    }
    return response;
  };
  const run = await publicTools(t, f);
  const result = await run('memory_save', { title: 'Uncertain cancellation fixture', body: 'Inspect the same IDs.' }, { signal: controller.signal });
  const output = JSON.stringify(result);
  assert.equal(result.isError, true);
  assert.ok(output.includes(post.operation_id));
  assert.ok(output.includes(post.items[0].document_id));
  assert.match(output, /unknown|uncertain/); assert.match(output, /inspect/i);
  assert.ok(!output.includes('fixture-private-response'));
  assert.equal(f.calls.filter(call => call.method === 'POST').length, 1);
});

test('bounded corpus rejects excessive or incomplete listings before fetching documents', async t => {
  const f = await fixture(t); const run = await publicTools(t, f);
  for (const total of [501, 1]) {
    let requests = 0;
    f.settings.fetchImpl = async () => { requests++; return Response.json({ items: [], total }); };
    const result = await run('memory_doctor');
    assert.equal(result.isError, true); assert.match(JSON.stringify(result), /bounded complete scan/i);
    assert.equal(requests, 1);
  }
});

test('save rejects secrets, invalid fields and changed route rather than overwriting', async t => {
  const f = await fixture(t); const bridge = await f.create();
  await assert.rejects(bridge.save({ title: 'x', body: 'x', unexpected: true }), /unsupported|unknown/i);
  await assert.rejects(bridge.save({ title: 'Secret', body: 'api_key=sk-abcdefghijklmnopqrstuv1234567890' }), /secret/i);
  assert.equal(f.calls.length, 0);
  await f.update({ bankIdTemplate: 'other::{gitProject}' });
  await assert.rejects(bridge.save({ title: 'x', body: 'x' }), /routing|bank/i);
});
