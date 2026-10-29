import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Execute the actual analyzer against synthetic JSONL, without reading private sessions.
const source = readFileSync(new URL('../tools/measure-session-tokens.mjs', import.meta.url), 'utf8');
async function analyze(messages) {
  const estimator = source.slice(source.indexOf('function estTokens('), source.indexOf('/** Mở stream'));
  const analyzer = source.slice(source.indexOf('async function analyzeSession('), source.indexOf('function printReport('));
  const context = vm.createContext({
    openJsonl: async () => messages.map(message => JSON.stringify({ data: { message } })),
  });
  vm.runInContext(estimator + '\n' + analyzer, context);
  return JSON.parse(JSON.stringify(await context.analyzeSession('synthetic-memory-only')));
}
const call = (id, name) => ({ role: 'assistant', content: '', tool_calls: [{ id, function: { name } }] });
const result = (id, content) => ({ role: 'tool', tool_call_id: id, content });

test('4000 output characters count as about 1000 tokens for the matching tool', async () => {
  const r = await analyze([call('c1', 'read'), result('c1', 'x'.repeat(4000))]);
  assert.equal(r.toolChars, 4000);
  assert.equal(r.toolTokens, 1000);
  assert.deepEqual(r.byTool, [{ name: 'read', calls: 1, outTokens: 1000 }]);
});

test('multiple tools, unknown results and structured content preserve accounting totals', async () => {
  const r = await analyze([
    { role: 'user', content: 'question' },
    call('a', 'read'), result('a', 'x'),
    call('b', 'search'), result('b', { text: 'abc' }),
    result('unmapped', 'xyz'), result('a', ''),
  ]);
  const expected = Math.ceil(1 / 4) + Math.ceil(JSON.stringify({ text: 'abc' }).length / 4) + Math.ceil(3 / 4);
  assert.equal(r.toolTokens, expected);
  assert.equal(r.byTool.reduce((sum, row) => sum + row.outTokens, 0), r.toolTokens);
  assert.equal(r.byTool.find(row => row.name === 'unknown').outTokens, 1);
  assert.equal(r.byTool.find(row => row.name === 'read').calls, 1);
  assert.deepEqual(r.turnToolCalls, [[1, 2]]);
});

test('empty input and empty tool text do not invent tokens', async () => {
  const empty = await analyze([]);
  assert.equal(empty.toolTokens, 0);
  assert.deepEqual(empty.byTool, []);
  const r = await analyze([call('empty', 'read'), result('empty', '')]);
  assert.equal(r.toolTokens, 0);
  assert.equal(r.byTool[0].outTokens, 0);
});

test('per-turn assistant totals render as numbers, not accumulator objects', async () => {
  const r = await analyze([{ role: 'user', content: 'hello' },
    { ...call('r', 'read'), content: 'abcdefgh' }, result('r', 'result')]);
  const lines = [];
  const context = vm.createContext({ console: { log: line => lines.push(line) } });
  vm.runInContext(source.slice(source.indexOf('function printReport('), source.indexOf('async function main(')), context);
  context.printReport({ sessionId: 'fake', workspace: 'fake', size: 0 }, r);
  assert.match(lines.join('\n'), /assistant ~2 tok/);
  assert.doesNotMatch(lines.join('\n'), /\[object Object\]/);
});

test('report describes character estimates, not actual usage or billing tokens', () => {
  assert.doesNotMatch(source, /đo token thật/);
  assert.match(source, /ước lượng/);
});
