import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {patch} from './generate.mjs';
const {fixture,original} = await import('./harness.mjs');
const source = patch(original);
test('review: abort during final summary never applies a fold', async () => {
  let f;
  f = fixture(source, {reply: n => {
    if (n === 2) f.signal.aborted = true;
    return {summary:'valid summary '.repeat(20)};
  }});
  await f.run();
  assert.equal(f.calls.length, 2);
  assert.equal(f.applies.length, 0);
});
