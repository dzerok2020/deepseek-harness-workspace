#!/usr/bin/env node
/**
 * measure-session-tokens.mjs — ước lượng token nội dung của một phiên DeepSeek Harness.
 * Không phải provider usage/billing; không tính prompt lặp lại, schema, ảnh hay cache.
 *
 * Trả lời câu hỏi: "token bị đốt ở đâu?" bằng số liệu thay vì cảm giác.
 * Đọc file phiên (session.v4.jsonl.zstd), thống kê:
 *   - token phía user (prompt thật) vs token tool output vs token assistant
 *   - bảng token theo từng tool
 *   - số tool call và token assistant theo từng turn
 *
 * Dùng:
 *   node tools/measure-session-tokens.mjs                      # phiên mới nhất toàn bộ
 *   node tools/measure-session-tokens.mjs --cwd app-reup       # lọc theo cwd
 *   node tools/measure-session-tokens.mjs --session 91ec7997   # lọc theo id phiên
 *   node tools/measure-session-tokens.mjs --all                # liệt kê mọi phiên
 */

import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createGunzip } from 'node:zlib';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

const SESSIONS_ROOT = join(homedir(), '.dsh', 'sessions');

/** Đếm token xấp xỉ: ~4 ký tự/token cho văn bản, khớp cách ước lượng của DSH. */
function estTokens(text) {
  if (!text) return 0;
  return Math.ceil(String(text).length / 4);
}

/** Mở stream JSONL đã giải nén (zstd hoặc gzip), trả về readline interface. */
async function openJsonl(file) {
  const ext = file.endsWith('.zstd') ? 'zstd' : 'gzip';
  let stream;
  if (ext === 'zstd') {
    const child = spawn('zstd', ['-dc', file], { stdio: ['ignore', 'pipe', 'ignore'] });
    stream = child.stdout;
  } else {
    stream = createReadStream(file).pipe(createGunzip());
  }
  return createInterface({ input: stream, crlfDelay: Infinity });
}

/** Tìm mọi file phiên dưới ~/.dsh/sessions/<workspace>/<sessionId>/session.v4.jsonl.zstd */
async function findSessions() {
  const out = [];
  const workspaces = await readdir(SESSIONS_ROOT, { withFileTypes: true }).catch(() => []);
  for (const ws of workspaces) {
    if (!ws.isDirectory()) continue;
    const wsPath = join(SESSIONS_ROOT, ws.name);
    const ids = await readdir(wsPath, { withFileTypes: true }).catch(() => []);
    for (const id of ids) {
      if (!id.isDirectory()) continue;
      const file = join(wsPath, id.name, 'session.v4.jsonl.zstd');
      const s = await stat(file).catch(() => null);
      if (!s) continue;
      out.push({ workspace: ws.name, sessionId: id.name, file, mtime: s.mtimeMs, size: s.size });
    }
  }
  return out.sort((a, b) => b.mtime - a.mtime);
}

/**
 * Phân tích một file phiên.
 * Cấu trúc dòng JSONL đã xác minh trên phiên thật:
 *   - tool result: { data: { message: { role: 'tool', tool_call_id, content } } }
 *   - tool call:   { data: { message: { role: 'assistant', tool_calls: [...] } } }
 *   - user:        { data: { message: { role: 'user', content } } }
 * Tool result KHÔNG có field `name`; phải tra ngược qua tool_calls bằng tool_call_id.
 */
async function analyzeSession(file) {
  const rl = await openJsonl(file);
  const callIdToTool = new Map();
  const byTool = new Map(); // tool -> { calls, outTokens }
  const turnToolCalls = new Map();
  const turnAssistantTokens = new Map();
  let lineCount = 0;
  let turn = 0;
  let userMsgs = 0;
  let userChars = 0;
  let assistantTokens = 0;
  let assistantMsgs = 0;
  let toolMsgs = 0;
  let toolChars = 0;
  let toolTokens = 0;

  const bump = (map, key, field, n) => {
    const cur = map.get(key) ?? { calls: 0, outTokens: 0 };
    cur[field] = (cur[field] ?? 0) + n;
    map.set(key, cur);
  };

  for await (const line of rl) {
    if (!line.trim()) continue;
    lineCount++;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const msg = entry?.data?.message;
    if (!msg) continue;

    // Đếm turn: mỗi message role=user không phải tool-result mở turn mới.
    if (msg.role === 'user' && !msg.tool_call_id) {
      turn++;
      userMsgs++;
      userChars += typeof msg.content === 'string' ? msg.content.length : JSON.stringify(msg.content ?? '').length;
      continue;
    }

    if (msg.role === 'tool') {
      const tool = callIdToTool.get(msg.tool_call_id) ?? 'unknown';
      const chars = typeof msg.content === 'string' ? msg.content.length : JSON.stringify(msg.content ?? '').length;
      toolMsgs++;
      toolChars += chars;
      bump(byTool, tool, 'calls', 0);
      const tokens = Math.ceil(chars / 4); // chars is a count, not text to tokenize again.
      toolTokens += tokens;
      bump(byTool, tool, 'outTokens', tokens);
      continue;
    }

    if (msg.role === 'assistant') {
      const text = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content ?? '');
      const t = estTokens(text);
      assistantMsgs++;
      assistantTokens += t;
      if (turn) bump(turnAssistantTokens, turn, 'calls', 0), bump(turnAssistantTokens, turn, 'outTokens', t);

      for (const call of msg.tool_calls ?? []) {
        const name = call?.function?.name ?? call?.name ?? 'unknown';
        const id = call?.id;
        if (id) callIdToTool.set(id, name);
        bump(byTool, name, 'calls', 1);
        if (!byTool.get(name).outTokens) bump(byTool, name, 'outTokens', 0);
        if (turn) {
          const cur = turnToolCalls.get(turn) ?? 0;
          turnToolCalls.set(turn, cur + 1);
        }
      }
    }
  }

  return {
    lineCount,
    turns: turn,
    userMsgs,
    userChars,
    userTokens: Math.ceil(userChars / 4),
    assistantMsgs,
    assistantTokens,
    toolMsgs,
    toolChars,
    toolTokens, // Sum per-message estimates, so the per-tool table reconciles exactly.
    byTool: [...byTool.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.outTokens - a.outTokens),
    turnToolCalls: [...turnToolCalls.entries()].sort((a, b) => a[0] - b[0]),
    turnAssistantTokens: [...turnAssistantTokens.entries()].map(([turn, value]) => [turn, value.outTokens]).sort((a, b) => a[0] - b[0]),
  };
}

