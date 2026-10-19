import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attachIntake } from '../lib/adapter.js';
const human = (text, extra = {}) => ({ id: text, role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text }], ...extra });
function harness(options = {}) {
  let hook;
  const ctx = { on(event, fn) { assert.equal(event, 'agent/pre-step'); hook = fn; } };
  attachIntake(ctx, { createMessage: text => ({ role: 'user', source: { kind: 'prompt-intake', form: 'notice', summary: 'Prompt intake' }, content: [{ type: 'text', text }] }), readPolicy: async () => 'TEST POLICY', ...options });
  const agent = {};
  return (messages, decision = { kind: 'enter', messages }, owner = agent) => hook({ agent: owner, messages, signal: new AbortController().signal }, async () => decision);
}
test('red: preserve original text, images, ids and downstream metadata', async () => {
  const run = harness();
  const msg = human('them dang nhap, ko dung dich vu tra phi', { content: [{ type: 'text', text: 'them dang nhap, ko dung dich vu tra phi' }, { type: 'image', data: 'bytes' }] });
  Object.freeze(msg.content); Object.freeze(msg);
  const decision = await run([msg], { kind: 'enter', messages: [msg], extra: 42 });
  assert.equal(decision.messages[0], msg); assert.equal(decision.extra, 42);
  assert.equal(decision.messages.length, 2);
  assert.match(decision.messages[1].content[0].text, /TEST POLICY/);
});
test('control: off, on, skip and status; per-agent isolation', async () => {
  const run = harness();
  await run([human('/intake off')]);
  assert.equal((await run([human('sua giup')])).messages.length, 1);
  assert.equal((await run([human('sua giup')], undefined, {})).messages.length, 2);
  assert.match((await run([human('/intake status')])).messages[1].content[0].text, /off/);
  await run([human('/intake on')]);
  const skipped = await run([human('/intake skip sua giup')]);
  assert.match(skipped.messages[1].content[0].text, /Bỏ qua/);
  assert.equal((await run([human('sua giup')])).messages.length, 2);
});
test('exclude tool, memory, subagent and our own notices', async () => {
  const run = harness();
  for (const kind of ['tool', 'memory', 'prompt-intake', 'team', 'unknown']) {
    const msg = human('sua giup', { source: { kind } });
    assert.deepEqual(await run([msg]), { kind: 'enter', messages: [msg] });
  }
  assert.deepEqual(await run([]), { kind: 'enter', messages: [] });
});
test('downstream rejection/abort does not change mode or inject', async () => {
  const run = harness();
  assert.deepEqual(await run([human('/intake off')], { kind: 'reject' }), { kind: 'reject' });
  assert.equal((await run([human('sua giup')])).messages.length, 2);
  let hook;
  const controller = new AbortController();
  attachIntake({ on(event, fn) { hook = fn; } }, {
    createMessage: () => { throw Error('must not inject after abort'); },
    readPolicy: async () => { controller.abort(); return 'POLICY'; },
  });
  const msg = human('sua giup');
  const decision = { kind: 'enter', messages: [msg] };
  assert.equal(await hook({ agent: {}, messages: [msg], signal: controller.signal }, async () => decision), decision);
});
test('policy read failure preserves user request with explicit notice', async () => {
  const run = harness({ readPolicy: async () => { throw Error('ENOENT'); } });
  const msg = human('sua giup');
  const result = await run([msg]);
  assert.equal(result.messages[0], msg);
  assert.match(result.messages[1].content[0].text, /không tải được/);
});
test('unknown or quoted control text does not disable intake', async () => {
  const run = harness();
  await run([human('Giải thích lệnh /intake off')]);
  await run([human('/intake office')]);
  assert.equal((await run([human('sua giup')])).messages.length, 2);
});
test('downstream appended messages and original batches preserved', async () => {
  const run = harness(); const a = human('fix'); const b = human('khong doi API');
  const other = human('notice', { source: { kind: 'other' } });
  const result = await run([a, b], { kind: 'enter', messages: [a, b, other] });
  assert.deepEqual(result.messages.slice(0, 3), [a, b, other]);
});
