import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, access, readlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { Context } from '@deepseek-ai/cordis';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { ToolRuntime } from '@deepseek-ai/dsh-tools';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import { registerHooks } from '../lib/hooks.js';

async function fixture(t, definitions = {}) {
  const root = await mkdtemp(join(tmpdir(), 'ecc-hooks-test-'));
  const eccRoot = join(root, 'ecc');
  const dataRoot = join(root, 'data');
  await mkdir(join(eccRoot, 'hooks'), { recursive: true });
  await writeFile(join(eccRoot, 'hooks/hooks.json'), JSON.stringify({ hooks: definitions }));
  const ctx = new Context();
  let registration;
  let runtime;
  async function native() {
    if (!runtime) {
      await ctx.plugin(SystemPrompt).await();
      runtime = new ToolRuntime(ctx, { mode: 'native' });
    }
    return runtime;
  }
  t.after(async () => {
    for (const dispose of registration?.disposers ?? []) await dispose();
    await ctx.fiber.dispose();
    assert.equal(resolve(root), root);
    assert.ok(root.startsWith(join(tmpdir(), 'ecc-hooks-test-')));
    await rm(root, { recursive: true, force: true });
  });
  return {
    root, eccRoot, dataRoot, ctx, native,
    async register(config = {}) {
      if (config.enableHooks !== false) await native();
      registration = await registerHooks(ctx, { eccRoot, dataRoot, enableHooks: true, ...config });
      return registration;
    },
    async script(name, source) {
      await writeFile(join(eccRoot, name), source);
      return { type: 'command', command: `node "$CLAUDE_PLUGIN_ROOT/${name}"` };
    },
    async config(defs) {
      await writeFile(join(eccRoot, 'hooks/hooks.json'), JSON.stringify({ hooks: defs }));
    },
  };
}

function agent(cwd = '/fixture/project') {
  return {
    session: { header: { id: 'session-fixture', cwd } },
    injected: [], steered: [],
    inject(message) { this.injected.push(message); },
    steer(message) { this.steered.push(message); },
  };
}
function execution(owner = agent(), name = 'bash', args = { command: 'printf fixture' }) {
  return Object.freeze({ agent: owner, name, arguments: args, callId: 'tool-fixture', signal: new AbortController().signal });
}
const emit = (output, code = 0) => `process.stdout.write(${JSON.stringify(JSON.stringify(output))}); process.exitCode = ${code};`;
const specific = (event, fields) => ({ hookSpecificOutput: { hookEventName: event, ...fields } });
const text = (message) => message.content.filter((block) => block.type === 'text').map((block) => block.text).join('\n');
async function until(check, deadline = 3000) {
  const end = Date.now() + deadline;
  while (!check() && Date.now() < end) await new Promise((done) => setTimeout(done, 20));
  assert.ok(check(), 'fixture did not settle before deadline');
}

test('disabled mode inventories every event without registering listeners or creating state', async (t) => {
  const f = await fixture(t, { PreToolUse: [{ hooks: [{ type: 'command', command: 'exit 2' }] }], SessionEnd: [] });
  const result = await f.register({ enableHooks: false });
  assert.equal(result.status, 'disabled');
  assert.equal(result.disposers.length, 0);
  assert.deepEqual(result.hooks.map((entry) => entry.event), ['PreToolUse', 'SessionEnd']);
  await assert.rejects(access(f.dataRoot), { code: 'ENOENT' });
  assert.deepEqual(await f.ctx.waterfall('tools/pre-execute', execution(), async () => ({ kind: 'allow' })), { kind: 'allow' });
});

