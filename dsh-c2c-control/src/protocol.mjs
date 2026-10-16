/** Strict bounded C2C control messages, independent of browser transport. */
const states = new Set(['INIT', 'PLAN', 'EXECUTING', 'EXECUTED', 'REVIEW', 'DONE', 'BLOCKED', 'ERROR', 'HANDOFF']);
export function parseMessage(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text) >= 1024) throw new Error('C2C message must be below 1024 bytes');
  const normalized = text.replace(/\r\n/g, '\n').trim();
  const lines = normalized.split('\n');
  if (lines[0] !== '[C2C]') throw new Error('Missing C2C marker');
  if (!/^STATE: [A-Z]+$/.test(lines[1] ?? '') || !/^TASK_ID: [A-Za-z0-9_-]{1,80}$/.test(lines[2] ?? '') || !/^ITERATION: (0|[1-9][0-9]*)$/.test(lines[3] ?? '')) throw new Error('Invalid C2C headers');
  const state = lines[1].slice(7), taskId = lines[2].slice(9), iteration = Number(lines[3].slice(11));
  if (!states.has(state) || !Number.isSafeInteger(iteration)) throw new Error('Invalid C2C state/iteration');
  if (lines.slice(4).some(line => /^(STATE|TASK_ID|ITERATION):/.test(line))) throw new Error('Duplicate C2C headers');
  if (lines.length > 4 && lines[4] !== '') throw new Error('Body must follow blank line');
  return { state, taskId, iteration, body: lines.slice(5).join('\n'), text: normalized };
}
export function makeMessage({ state, taskId, iteration, body = '' }) {
  const text = `[C2C]\nSTATE: ${state}\nTASK_ID: ${taskId}\nITERATION: ${iteration}\n\n${body}`;
  return parseMessage(text).text;
}
export function matchReply(text, pending) {
  let reply;
  try { reply = parseMessage(text); } catch { return null; }
  if (reply.taskId !== pending.taskId) return null;
  if (['BLOCKED', 'ERROR'].includes(reply.state) && reply.iteration === pending.iteration) return reply;
  if (pending.state === 'INIT' && reply.state === 'PLAN' && reply.iteration === pending.iteration + 1) return reply;
  if (pending.state === 'EXECUTED') {
    if (reply.state === 'PLAN' && reply.iteration === pending.iteration + 1) return reply;
    if (reply.state === 'DONE' && reply.iteration === pending.iteration) return reply;
  }
  return null;
}
