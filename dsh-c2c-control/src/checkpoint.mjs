import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { parseMessage, matchReply } from './protocol.mjs';

/** File-backed single-writer checkpoint. A stale lock fails closed, never re-sends. */
export class Checkpoint {
 constructor(file) { this.file = file; }
 async read() {
  try { return JSON.parse(await readFile(this.file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
 }
 async change(update) {
  await mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
  const lock = await open(this.file + '.lock', 'wx', 0o600);
  const temp = this.file + '.' + randomUUID() + '.tmp';
  try {
   const next = update(await this.read());
   const handle = await open(temp, 'wx', 0o600);
   try { await handle.writeFile(JSON.stringify(next) + '\n'); await handle.sync(); }
   finally { await handle.close(); }
   await rename(temp, this.file);
   const directory = await open(path.dirname(this.file), 'r');
   try { await directory.sync(); } finally { await directory.close(); }
   return next;
  } finally {
   await unlink(temp).catch(error => { if (error.code !== 'ENOENT') throw error; });
   await lock.close();
   await unlink(this.file + '.lock');
  }
 }
 async begin({ workspace, taskId }) {
  if (!path.isAbsolute(workspace) || !/^[A-Za-z0-9_-]{1,80}$/.test(taskId)) throw new Error('Invalid workspace/task');
  return this.change(current => {
   if (current) {
    if (current.workspace !== workspace || current.taskId !== taskId) throw new Error('Conflicting existing task');
    return current;
   }
   return { version: 1, workspace, taskId, delivery: 'idle', pending: null, reply: null };
  });
 }
 async bindChat(url) {
  const parsed = new URL(url);
  if (parsed.origin !== 'https://chatgpt.com' || !/^\/c\/[A-Za-z0-9_-]+$/.test(parsed.pathname) || parsed.search || parsed.hash) throw new Error('Use a stable ChatGPT conversation URL');
  return this.change(current => {
   if (!current) throw new Error('Begin task first');
   if (current.chatUrl && current.chatUrl !== url) throw new Error('Task bound to another chat');
   return { ...current, chatUrl: url };
  });
 }
 async prepare(text) {
  const message = parseMessage(text);
  return this.change(current => {
   if (!current || message.taskId !== current.taskId) throw new Error('Wrong task');
   if (current.delivery === 'uncertain') throw new Error('Previous send unresolved; inspect browser history');
   if (current.delivery === 'sent') throw new Error('Await matching reply before next send');
   if (!current.reply) {
    if (message.state !== 'INIT' || message.iteration !== 0) throw new Error('First send must be INIT iteration 0');
   } else if (current.reply.state !== 'PLAN' || message.state !== 'EXECUTED' || message.iteration !== current.reply.iteration) {
    throw new Error('Send must execute the current PLAN');
   }
   return { ...current, pending: message, reply: null, delivery: 'uncertain' };
  });
 }
 async rollbackUnsubmitted(text, previous) {
  return this.change(current => {
   if (current?.delivery !== 'uncertain' || current.pending?.text !== text || previous.taskId !== current.taskId) throw new Error('Cannot roll back ambiguous checkpoint');
   return previous;
  });
 }
 async confirmSent(observedText) {
  return this.change(current => {
   if (!current?.pending || observedText !== current.pending.text) throw new Error('Need exact observed user message');
   return { ...current, delivery: 'sent' };
  });
 }
 async accept(text) {
  return this.change(current => {
   const reply = current?.pending && current.delivery === 'sent' && matchReply(text, current.pending);
   if (!reply) throw new Error('No matching reply');
   return { ...current, reply, delivery: 'received' };
  });
 }
}
