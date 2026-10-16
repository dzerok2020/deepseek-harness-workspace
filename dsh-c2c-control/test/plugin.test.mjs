import test from 'node:test';
import assert from 'node:assert/strict';
import { apply } from '../index.mjs';
import { Controller } from '../src/controller.mjs';

test('dispose aborts and drains active operation before closing controller', async t => {
 let tool, dispose, finish;
 let closed = false, observedSignal;
 const pending = new Promise(resolve => { finish = resolve; });
 t.mock.method(Controller.prototype, 'begin', async (_args, signal) => {
  observedSignal = signal;
  await pending;
  signal.throwIfAborted();
 });
 t.mock.method(Controller.prototype, 'close', async () => { closed = true; });
 apply({ tools:{register(def){tool=def;}}, on(_event, fn){dispose=fn;} });
 const execution = tool.execute({action:'begin'}, {agent:{session:'lifecycle-test'},signal:new AbortController().signal});
 const rejected = assert.rejects(execution, /disposed/);
 const disposal = dispose();
 assert.equal(observedSignal.aborted, true);
 assert.equal(closed, false);
 finish();
 await rejected;
 await disposal;
 assert.equal(closed, true);
});
test('native tool registers canonical output and requires owning session', async () => {
 let tool; let dispose;
 const ctx = { tools:{register(def){tool=def;}}, on(event, fn){assert.equal(event,'dispose');dispose=fn;} };
 apply(ctx);
 assert.equal(tool.name,'c2c_control');
 assert.equal(tool.output.schema.type,'object');
 assert.deepEqual(tool.output.schema.required,['result']);
 assert.deepEqual(tool.output.schema.properties.result,{type:'string'});
 await assert.rejects(tool.execute({action:'status'}, {signal:new AbortController().signal}), /owning agent/);
 await dispose();
 await assert.rejects(tool.execute({action:'status'}, {agent:{session:'test'},signal:new AbortController().signal}), /disposed/);
});