test('real Cordis registration maps Bash matcher and preserves exact JSON tool payload', async (t) => {
  const f = await fixture(t);
  const hook = await f.script('payload.cjs', `let input='';process.stdin.on('data',c=>input+=c);process.stdin.on('end',()=>{const p=JSON.parse(input);console.log(JSON.stringify({hookSpecificOutput:{hookEventName:'PreToolUse',additionalContext:JSON.stringify(p)}}));});`);
  await f.config({ PreToolUse: [{ matcher: 'Bash', hooks: [hook] }] });
  const result = await f.register();
  assert.notEqual(result.status, 'blocked', result.gaps.join('\n'));
  const owner = agent();
  let continued = 0;
  const exec = execution(owner);
  assert.deepEqual(await f.ctx.waterfall('tools/pre-execute', exec, async () => { continued++; return { kind: 'allow' }; }), { kind: 'allow' });
  assert.equal(continued, 1);
  const payload = JSON.parse(text(owner.injected[0]));
  assert.deepEqual(payload, { session_id: 'session-fixture', cwd: '/fixture/project', transcript_path: '', hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: exec.arguments, tool_use_id: 'tool-fixture' });
  assert.ok(result.gaps.some((gap) => /transcript/i.test(gap)));
});

test('deny > ask > allow and exit 2 remains blocking through the installed protocol', async (t) => {
  const f = await fixture(t);
  const allow = await f.script('allow.cjs', emit(specific('PreToolUse', { permissionDecision: 'allow' })));
  const ask = await f.script('ask.cjs', emit(specific('PreToolUse', { permissionDecision: 'ask', permissionDecisionReason: 'ask fixture' })));
  const deny = await f.script('deny.cjs', emit(specific('PreToolUse', { permissionDecision: 'deny', permissionDecisionReason: 'deny fixture' })));
  await f.config({ PreToolUse: [{ matcher: 'Bash', hooks: [allow, ask, deny] }] });
  await f.register();
  assert.deepEqual(await f.ctx.waterfall('tools/pre-execute', execution(), async () => assert.fail('deny must veto next')), { kind: 'deny', reason: 'deny fixture' });
});

test('ask is preserved and downstream native policy cannot be bypassed by hook allow', async (t) => {
  const f = await fixture(t);
  const hook = await f.script('ask.cjs', emit(specific('PreToolUse', { permissionDecision: 'ask', permissionDecisionReason: 'review' })));
  await f.config({ PreToolUse: [{ matcher: 'Bash', hooks: [hook] }] });
  await f.register();
  assert.deepEqual(await f.ctx.waterfall('tools/pre-execute', execution(), async () => ({ kind: 'allow' })), { kind: 'ask', reason: 'review' });
  assert.deepEqual(await f.ctx.waterfall('tools/pre-execute', execution(), async () => ({ kind: 'deny', reason: 'native deny' })), { kind: 'deny', reason: 'native deny' });
});

test('exit 2, malformed output, other nonzero exit and updatedInput fail closed', async (t) => {
  for (const [name, source, reason] of [
    ['exit2', `process.stderr.write('fixture veto');process.exitCode=2;`, /fixture veto/],
    ['bad-json', `console.log('{broken');`, /invalid|malformed|JSON/i],
    ['crash', `process.exitCode=9;`, /exit|failed/i],
    ['rewrite', emit(specific('PreToolUse', { updatedInput: { command: 'not-executed' } })), /updatedInput/],
  ]) {
    await t.test(name, async (t) => {
      const f = await fixture(t);
      const hook = await f.script('case.cjs', source);
      await f.config({ PreToolUse: [{ hooks: [hook] }] });
      await f.register();
      const exec = execution();
      const decision = await f.ctx.waterfall('tools/pre-execute', exec, async () => assert.fail('must fail closed'));
      assert.equal(decision.kind, 'deny');
      assert.match(decision.reason, reason);
      assert.deepEqual(exec.arguments, { command: 'printf fixture' });
    });
  }
});

test('matcher misses are neutral and invalid regex is disabled with a recorded gap', async (t) => {
  const f = await fixture(t, { PreToolUse: [{ matcher: 'Read', hooks: [{ type: 'command', command: 'exit 2' }] }, { matcher: '[', hooks: [{ type: 'command', command: 'exit 2' }] }] });
  const result = await f.register();
  assert.deepEqual(await f.ctx.waterfall('tools/pre-execute', execution(), async () => ({ kind: 'allow' })), { kind: 'allow' });
  assert.ok(result.gaps.some((gap) => /matcher/i.test(gap)));
});

