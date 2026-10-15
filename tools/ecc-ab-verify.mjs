// Run against an isolated dsh-vibe-guard copy: EVAL_ARM=/absolute/path node --test tools/ecc-ab-verify.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.env.EVAL_ARM;
if (!root) throw new Error('EVAL_ARM must name the plugin copy under test');
const plugin = resolve(root);
const { classifyCall, compileConfig, createState, noteCall, shouldForceVerify } =
  await import(pathToFileURL(join(plugin, 'lib/policy.js')).href);
const { apply } = await import(pathToFileURL(join(plugin, 'lib/index.js')).href);
const cfg = compileConfig();

function execute(command) {
  const dir = mkdtempSync(join(tmpdir(), 'ecc-ab-shell-'));
  try {
    const result = spawnSync('bash', ['-c', command], { cwd: dir, encoding: 'utf8' });
    if (result.error) throw result.error;
    return { ok: result.status === 0, modified: existsSync(join(dir, 'report.txt')) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function observe(command) {
  const outcome = execute(command);
  const verdict = classifyCall({ name: 'bash', arguments: { command } }, cfg);
  const state = createState();
  noteCall(state, verdict, outcome.ok);
  const handlers = new Map();
  const steers = [];
  apply({ tools: { guard() {} }, on(event, fn) { handlers.set(event, fn); } }, {});
  const agent = { steer(message) { steers.push(message); } };
  await handlers.get('tools/post-execute')(
    { name: 'bash', arguments: { command }, agent },
    outcome.ok ? {} : { isError: true },
    async () => ({ kind: 'accept' })
  );
  await handlers.get('agent/turn-stopping')({ agent, turn: 1 });
  return { ...outcome, kind: verdict.kind, debt: !!shouldForceVerify(state, cfg), steers: steers.length };
}

test('classification regression: order, repeat, redirection, and legacy actions', () => {
  const classify = (command) => classifyCall({ name: 'bash', arguments: { command } }, cfg).kind;
  for (const [command, expected] of [
    ['node --test test/ && echo generated > report.txt', 'edit'],
    ['echo generated > report.txt && node --test test/', 'verify'],
    ['npm test && echo generated > report.txt && node --test test/', 'verify'],
    ['npm test > /dev/null', 'verify'],
    ['pnpm lint; printf ok > generated.json', 'edit'],
    ['node --test test/', 'verify'],
    ['echo generated > report.txt', 'edit'],
    ['git status --short', 'neutral']
  ]) assert.equal(classify(command), expected, command);
});

test('passing check followed by write requires another check', async () => {
  const r = await observe('node --test /dev/null >/dev/null 2>&1; echo changed > report.txt');
  assert.deepEqual(r, { ok: true, modified: true, kind: 'edit', debt: true, steers: 1 });
});

test('write followed by passing check is verified', async () => {
  const r = await observe('echo changed > report.txt; node --test /dev/null >/dev/null 2>&1');
  assert.deepEqual(r, { ok: true, modified: true, kind: 'verify', debt: false, steers: 0 });
});

test('write followed by failed command still requires a check', async () => {
  const r = await observe('echo changed > report.txt && false');
  assert.deepEqual(r, { ok: false, modified: true, kind: 'edit', debt: true, steers: 1 });
});

test('failed command before && write has no change', async () => {
  const r = await observe('false && echo changed > report.txt');
  assert.deepEqual(r, { ok: false, modified: false, kind: 'edit', debt: false, steers: 0 });
});
