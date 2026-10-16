import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Checkpoint } from '../src/checkpoint.mjs';
const init = '[C2C]\nSTATE: INIT\nTASK_ID: toy\nITERATION: 0\n\nGOAL:\nInspect via MCP.';
const plan = '[C2C]\nSTATE: PLAN\nTASK_ID: toy\nITERATION: 1\n\nACTIONS:\nInspect.';

test('pending send survives restart and cannot be blindly resent', async () => {
 const dir = await mkdtemp(path.join(os.tmpdir(), 'dsh-checkpoint-'));
 try {
  const file = path.join(dir, 'task.json');
  const first = new Checkpoint(file);
  await first.begin({ workspace: dir, taskId: 'toy' });
  await first.prepare(init);
  const recovered = new Checkpoint(file);
  assert.equal((await recovered.read()).delivery, 'uncertain');
  await assert.rejects(recovered.prepare(init), /unresolved/);
  await assert.rejects(recovered.confirmSent('unrelated'), /exact/);
  await recovered.confirmSent(init);
  await assert.rejects(recovered.prepare(init), /reply/);
  await assert.rejects(recovered.accept(plan.replace('TASK_ID: toy', 'TASK_ID: wrong')), /matching/);
  await recovered.accept(plan);
  assert.equal((await recovered.read()).reply.state, 'PLAN');
  assert.equal((await stat(file)).mode & 0o777, 0o600);
 } finally { await rm(dir, {recursive:true, force:true}); }
});

test('checkpoint rejects conflicting task and locks writes across instances', async () => {
 const dir = await mkdtemp(path.join(os.tmpdir(), 'dsh-checkpoint-'));
 try {
  const a = new Checkpoint(path.join(dir, 'task.json'));
  const b = new Checkpoint(path.join(dir, 'task.json'));
  await a.begin({workspace:dir, taskId:'toy'});
  await assert.rejects(b.begin({workspace:dir, taskId:'other'}), /existing/);
  const results = await Promise.allSettled([a.prepare(init), b.prepare(init)]);
  assert.equal(results.filter(x => x.status === 'fulfilled').length, 1);
 } finally { await rm(dir, {recursive:true, force:true}); }
});