test('prompt admission uses native messages and merges ordered context without overriding rejection', async (t) => {
  const f = await fixture(t);
  const one = await f.script('prompt.cjs', emit(specific('UserPromptSubmit', { additionalContext: 'prompt context' })));
  await f.config({ UserPromptSubmit: [{ hooks: [one] }] });
  await f.register();
  const owner = agent();
  const messages = [createUserMessage({ content: [{ type: 'text', text: 'hello' }], source: { kind: 'user' } })];
  const payload = { agent: owner, messages, turn: 1, step: 1, signal: new AbortController().signal };
  const entered = await f.ctx.waterfall('agent/pre-step', payload, async () => ({ kind: 'enter', messages }));
  assert.equal(entered.kind, 'enter');
  assert.equal(entered.messages[0], messages[0]);
  assert.equal(text(entered.messages[1]), 'prompt context');
  assert.deepEqual(await f.ctx.waterfall('agent/pre-step', payload, async () => ({ kind: 'reject' })), { kind: 'reject' });
});

test('post-tool context enriches downstream result and errors select PostToolUseFailure', async (t) => {
  const f = await fixture(t);
  const ok = await f.script('post.cjs', emit(specific('PostToolUse', { additionalContext: 'post context' })));
  const fail = await f.script('failure.cjs', emit(specific('PostToolUseFailure', { additionalContext: 'failure context' })));
  await f.config({ PostToolUse: [{ matcher: 'Bash', hooks: [ok] }], PostToolUseFailure: [{ matcher: 'Bash', hooks: [fail] }] });
  await f.register();
  const downstream = { kind: 'accept', content: [{ type: 'text', text: 'native result' }], additionalContexts: [createUserMessage({ content: [{ type: 'text', text: 'native context' }], source: { kind: 'user' } })] };
  const success = await f.ctx.waterfall('tools/post-execute', execution(), { isError: false, value: { ok: true }, content: [] }, async () => downstream);
  assert.equal(success.content, downstream.content);
  assert.deepEqual(success.additionalContexts.map(text), ['native context', 'post context']);
  const failure = await f.ctx.waterfall('tools/post-execute', execution(), { isError: true, error: { message: 'fixture failure' }, content: [] }, async () => ({ kind: 'accept' }));
  assert.deepEqual(failure.additionalContexts.map(text), ['failure context']);
});

test('SessionStart and Stop use real serial events; Stop does not synthesize SessionEnd', async (t) => {
  const f = await fixture(t);
  const start = await f.script('start.cjs', emit(specific('SessionStart', { additionalContext: 'start context' })));
  const stop = await f.script('stop.cjs', emit({ decision: 'block', reason: 'keep working' }));
  await f.config({ SessionStart: [{ matcher: 'startup', hooks: [start] }], Stop: [{ hooks: [stop] }], SessionEnd: [{ hooks: [{ type: 'command', command: 'exit 2' }] }], PreCompact: [], PermissionRequest: [], TaskCompleted: [], SubagentStop: [] });
  const result = await f.register();
  const owner = agent();
  await f.ctx.serial('agent/created', { agent: owner, source: 'startup' });
  assert.equal(text(owner.injected[0]), 'start context');
  await f.ctx.serial('agent/turn-stopping', { agent: owner, turn: 1, signal: new AbortController().signal });
  assert.equal(text(owner.steered[0]), 'keep working');
  for (const event of ['SessionEnd', 'PreCompact', 'PermissionRequest', 'TaskCompleted', 'SubagentStop']) {
    const state = result.hooks.find((entry) => entry.event === event);
    assert.equal(state.status, 'unsupported', event);
    assert.ok(state.reason, event);
  }
});

