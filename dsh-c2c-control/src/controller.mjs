import path from 'node:path';
import { realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Checkpoint } from './checkpoint.mjs';
import { matchReply } from './protocol.mjs';

/** One consented task per controller, with no execution capability in remote advice. */
export class Controller {
 constructor({ stateDir, browser }) { this.stateDir = stateDir; this.browser = browser; this.checkpoint = null; }
 async begin({ workspace, taskId }, signal) {
  signal?.throwIfAborted();
  const root = await realpath(workspace);
  const key = createHash('sha256').update(root + '\0' + taskId).digest('hex');
  const next = new Checkpoint(path.join(this.stateDir, key + '.json'));
  if (this.checkpoint && this.checkpoint.file !== next.file) throw new Error('Controller already bound to a task; restart plugin for a new task');
  const state = await next.begin({ workspace: root, taskId });
  this.checkpoint = next;
  return state;
 }
 needTask() { if (!this.checkpoint) throw new Error('Begin task first'); }
 async send(text, signal) {
  this.needTask(); signal?.throwIfAborted();
  const before = await this.browser.inspect(signal);
  const previous = await this.checkpoint.read();
  if (before.url === 'https://chatgpt.com/' && !previous.chatUrl && !previous.pending) {
   if (before.messages.length) throw new Error('Fresh chat must be empty');
  } else await this.checkpoint.bindChat(before.url);
  const rollback = await this.checkpoint.read();
  await this.checkpoint.prepare(text); // Durable intent BEFORE any potentially submitting action.
  try { await this.browser.send(text, signal); }
  catch (error) {
   if (error.submission === 'not-submitted') await this.checkpoint.rollbackUnsubmitted(text, rollback);
   throw error;
  }
  const state = await this.browser.inspect(signal);
  if (state.messages.some(message => message.role === 'user' && message.text.trim() === text.trim())) {
   await this.checkpoint.bindChat(state.url);
   await this.checkpoint.confirmSent(text);
  }
  return { delivery: (await this.checkpoint.read()).delivery };
 }
 async readReply(signal) {
  this.needTask(); signal?.throwIfAborted();
  let checkpoint = await this.checkpoint.read();
  if (checkpoint.delivery === 'received') return { status: 'received', reply: checkpoint.reply };
  if (!checkpoint.pending) return { status: 'idle' };
  const observed = await this.browser.inspect(signal);
  const index = observed.messages.findLastIndex(message => message.role === 'user' && message.text.trim() === checkpoint.pending.text);
  if (!checkpoint.chatUrl && index >= 0) {
   checkpoint = await this.checkpoint.bindChat(observed.url);
  }
  if (checkpoint.chatUrl && observed.url !== checkpoint.chatUrl) return { status: 'paused', reason: 'Wrong conversation; reopen saved chatUrl before resuming.' };
  if (index < 0) return { status: 'paused', reason: 'Send outcome unresolved; inspect original chat. Never blindly resubmit.' };
  if (checkpoint.delivery === 'uncertain') checkpoint = await this.checkpoint.confirmSent(checkpoint.pending.text);
  if (observed.generating) return { status: 'waiting' };
  // Require the last subsequent message to be an assistant reply, not a stale earlier PLAN.
  const later = observed.messages.slice(index + 1);
  const latest = later.at(-1);
  if (!latest || latest.role !== 'assistant') return { status: 'waiting' };
  const reply = matchReply(latest.text.trim(), checkpoint.pending);
  if (!reply) return { status: 'paused', reason: 'Assistant reply missing valid matching C2C state; review chat without sending data.' };
  await this.checkpoint.accept(reply.text);
  return { status: 'received', reply };
 }
 async status(signal) {
  signal?.throwIfAborted();
  return { browser: this.browser.status(), checkpoint: this.checkpoint ? await this.checkpoint.read() : null };
 }
 async close() { await this.browser.close(); }
}
