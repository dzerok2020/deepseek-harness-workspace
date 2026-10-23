import test from 'node:test';
import assert from 'node:assert/strict';
import { apply } from '../lib/index.js';

function setup(todos) {
  const handlers = new Map();
  const messages = [];
  const session = {};
  const agent = { session, steer: message => messages.push(message) };
  const ctx = {
    tools: { guard() {} },
    on: (name, handler) => {
      const listeners = handlers.get(name) ?? [];
      listeners.push(handler);
      handlers.set(name, listeners);
    },
    sessionProjections: { stateOf: (owner, key) => {
      assert.equal(owner, session);
      assert.equal(key, 'todos');
      return todos;
    } },
  };
  apply(ctx, {});
  return { messages, stop: async turn => {
    for (const handler of handlers.get('agent/turn-stopping')) await handler({ agent, turn });
  } };
}

test('unfinished To-dos prompt reconciliation without changing task status', async () => {
  const todos = [{ content: 'Verify', status: 'in_progress' }];
  const { messages, stop } = setup(todos);
  await stop(1);
  assert.equal(messages.length, 1);
  assert.match(messages[0].content[0].text, /todo_write/);
  assert.match(messages[0].content[0].text, /chưa hoàn thành/);
  assert.equal(todos[0].status, 'in_progress');
});

test('completed, empty and absent To-dos do not trigger reminders', async () => {
  for (const todos of [null, undefined, [], [{ content: 'Done', status: 'completed' }]]) {
    const { messages, stop } = setup(todos);
    await stop(1);
    assert.equal(messages.length, 0);
  }
});

test('reminder is bounded to once per turn and resets for the next turn', async () => {
  const { messages, stop } = setup([{ content: 'Wait', status: 'pending' }]);
  await stop(1);
  await stop(1);
  assert.equal(messages.length, 1);
  await stop(2);
  assert.equal(messages.length, 2);
});
