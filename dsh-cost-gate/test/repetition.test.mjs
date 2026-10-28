import test from 'node:test';
import assert from 'node:assert/strict';
import { apply } from '../lib/index.js';

function harness() {
  const hooks = new Map();
  apply({ on: (name, fn) => hooks.set(name, fn), logger: { warn() {}, info() {} } });
  const step = (id, turn) => hooks.get('agent/pre-step')(
    { agent: { id }, turn }, async () => ({ kind: 'enter' }));
  const run = (id, name, args, next) => hooks.get('tools/execute')(
    { agent: { id }, name, arguments: args }, next);
  return { hooks, step, run };
}
const failure = () => ({ isError: true, content: [{ type: 'text', text: 'Invalid revision' }] });
const success = () => ({ isError: false, content: [{ type: 'text', text: 'OK' }] });

test('PTC wrapper does not hide repeated serial nested tool failures', async () => {
  const h = harness();
  let count = 0;
  const result = await h.run('ptc', 'run_code', { code: 'nested calls' }, async () => {
    for (let i = 0; i < 3; i++) await h.run('ptc', 'bad', {}, async () => { count++; return failure(); });
    return h.run('ptc', 'bad', {}, async () => { count++; return failure(); });
  });
  assert.equal(count, 3);
  assert.match(result.content[0].text, /ANTI_WASTE_REPEAT/);
});

test('parallel results do not establish a serial failure streak', async () => {
  const h = harness();
  let resolve;
  const pending = new Promise((r) => { resolve = r; });
  const first = h.run('parallel', 'bad', {}, async () => pending);
  await h.run('parallel', 'bad', {}, async () => failure());
  resolve(failure());
  await first;
  let count = 0;
  for (let i = 0; i < 3; i++) await h.run('parallel', 'bad', {}, async () => { count++; return failure(); });
  assert.equal(count, 3);
});

test('different error results do not form an identical failure streak', async () => {
  const h = harness();
  let count = 0;
  for (let i = 0; i < 6; i++) await h.run('different', 'bad', {}, async () => {
    count++;
    return { isError: true, error: { name: 'HarnessError', code: 'CODE_RUN_FAILED' }, content: [{ type: 'text', text: `error ${i}` }] };
  });
  assert.equal(count, 6);
});

test('three identical failures prevent only the next duplicate tool body, not the turn', async () => {
  const h = harness();
  await h.step('s1', 1);
  let dispatched = 0;
  const body = async () => { dispatched++; return failure(); };
  for (let i = 0; i < 3; i++) await h.run('s1', 'update_goal', { revision: 1 }, body);
  const denied = await h.run('s1', 'update_goal', { revision: 1 }, body);
  assert.equal(dispatched, 3);
  assert.equal(denied.isError, true);
  assert.match(denied.content[0].text, /ANTI_WASTE_REPEAT/);
  assert.equal((await h.step('s1', 1)).kind, 'enter');
  await h.run('s1', 'update_goal', { revision: 2 }, body);
  assert.equal(dispatched, 4);
});

test('successful reads and retests are never blocked', async () => {
  const h = harness();
  let count = 0;
  for (let i = 0; i < 8; i++) await h.run('s1', 'read', { path: 'a' }, async () => { count++; return success(); });
  assert.equal(count, 8);
});

test('intervening successful tool, new turn and other sessions reset or isolate streak', async () => {
  const h = harness();
  await h.step('s1', 1);
  for (let i = 0; i < 3; i++) await h.run('s1', 'bad', {}, async () => failure());
  let count = 0;
  const body = async () => { count++; return failure(); };
  await h.run('s2', 'bad', {}, body);
  await h.run('s1', 'edit', {}, async () => success());
  await h.run('s1', 'bad', {}, body);
  await h.run('s1', 'bad', {}, body);
  await h.run('s1', 'bad', {}, body);
  await h.step('s1', 2);
  await h.run('s1', 'bad', {}, body);
  assert.equal(count, 5);
});

test('changed error is new evidence and argument key order is immaterial', async () => {
  const h = harness();
  for (let i = 0; i < 3; i++) await h.run('s1', 'bad', { a: 1, b: 2 }, async () => failure());
  let count = 0;
  await h.run('s1', 'bad', { b: 2, a: 1 }, async () => { count++; return failure(); });
  assert.equal(count, 0);
  await h.run('s1', 'other', {}, async () => failure());
  await h.run('s1', 'bad', { a: 1, b: 2 }, async () => { count++; return { isError: true, content: [{ type: 'text', text: 'New error' }] }; });
  assert.equal(count, 1);
});
