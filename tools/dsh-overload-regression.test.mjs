import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const root = '/home/dzerok/.local/share/mise/installs/node/26.8.2/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai';
const source = readFileSync(`${root}/dsh-llm-pi-ai/lib/index.js`, 'utf8');
const start = source.indexOf('function classifyPiAiError(message) {');
const end = source.indexOf('\n/**', start);
assert.ok(start >= 0 && end > start, 'Installed classifier must be present');
const classify = vm.runInNewContext(`${source.slice(start, end)}; classifyPiAiError`, {
  isQuotaExceededError: text => /quota exceeded/i.test(text),
  QUOTA_EXCEEDED_CODE: 'QUOTA_EXCEEDED',
});

for (const [name, message, expected] of [
  ['reported overload envelope', JSON.stringify({type:'error', error:{message:'Our servers are currently overloaded. Please try again later.', type:'server_error', code:'server_is_overloaded'}}), 'SERVER'],
  ['Anthropic overloaded envelope', JSON.stringify({type:'error', error:{type:'overloaded_error', message:'Overloaded'}}), 'SERVER'],
  ['server envelope without numeric status', JSON.stringify({type:'error', error:{type:'server_error', message:'Internal failure'}}), 'SERVER'],
  ['invalid request mentioning overload remains invalid', JSON.stringify({type:'error',error:{type:'invalid_request_error',message:'server_is_overloaded is not a valid model'}}), 'INVALID_REQUEST'],
  ['ordinary text is not an error envelope', 'Please explain server_is_overloaded and server_error', 'PI_AI_ERROR'],
  ['JSON content mentioning overload is not an error', JSON.stringify({message:'server_is_overloaded', content:'server_error'}), 'PI_AI_ERROR'],
  ['HTTP server error', '502 Bad Gateway', 'SERVER'],
  ['rate limit', '429 Too many requests', 'RATE_LIMIT'],
  ['authentication', '401 Unauthorized', 'AUTH'],
  ['timeout', 'request timed out', 'TIMEOUT'],
  ['closed transport', 'stream ended before completion', 'TRANSPORT'],
  ['malformed JSON stays unknown', '{"error":{"type":"server_error"', 'PI_AI_ERROR'],
]) {
  test(name, () => assert.equal(classify(message), expected));
}

test('normal retry policy allows SERVER but not generic PI_AI_ERROR', () => {
  const policySource = readFileSync(`${root}/dsh-llm/lib/types/retry-policy.js`, 'utf8');
  const match = policySource.match(/const DEFAULT_RETRYABLE_CODES = Object\.freeze\((\[[\s\S]*?\])\);/);
  assert.ok(match, 'Default retry whitelist must be inspectable');
  const codes = vm.runInNewContext(match[1], { EMPTY_RESPONSE_CODE: 'EMPTY_RESPONSE' });
  assert.ok(codes.includes('SERVER'));
  assert.ok(!codes.includes('PI_AI_ERROR'));
});

test('retry consumer retries classified overload and stops at its limit', async () => {
  const retrySource = readFileSync(`${root}/dsh-llm-retry/lib/index.js`, 'utf8');
  const begin = retrySource.indexOf('\tasync function backoff(');
  const finish = retrySource.indexOf('\n\tconst disposeListener', begin);
  assert.ok(begin >= 0 && finish > begin);
  const events = [];
  let previous;
  const recover = vm.runInNewContext(`${retrySource.slice(begin, finish)}; recover`, {
    AbortSignal,
    lifetime: { signal: new AbortController().signal },
    ctx: { sessionProjections: { stateOf: () => ({ route: previous }) } },
    retryPolicyKey: () => 'policy',
    retryStateKey: () => 'route',
    RetryId: value => value,
    randomUUID: () => 'test-retry',
    random: () => 0,
    localDelay: () => 0,
    cancellableDelay: async () => true,
  });
  const policy = { mode: 'normal', maxRetries: 2, maxDelayMs: 1000, retryableCodes: ['SERVER'] };
  const payload = {
    agent: { session: { append: (type, data) => events.push({ type, data }) } },
    turn: 1, step: 1, provider: 'or', retryPolicy: policy,
    failure: { code: classify(JSON.stringify({type:'error', error:{type:'server_error', code:'server_is_overloaded'}})) },
    signal: new AbortController().signal,
  };
  let terminal = 0;
  const next = async () => { terminal++; return undefined; };
  assert.equal((await recover(payload, next)).kind, 'retry');
  assert.equal(events[0].type, 'llm/retry');
  assert.equal(events[1].type, 'llm/retry-started');
  assert.equal(terminal, 0);
  previous = { retry: 2, retryId: 'test-retry' };
  assert.equal(await recover(payload, next), undefined);
  assert.equal(terminal, 1);
  assert.equal(events.length, 2);
});
