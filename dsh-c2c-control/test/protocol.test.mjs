import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMessage, makeMessage, matchReply } from '../src/protocol.mjs';

test('upstream PLAN fixture matches INIT task and next iteration', () => {
  const reply = '[C2C]\nSTATE: PLAN\nTASK_ID: c2c_demo\nITERATION: 1\n\nACTIONS:\n1. Inspect via MCP.\nTESTS:\nnode --test';
  assert.equal(parseMessage(reply).state, 'PLAN');
  assert.equal(matchReply(reply, { taskId: 'c2c_demo', state: 'INIT', iteration: 0 }).iteration, 1);
  assert.equal(matchReply(reply, { taskId: 'other', state: 'INIT', iteration: 0 }), null);
  assert.equal(matchReply(reply, { taskId: 'c2c_demo', state: 'EXECUTED', iteration: 2 }), null);
});

test('control messages reject duplicate headers, trailing junk, invalid states and oversize UTF-8', () => {
  for (const raw of [
    '[C2C]\nSTATE: PLAN\nSTATE: DONE\nTASK_ID: a\nITERATION: 1',
    'preface\n[C2C]\nSTATE: PLAN\nTASK_ID: a\nITERATION: 1',
    '[C2C]\nSTATE: RESUME\nTASK_ID: a\nITERATION: 1',
    '[C2C]\nSTATE: PLAN\nTASK_ID: a\nITERATION: -1',
  ]) assert.throws(() => parseMessage(raw));
  assert.throws(() => makeMessage({ state: 'INIT', taskId: 'a', iteration: 0, body: '界'.repeat(400) }), /1024/);
});

test('EXECUTED accepts DONE same iteration or PLAN next iteration only', () => {
  const pending = { taskId: 't', state: 'EXECUTED', iteration: 2 };
  const wire = (state, iteration) => makeMessage({ state, taskId: 't', iteration, body: 'SUMMARY:\nCheck MCP.' });
  assert.equal(matchReply(wire('DONE', 2), pending).state, 'DONE');
  assert.equal(matchReply(wire('PLAN', 3), pending).state, 'PLAN');
  assert.equal(matchReply(wire('PLAN', 2), pending), null);
  assert.equal(matchReply(wire('DONE', 3), pending), null);
});
