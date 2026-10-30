import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { Context } from '@deepseek-ai/cordis';
import { ToolRuntime } from '@deepseek-ai/dsh-tools';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import { registerHooks } from '../lib/hooks.js';
import { classifyHooks, selectApprovedHooks } from '../lib/hook-policy.js';

const revision = 'b92f181b3b748d1abbc2afd94af6aa7d8c8fca29';

test('reviewed doc warning executes through contained native admission without writing a project file', { skip: !process.env.ECC_ROOT }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'ecc-approved-hook-'));
  const ctx = new Context();
  let registration;
  t.after(async () => {
    for (const dispose of registration?.disposers ?? []) await dispose();
    await ctx.fiber.dispose();
    assert.ok(resolve(root).startsWith(join(tmpdir(), 'ecc-approved-hook-')));
    await rm(root, { recursive: true, force: true });
  });
  await ctx.plugin(SystemPrompt).await();
  const runtime = new ToolRuntime(ctx, { mode: 'native' });
  const manifest = JSON.parse(await readFile(join(process.env.ECC_ROOT, 'hooks/hooks.json'), 'utf8'));
  const options = { sourceRevision: revision, availableCapabilities: ['contained-runner', 'native-monotonic-guard', 'native-pre-tool-context'] };
  const report = classifyHooks(manifest, options);
  assert.equal(report.status, 'reviewed');
  assert.equal(report.approvedHooks.length, 1);
  const selected = selectApprovedHooks(manifest, options);
  let bodyRuns = 0;
  runtime.register({
    name: 'write', description: 'No-write fixture', parameters: { type: 'object', properties: { file_path: { type: 'string' } }, required: ['file_path'] },
    output: { schema: { type: 'object', properties: {} }, render: () => [{ type: 'text', text: 'fixture body only' }] },
    execute: async () => { bodyRuns++; return {}; },
  });
  registration = await registerHooks(ctx, { eccRoot: process.env.ECC_ROOT, dataRoot: root, enableHooks: true, hookManifest: selected });
  assert.equal(registration.status, 'partial');
  const owner = { session: { header: { id: 'approved-hook-fixture', cwd: '/fixture/project' } }, injected: [], inject(message) { this.injected.push(message); }, steer() {} };
  const result = await runtime.execute({ agent: owner, name: 'write', arguments: { file_path: '/fixture/project/NOTES.md' }, callId: 'approved-hook', signal: new AbortController().signal });
  assert.equal(result.isError, false, JSON.stringify(result));
  assert.equal(bodyRuns, 1);
  assert.match(JSON.stringify(owner.injected), /Ad-hoc documentation filename detected/);
});