test('async hooks return promptly, deliver context later, and disposer drains/cancels them', async (t) => {
  const f = await fixture(t);
  const hook = await f.script('async.cjs', `setTimeout(()=>{${emit(specific('PreToolUse', { additionalContext: 'late context' }))}},350);`);
  hook.async = true;
  hook.timeout = 2;
  await f.config({ PreToolUse: [{ hooks: [hook] }] });
  const registration = await f.register();
  const owner = agent();
  const started = performance.now();
  assert.deepEqual(await f.ctx.waterfall('tools/pre-execute', execution(owner), async () => ({ kind: 'allow' })), { kind: 'allow' });
  assert.ok(performance.now() - started < 300, 'async hook must not block admission');
  assert.equal(owner.injected.length, 0);
  await until(() => owner.injected.length === 1);
  assert.equal(text(owner.injected[0]), 'late context');
  await f.ctx.waterfall('tools/pre-execute', execution(owner), async () => ({ kind: 'allow' }));
  for (const dispose of registration.disposers) await dispose();
  await new Promise((done) => setTimeout(done, 450));
  assert.equal(owner.injected.length, 1, 'disposing must prevent late context delivery');
});

test('timeout and caller cancellation kill the contained command and fail closed', async (t) => {
  const f = await fixture(t);
  const hook = await f.script('slow.cjs', `setTimeout(()=>console.log('{}'),10000);`);
  hook.timeout = 0.08;
  await f.config({ PreToolUse: [{ hooks: [hook] }] });
  await f.register();
  const started = performance.now();
  const decision = await f.ctx.waterfall('tools/pre-execute', execution(), async () => assert.fail('timeout must veto'));
  assert.equal(decision.kind, 'deny');
  assert.match(decision.reason, /timeout/i);
  assert.ok(performance.now() - started < 2000);
  const abort = new AbortController();
  abort.abort();
  const cancelled = await f.ctx.waterfall('tools/pre-execute', { ...execution(), signal: abort.signal }, async () => assert.fail('abort must veto'));
  assert.equal(cancelled.kind, 'deny');
  assert.match(cancelled.reason, /abort|cancel/i);
});

test('real bwrap hides canary credentials, host filesystem and network namespace while ECC stays read-only', async (t) => {
  const f = await fixture(t);
  const canary = join(f.root, 'credential-canary');
  await writeFile(canary, 'fixture-only-NOT-a-real-secret');
  const original = process.env.ECC_HOOK_TEST_CREDENTIAL;
  process.env.ECC_HOOK_TEST_CREDENTIAL = 'fixture-only-env-canary';
  t.after(() => { if (original === undefined) delete process.env.ECC_HOOK_TEST_CREDENTIAL; else process.env.ECC_HOOK_TEST_CREDENTIAL = original; });
  const hostNet = await readlink('/proc/self/ns/net');
  const hook = await f.script('isolation.cjs', `const fs=require('node:fs');const checks={env:process.env.ECC_HOOK_TEST_CREDENTIAL===undefined,secret:!fs.existsSync(${JSON.stringify(canary)}),network:fs.readlinkSync('/proc/self/ns/net')!==${JSON.stringify(hostNet)},skip:process.env.ECC_SKIP_LLM_SUMMARY==='1',observer:JSON.parse(fs.readFileSync(process.env.CLAUDE_CONFIG_DIR+'/continuous-learning-v2/config.json','utf8')).observer.enabled===false};try{fs.writeFileSync('/ecc/forbidden','no');checks.readonly=false}catch{checks.readonly=true}try{fs.writeFileSync('/outside','no');checks.outside=false}catch{checks.outside=true}console.log(JSON.stringify({hookSpecificOutput:{hookEventName:'PreToolUse',additionalContext:JSON.stringify(checks)}}));`);
  await f.config({ PreToolUse: [{ hooks: [hook] }] });
  const result = await f.register();
  assert.notEqual(result.status, 'blocked', result.gaps.join('\n'));
  const owner = agent();
  assert.deepEqual(await f.ctx.waterfall('tools/pre-execute', execution(owner), async () => ({ kind: 'allow' })), { kind: 'allow' });
  assert.deepEqual(JSON.parse(text(owner.injected[0])), { env: true, secret: true, network: true, skip: true, observer: true, readonly: true, outside: true });
  assert.equal(await readFile(canary, 'utf8'), 'fixture-only-NOT-a-real-secret');
  await assert.rejects(access(join(f.eccRoot, 'forbidden')), { code: 'ENOENT' });
});

