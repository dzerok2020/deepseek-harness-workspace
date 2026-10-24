import test from 'node:test';
import assert from 'node:assert/strict';
import { apply } from '../lib/index.js';

function harness() {
  const handlers = new Map(), guards = [], steers = [];
  const agent = { sessionId: 'parent', steer: m => steers.push(m) };
  apply({ tools: { guard: fn => guards.push(fn) }, on: (n, fn) => handlers.set(n, fn) }, {});
  const feed = (name, args, value, outer = {}) => handlers.get('tools/post-execute')(
    { name, arguments: args, agent }, { isError: false, value, content: [], ...outer }, async () => ({ kind: 'accept' }));
  const stop = () => handlers.get('agent/turn-stopping')({ agent });
  return { guards, feed, stop, steers, handlers, agent };
}
const success = { kind: 'foreground', status: 'completed', exitCode: 0, signal: null, aborted: false };

test('OPS irreversible inline command is denied by guard without executing', async () => {
  const h = harness();
  assert.equal(typeof await h.guards[0]({ name: 'ops_bash', arguments: { command: 'git reset --hard' }, agent: h.agent }), 'string');
});

test('OPS script_path is safely inspected and unreadable scripts fail closed', async () => {
  const h = harness();
  assert.equal(typeof await h.guards[0]({ name: 'ops_bash', arguments: { script_path: new URL('./fixtures/unsafe.sh', import.meta.url).pathname }, agent: h.agent }), 'string');
  assert.equal(typeof await h.guards[0]({ name: 'ops_bash', arguments: { script_path: '/does-not-exist.sh' }, agent: h.agent }), 'string');
});

test('OPS successful script verification clears an earlier edit', async () => {
  const h = harness();
  await h.feed('write', { file_path: 'a.js' }, {});
  await h.feed('ops_bash', { script_path: new URL('./fixtures/check.sh', import.meta.url).pathname }, success);
  await h.stop();
  assert.equal(h.steers.length, 0);
});

for (const [label, value] of [
  ['nonzero', { ...success, exitCode: 1 }],
  ['structured failure', { ...success, status: 'failed', failure: { code: 'execution_failed' } }],
  ['background', { kind: 'background', jobId: 'j1' }],
  ['promoted', { kind: 'promoted', jobId: 'j1', timeoutMs: 1000, output: '' }],
  ['unknown', {}],
]) test(`OPS ${label} is not passing verification`, async () => {
  const h = harness();
  await h.feed('write', { file_path: 'a.js' }, {});
  await h.feed('ops_bash', { command: 'node --test test/' }, success);
  await h.feed('ops_bash', { command: 'node --test test/' }, value);
  await h.stop();
  assert.equal(h.steers.length, 1);
});

test('OPS failure after possible shell write leaves debt', async () => {
  const h = harness();
  await h.feed('ops_bash', { command: 'echo changed > a.js; false' }, { ...success, exitCode: 1 });
  await h.stop();
  assert.equal(h.steers.length, 1);
});

test('background job output alone never becomes passing verification', async () => {
  const h = harness();
  await h.feed('write', { file_path: 'a.js' }, {});
  await h.feed('ops_bash', { command: 'node --test test/', run_in_background: true }, { kind: 'background', jobId: 'j1' });
  await h.feed('job_output', { job_id: 'j1' }, { status: 'completed', output: 'tests pass' });
  await h.stop();
  assert.equal(h.steers.length, 1);
});
