import test from 'node:test';
import assert from 'node:assert/strict';
import { apply } from '../index.mjs';
test('native tool registers canonical output and requires owning session', async () => {
 let tool; let dispose;
 const ctx = { tools:{register(def){tool=def;}}, on(event, fn){assert.equal(event,'dispose');dispose=fn;} };
 apply(ctx);
 assert.equal(tool.name,'c2c_control');
 assert.equal(tool.output.schema.type,'object');
 await assert.rejects(tool.execute({action:'status'}, {signal:new AbortController().signal}), /owning agent/);
 await dispose();
 await assert.rejects(tool.execute({action:'status'}, {agent:{session:'test'},signal:new AbortController().signal}), /disposed/);
});