function printReport(meta, r) {
  const fmt = (n) => n.toLocaleString('en-US');
  const total = r.userTokens + r.assistantTokens + r.toolTokens;
  const pct = (n) => (total ? ((n / total) * 100).toFixed(1) + '%' : '0%');

  console.log(`\n=== ${meta.sessionId} ===`);
  console.log(`  workspace : ${meta.workspace}`);
  console.log(`  dòng JSONL: ${fmt(r.lineCount)}   turn: ${r.turns}   file: ${(meta.size / 1024).toFixed(0)} KB`);
  console.log('\n-- TỔNG QUAN: ƯỚC LƯỢNG NỘI DUNG (~4 ký tự/token), KHÔNG PHẢI BILLING --');
  console.log(`  user prompt   : ${fmt(r.userMsgs).padStart(5)} msg  ${String(r.userChars).padStart(7)} ký tự  ~${fmt(r.userTokens).padStart(7)} tok  ${pct(r.userTokens)}`);
  console.log(`  tool output   : ${fmt(r.toolMsgs).padStart(5)} msg  ${String(r.toolChars).padStart(7)} ký tự  ~${fmt(r.toolTokens).padStart(7)} tok  ${pct(r.toolTokens)}`);
  console.log(`  assistant     : ${fmt(r.assistantMsgs).padStart(5)} msg  ${''.padStart(7)}          ~${fmt(r.assistantTokens).padStart(7)} tok  ${pct(r.assistantTokens)}`);
  console.log(`  TỔNG (nội dung) ~${fmt(total)} tok`);

  console.log('\n-- TOKEN THEO TOOL --');
  for (const t of r.byTool) {
    const share = r.toolTokens ? ((t.outTokens / r.toolTokens) * 100).toFixed(1) + '%' : '-';
    console.log(`  ${t.name.padEnd(28)} call=${String(t.calls).padStart(4)}  out=~${fmt(t.outTokens).padStart(7)} tok  ${share.padStart(6)}`);
  }

  console.log('\n-- TOOL CALL THEO TURN --');
  for (const [t, n] of r.turnToolCalls) {
    const at = r.turnAssistantTokens.find(([k]) => k === t)?.[1] ?? 0;
    console.log(`  turn ${String(t).padStart(2)} : ${String(n).padStart(3)} tool call   assistant ~${fmt(at)} tok`);
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const arg = (flag) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };

  const all = await findSessions();
  if (!all.length) {
    console.error(`Không tìm thấy phiên nào dưới ${SESSIONS_ROOT}`);
    process.exit(1);
  }

  if (argv.includes('--all')) {
    console.log(`Tổng ${all.length} phiên:`);
    for (const s of all.slice(0, 50)) {
      console.log(`  ${s.sessionId}  ${(s.size / 1024).toFixed(0).padStart(7)} KB  ${new Date(s.mtime).toISOString()}  ${s.workspace}`);
    }
    return;
  }

  const cwdFilter = arg('--cwd');
  const sessionFilter = arg('--session');

  let targets;
  if (sessionFilter) {
    targets = all.filter((s) => s.sessionId.includes(sessionFilter));
  } else if (cwdFilter) {
    targets = all.filter((s) => s.workspace.includes(cwdFilter));
  } else {
    targets = [all[0]];
  }

  if (!targets.length) {
    console.error('Không có phiên khớp bộ lọc.');
    process.exit(1);
  }

  for (const meta of targets) {
    const r = await analyzeSession(meta.file);
    printReport(meta, r);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});