test('observer skip and configuration follow real ECC environment seams', async (t) => {
  const f = await fixture(t);
  const hook = await f.script('observer-env.cjs', `const fs=require('node:fs');console.log(JSON.stringify({hookSpecificOutput:{hookEventName:'PreToolUse',additionalContext:JSON.stringify({skip:process.env.ECC_SKIP_OBSERVE,enabled:process.env.CLV2_CONFIG?JSON.parse(fs.readFileSync(process.env.CLV2_CONFIG)).observer.enabled:'unset'})}}));`);
  await f.config({ PreToolUse: [{ hooks: [hook] }] });
  await f.register();
  const owner = agent();
  await f.ctx.waterfall('tools/pre-execute', execution(owner), async () => ({ kind: 'allow' }));
  assert.deepEqual(JSON.parse(text(owner.injected[0])), { skip: '1', enabled: false });
});

test('missing containment installs only a denying gate, never an uncontained fallback', async (t) => {
  const f = await fixture(t, { PreToolUse: [{ hooks: [{ type: 'command', command: 'exit 0' }] }] });
  const savedPath = process.env.PATH;
  process.env.PATH = '';
  let result;
  try { result = await f.register(); } finally { process.env.PATH = savedPath; }
  assert.equal(result.status, 'blocked');
  assert.ok(result.gaps.some((gap) => /containment|bwrap/i.test(gap)));
  const decision = await f.ctx.waterfall('tools/pre-execute', execution(), async () => assert.fail('no fallback'));
  assert.equal(decision.kind, 'deny');
});

test('Stop continue:false finishes the turn rather than requesting continuation', async (t) => {
  const f = await fixture(t);
  const hook = await f.script('stop-now.cjs', emit({ continue: false, stopReason: 'finished', decision: 'block' }));
  await f.config({ Stop: [{ hooks: [hook] }] });
  await f.register();
  const owner = agent();
  await f.ctx.serial('agent/turn-stopping', { agent: owner, turn: 1 });
  assert.deepEqual(owner.steered, []);
});

test('ask retains pre-tool context and async decision gaps remain observable', async (t) => {
  const f = await fixture(t);
  const ask = await f.script('ask-context.cjs', emit(specific('PreToolUse', { permissionDecision: 'ask', additionalContext: 'approval context' })));
  const late = await f.script('late-deny.cjs', `setTimeout(()=>{${emit(specific('PreToolUse', { permissionDecision: 'deny', permissionDecisionReason: 'late veto' }))}},100);`);
  late.async = true;
  await f.config({ PreToolUse: [{ hooks: [ask, late] }] });
  const registration = await f.register();
  const owner = agent();
  assert.equal((await f.ctx.waterfall('tools/pre-execute', execution(owner), async () => ({ kind: 'allow' }))).kind, 'ask');
  assert.equal(text(owner.injected[0]), 'approval context');
  await until(() => registration.gaps.some((gap) => gap.includes('late veto')));
});

test('public ToolRuntime executes the real deny seam without running the tool body', async (t) => {
  const f = await fixture(t, { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'printf fixture-block >&2; exit 2' }] }] });
  const runtime = await f.native();
  let bodyRuns = 0;
  runtime.register({
    name: 'bash', description: 'Fixture only', parameters: { type: 'object', properties: {} },
    output: { schema: { type: 'object', properties: {} }, render: () => [{ type: 'text', text: 'body' }] },
    execute: async () => { bodyRuns++; return {}; },
  });
  await f.register();
  const result = await runtime.execute({ name: 'bash', arguments: {}, callId: 'native-fixture', signal: new AbortController().signal });
  assert.equal(bodyRuns, 0);
  assert.equal(result.isError, true);
  assert.match(JSON.stringify(result), /fixture-block/);
});

