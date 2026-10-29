import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';

const config = JSON.parse(readFileSync(new URL('../tools/hindsight-dsh.config.json', import.meta.url), 'utf8'));
const workspace = '/home/dzerok/Documents/deepseek-harness/default-workspace';

test('Hindsight rollout uses one existing local server and project identity', () => {
  assert.equal(config.serverMode, 'self-hosted');
  assert.equal(config.apiUrl, 'http://127.0.0.1:9077');
  assert.equal(config.bankIdTemplate, 'coding-agent::{gitProject}');
  assert.equal(config.optInOnly, true);
  assert.equal(config.resolveWorktrees, false);
  assert.deepEqual(config.optInPaths, [workspace]);
  assert.equal(config.mapPathToBank, undefined);
  assert.equal(config.bankId, undefined);
});

test('startup cannot survey, import history, self-update or manage existing bank', () => {
  for (const field of ['autoSeed', 'codebaseSurvey', 'autoUpdate', 'manageBankConfig']) {
    assert.equal(config[field], false, field);
  }
  assert.equal(config.gitIngest, 'none');
  assert.equal(config.pageTriggerType, 'manual');
  assert.equal(config.autoInject, 'pages');
  assert.equal(config.retainSessions, true);
  assert.equal(config.retainExtractionMode, 'concise');
  assert.equal(config.maxParallelRetains, 1);
  assert.equal(config.pageSearchLimit, 2);
  assert.ok(config.pageRefreshEveryTurns > 0);
  assert.equal(config.recallOptions.budget, 'low');
});

test('native instructions keep one short profile and explicit memory ownership', () => {
  const agents = readFileSync(new URL('../AGENTS.md', import.meta.url), 'utf8');
  assert.match(agents, /## 9\. Profile ngắn và bộ nhớ dự án/);
  assert.match(agents, /Hindsight là bộ nhớ dự án chính/);
  assert.match(agents, /mới học vibe coding/);
  assert.match(agents, /hindsight-primary\.md/);
});

test('runbook separates staged settings, restart acceptance and preserved archives', () => {
  const doc = readFileSync(new URL('../docs/hindsight-primary.md', import.meta.url), 'utf8');
  for (const phrase of ['chưa restart', 'session mới', 'không xóa', 'autoSeed', 'fork', 'rollback']) {
    assert.ok(doc.includes(phrase), phrase);
  }
});

test('patch disables overlapping runtimes and retains native skills/MCP only', () => {
  const result = spawnSync('python3', ['-c', `
import json,yaml
from pathlib import Path
print(json.dumps(yaml.safe_load(Path('tools/hindsight-web.patch.yml').read_text())))
`], { cwd: new URL('..', import.meta.url), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const rows = JSON.parse(result.stdout);
  for (const id of ['mnemon', 'stratagate-memory', 'openviking-memory-runtime']) {
    assert.equal(rows.find(row => row.id === id)?.disabled, true, id);
  }
  assert.equal(rows.find(row => row.id === 'hindsight')?.disabled, false);
  const inserts = rows.flatMap(row => row.insert || []);
  assert.deepEqual(inserts.map(row => row.name), ['@deepseek-ai/dsh-mcp-client', '@deepseek-ai/dsh-skill-filesystem']);
  assert.equal(inserts[0].config.serverName, 'openviking');
  assert.match(inserts[0].config.args[0], /servers\/mcp-proxy\.mjs$/);
  assert.equal(inserts[1].config.includeDefaultRoots, false);
  assert.equal(inserts[1].config.watch, false);
  assert.equal(inserts.some(row => row.id === 'hindsight'), false, 'adapter must be registered only by its official bundle');
});

test('installed DSH registration is importable without starting memory hooks', (t) => {
  const path = join(homedir(), '.dsh/profiles/web/node_modules/@vectorize-io/hindsight-coding-agents/dist/dsh.js');
  if (!existsSync(path)) return t.skip('optional local adapter not installed');
  const script = `const m=await import(${JSON.stringify(path)});if(typeof m.apply!=='function'||!Array.isArray(m.inject))process.exit(1);console.log('native-adapter-import-ok')`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /native-adapter-import-ok/);
});
