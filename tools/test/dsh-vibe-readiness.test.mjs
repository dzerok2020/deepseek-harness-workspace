import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Only load the readiness handler, never main(), a phase runner, or a real curl.
const source = readFileSync(new URL('../dsh-vibe-run.mjs', import.meta.url), 'utf8');
const handler = source.slice(source.indexOf('function bridgeUp() {'), source.indexOf('\nfunction sh('));
const shim = 'http://127.0.0.1:17842';
const upstream = 'http://127.0.0.1:17841';
const model = 'chatgpt-web/gpt-6-sol';

function ready(overrides = {}) {
  const routes = {
    [shim + '/healthz']: { status: 'ok', mode: 'browser-only', bridge: upstream + '/' },
    [upstream + '/healthz']: { accepting_turns: true },
    [shim + '/v1/models']: { data: [{ id: model }] },
    ...overrides,
  };
  const requests = [];
  const context = vm.createContext({
    SHIM_HEALTH: shim + '/healthz', CGW_MODEL: model,
    spawnSync(command, args) {
      assert.equal(command, 'curl', 'runner/model commands are forbidden in this fixture');
      const url = args.at(-1);
      assert.ok(Object.hasOwn(routes, url), 'unexpected URL: ' + url);
      requests.push({ url, args });
      const body = routes[url];
      if (body instanceof Error) return { status: 7, stdout: '' };
      return { status: 0, stdout: typeof body === 'string' ? body : JSON.stringify(body) };
    },
  });
  vm.runInContext(handler + '\nresult = bridgeUp();', context, { timeout: 1000 });
  return { result: context.result, requests };
}

test('healthy browser-only shim, accepting bridge and desired catalog model are all required', () => {
  const { result, requests } = ready();
  assert.equal(result, true);
  assert.deepEqual(requests.map(({ url }) => url), [shim + '/healthz', upstream + '/healthz', shim + '/v1/models']);
  assert.ok(requests.every(({ args }) => args.includes('--fail')), 'HTTP errors must fail closed');
});

for (const [name, body] of [
  ['full mode', { status: 'ok', mode: 'full', bridge: upstream }],
  ['absent mode', { status: 'ok', bridge: upstream }],
  ['failed status', { status: 'error', mode: 'browser-only', bridge: upstream }],
  ['absent bridge', { status: 'ok', mode: 'browser-only' }],
  ['malformed bridge', { status: 'ok', mode: 'browser-only', bridge: {} }],
  ['invalid JSON', 'not json'],
  ['null JSON', 'null'],
  ['transport error', new Error('offline')],
]) {
  test('does not select cgw for shim ' + name, () => {
    assert.equal(ready({ [shim + '/healthz']: body }).result, false);
  });
}

for (const [name, body] of [
  ['not accepting turns', { accepting_turns: false }],
  ['missing readiness', { status: 'ok' }],
  ['truthy but not boolean', { accepting_turns: 'true' }],
  ['invalid JSON', 'bad upstream'],
  ['transport error', new Error('offline')],
]) {
  test('does not select cgw for upstream ' + name, () => {
    assert.equal(ready({ [upstream + '/healthz']: body }).result, false);
  });
}

for (const [name, body] of [
  ['wrong model', { data: [{ id: 'different/model' }] }],
  ['missing data', {}],
  ['non-array data', { data: { id: model } }],
  ['null entries', { data: [null] }],
  ['transport error', new Error('offline')],
]) {
  test('does not select cgw for catalog ' + name, () => {
    assert.equal(ready({ [shim + '/v1/models']: body }).result, false);
  });
}