test('unsupported command types and invalid hook config are visible and fail closed', async (t) => {
  const f = await fixture(t, { PreToolUse: [{ hooks: [{ type: 'prompt', prompt: 'not a local command' }] }] });
  const result = await f.register();
  assert.ok(result.gaps.some((gap) => /prompt|command type/i.test(gap)));
  const decision = await f.ctx.waterfall('tools/pre-execute', execution(), async () => assert.fail('unsupported permission hook'));
  assert.equal(decision.kind, 'deny');
});

async function nativeBody(f) {
  const runtime = await f.native();
  let bodyRuns = 0;
  runtime.register({
    name: 'bash', description: 'Fixture only', parameters: { type: 'object', properties: {} },
    output: { schema: { type: 'object', properties: {} }, render: () => [{ type: 'text', text: 'body' }] },
    execute: async () => { bodyRuns++; return {}; },
  });
  return {
    get bodyRuns() { return bodyRuns; },
    execute: () => runtime.execute({ name: 'bash', arguments: {}, callId: 'guard-fixture', signal: new AbortController().signal }),
  };
}

for (const mode of ['wrapped deny', 'bypassed preflight', 'blocked containment', 'invalid config']) {
  test(`monotonic native admission preserves ECC denial: ${mode}`, async (t) => {
    const f = await fixture(t, { PreToolUse: [{ hooks: [{ type: 'command', command: 'printf fixture-block >&2; exit 2' }] }] });
    const body = await nativeBody(f);
    f.ctx.on('tools/pre-execute', async (_exec, next) => {
      if (mode !== 'bypassed preflight') await next();
      return { kind: 'allow' };
    });
    if (mode === 'invalid config') await writeFile(join(f.eccRoot, 'hooks/hooks.json'), '{');
    const savedPath = process.env.PATH;
    try {
      if (mode === 'blocked containment') process.env.PATH = '';
      await f.register();
    } finally { process.env.PATH = savedPath; }
    const result = await body.execute();
    assert.equal(body.bodyRuns, 0, `${mode} must not run the native tool body`);
    assert.equal(result.isError, true);
    assert.match(JSON.stringify(result), /fixture-block|preflight|containment|configuration/i);
  });
}

test('Stop reentry is per agent and turn and does not loop after one continuation', async (t) => {
  const f = await fixture(t);
  const hook = await f.script('stop-reentry.cjs', `
    const fs = require('node:fs');
    const payload = JSON.parse(fs.readFileSync(0, 'utf8'));
    fs.appendFileSync('/data/stop-payloads', JSON.stringify(payload) + '\\n');
    if (!payload.stop_hook_active) process.stdout.write(JSON.stringify({decision:'block',reason:'one continuation'}));
  `);
  await f.config({ Stop: [{ hooks: [hook] }] });
  await f.register();
  const owner = agent();
  const other = agent();
  for (const turn of [1, 1, 1, 2, 2]) await f.ctx.serial('agent/turn-stopping', { agent: owner, turn });
  await f.ctx.serial('agent/turn-stopping', { agent: other, turn: 2 });
  const payloads = (await readFile(join(f.dataRoot, 'hooks-state/stop-payloads'), 'utf8')).trim().split('\n').map(JSON.parse);
  assert.deepEqual(payloads.map((payload) => payload.stop_hook_active), [false, true, true, false, true, false]);
  assert.equal(owner.steered.length, 2);
  assert.equal(other.steered.length, 1);
});

test('enabled hooks reject hosts without the public monotonic tools.guard seam', async (t) => {
  const f = await fixture(t);
  await assert.rejects(registerHooks(f.ctx, { eccRoot: f.eccRoot, dataRoot: f.dataRoot, enableHooks: true }), /tools\.guard|monotonic/i);
  await assert.rejects(access(join(f.dataRoot, 'hooks-state')));
});

// Every executed command above is authored in the temporary fixture; no pinned
// upstream hook, real credential, network request, memory store or model is run.
