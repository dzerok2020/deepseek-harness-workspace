import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, normalize, sep } from 'node:path';
import { homedir } from 'node:os';
import vm from 'node:vm';

const file = join(homedir(), '.dsh/profiles/web/node_modules/@vectorize-io/hindsight-coding-agents/dist/dsh.js');

function harness(t) {
  if (!existsSync(file)) { t.skip('optional installed adapter unavailable'); return; }
  const source = readFileSync(file, 'utf8');
  const slice = (start, end) => {
    const a = source.indexOf(start), b = source.indexOf(end, a);
    assert.ok(a >= 0 && b > a, `installed adapter missing ${start}`);
    return source.slice(a, b);
  };
  const calls = { prompt: [], retain: [], seed: 0 };
  const workspace = { core: {
    onPrompt: async (id, prompt) => calls.prompt.push([id, prompt]),
    getInjection: () => 'synthetic Hindsight-only memory',
    onSessionIdle: async (id) => calls.retain.push(id),
  } };
  const scope = {
    HARNESS2: 'dsh', HINDSIGHT_PLUGIN: 'hindsight', liveAgents: new Map(),
    ensureSeeded: () => calls.seed++, randomUUID2: () => 'injection-id', diag: () => {},
    workspaceFor: () => workspace, workspaceRoot: (agent) => agent.session.header.cwd,
  };
  vm.createContext(scope);
  vm.runInContext(slice('function workspaceForAgent(', 'function toDshParameters('), scope);
  const hooks = scope.createDshHooks(scope.workspaceForAgent);
  const agent = { session: { header: { id: 'synthetic-session', cwd: '/synthetic/repo' } } };
  return { hooks, calls, agent };
}

test('opt-in stays inside the approved path even for an outside linked worktree', (t) => {
  if (!existsSync(file)) return t.skip('optional installed adapter unavailable');
  const source = readFileSync(file, 'utf8');
  const start = source.indexOf('function configuredDir(');
  const end = source.indexOf('function pathSection(', start);
  assert.ok(start >= 0 && end > start);
  const config = JSON.parse(readFileSync(new URL('../tools/hindsight-dsh.config.json', import.meta.url), 'utf8'));
  const workspace = config.optInPaths[0];
  const scope = { join5: join, homedir2: homedir, normalize, sep,
    mainWorktreeRoot: () => ({ status: 'resolved', root: workspace }) };
  vm.createContext(scope);
  vm.runInContext(source.slice(start, end), scope);
  assert.equal(scope.isOptedIn(config, workspace), true);
  assert.equal(scope.isOptedIn(config, join(workspace, 'child')), true);
  assert.equal(scope.isOptedIn(config, '/outside/linked-worktree'), false);
  assert.equal(scope.isOptedIn(config, workspace + '-other'), false);
});

test('published DSH adapter only recalls real user prompts and deduplicates continuation', async (t) => {
  const h = harness(t); if (!h) return;
  const message = { source: { kind: 'user' }, content: [{ type: 'text', text: 'synthetic goal' }] };
  const invoke = (messages) => h.hooks.preStep({ agent: h.agent, signal: { aborted: false } }, async () => ({ kind: 'enter', messages }));
  const first = await invoke([message]);
  assert.equal(first.messages.length, 2);
  assert.equal(first.messages[1].source.kind, 'plugin:hindsight');
  const repeated = await invoke([message]);
  assert.equal(repeated.messages.length, 1);
  await invoke([{ source: { kind: 'tool' }, content: [{ type: 'text', text: 'tool result' }] }]);
  assert.equal(h.calls.prompt.length, 2);
});

test('subagents never recall or retain and main turn performs one writeback', async (t) => {
  const h = harness(t); if (!h) return;
  const subagent = { session: { header: { id: 'child', cwd: '/synthetic/repo', origin: 'subagent' } } };
  h.hooks.sessionStart({ agent: subagent });
  await h.hooks.turnStopping({ agent: subagent });
  assert.equal(h.calls.seed, 0);
  assert.equal(h.calls.retain.length, 0);
  h.hooks.sessionStart({ agent: h.agent });
  await h.hooks.turnStopping({ agent: h.agent });
  assert.deepEqual(h.calls.retain, ['synthetic-session']);
});
