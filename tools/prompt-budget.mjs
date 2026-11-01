#!/usr/bin/env node
// Đo "ngân sách prompt" của DSH: phần cố định phải trả trong MỌI request
// (tool schema + catalog skill) và thành phần token của session gần nhất.
// CHỈ ĐỌC. Dùng: node tools/prompt-budget.mjs [--check] [--json]
//
// --check : exit 1 khi vượt ngưỡng (dùng cho tools/dsh-health.sh).
// Ngưỡng đặt theo mức đo thật 2026-10-28: 128 tool ≈ 142 KB (~35,6K token).
// Catalog skill đo theo MỌI root mà DSH thật sự nạp (project → plugin → user), không chỉ
// ~/.dsh/skills: đo cũ chỉ thấy 82 skill / 26,7K ký tự trong khi catalog thật 428 skill /
// ~132K ký tự, nên ngưỡng cũ 30K không bao giờ bắt được catalog phình (sửa 2026-11-01).

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const HOME = os.homedir();
const DSH = path.join(HOME, '.dsh');
const LIMITS = {
  toolsBytes: 150_000,
  toolsCount: 120,
  // Trần thật của catalog 2026-11-01: 428 skill ≈ 132K ký tự (ECC đóng góp 311 skill).
  // 150K là mức trần có headroom; 100K là mốc nên rà lại vì đã tốn ~25K token/request.
  skillChars: 150_000,
  skillCharsWarn: 100_000,
  minHitRate: 75,
};

function listSessions() {
  const root = path.join(DSH, 'sessions');
  const out = [];
  if (!fs.existsSync(root)) return out;
  for (const proj of fs.readdirSync(root)) {
    const pd = path.join(root, proj);
    if (!fs.statSync(pd).isDirectory()) continue;
    for (const s of fs.readdirSync(pd)) {
      const f = path.join(pd, s, 'session.v4.jsonl.zstd');
      if (fs.existsSync(f)) out.push({ file: f, mtime: fs.statSync(f).mtimeMs });
    }
  }
  return out.sort((a, b) => b.mtime - a.mtime);
}

function readJsonlZstd(file) {
  let raw;
  try {
    raw = execFileSync('zstd', ['-dc', file], { maxBuffer: 512 * 1024 * 1024, encoding: 'utf8' });
  } catch {
    raw = execFileSync('zstdcat', [file], { maxBuffer: 512 * 1024 * 1024, encoding: 'utf8' });
  }
  const rows = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try { rows.push(JSON.parse(line)); } catch { /* bỏ dòng hỏng */ }
  }
  return rows;
}

function byteLen(v) { return Buffer.byteLength(JSON.stringify(v), 'utf8'); }

function toolBudget(rows) {
  let header = null;
  for (const r of rows) if (r.type === 'request/header') header = r.data?.header;
  if (!header?.tools) return null;
  const tools = header.tools.map((t) => ({ name: t.name, bytes: byteLen(t) }));
  const bytes = byteLen(header.tools);
  tools.sort((a, b) => b.bytes - a.bytes);
  return { count: tools.length, bytes, approxTokens: Math.round(bytes / 4), top: tools.slice(0, 5) };
}

// Bỏ khối "untrusted-memory" (nó chứa lại hội thoại cũ, kể cả câu ta từng
// trích dẫn) để không đếm nhầm nhắc 灵枢 do chính mình viết ra.
function stripUntrusted(text) {
  return text
    .replace(/<untrusted-memory>[\s\S]*?<\/untrusted-memory>/g, '')
    .replace(/以下由 untrusted-memory[\s\S]*?(?=\n\nCurrent |\n\n【|$)/g, '');
}

function classifyUser(text) {
  const t = text.trimStart();
  if (t.startsWith('Current runtime context.')) return 'snapshot';
  if (t.startsWith('<system-reminder>')) return 'workspace-reminder';
  if (t.startsWith('以下由 untrusted-memory') || t.startsWith('【本会话近期对话】')) return 'memory';
  if (/^【[^】]+】/.test(t)) return 'memory';
  return 'real-user';
}

function sessionComposition(rows) {
  const acc = { realUser: 0, snapshotUser: 0, workspaceReminder: 0, memory: 0, assistantText: 0, assistantReasoning: 0, toolResult: 0, toolResultMax: 0, steps: 0, reminders: 0, reminderMax: 0, injectedBytes: 0, reminderSeqs: [], lastTurnStart: 0, turnSteps: 0, turnSnapshots: 0 };
  for (const r of rows) {
    if (r.type === 'step/start') { acc.steps += 1; acc.turnSteps += 1; continue; }
    if (r.type === 'turn/start') { acc.lastTurnStart = r.seq ?? 0; acc.turnSteps = 0; acc.turnSnapshots = 0; continue; }
    if (r.type === 'user/message') {
      const text = (r.data?.content ?? []).filter((p) => p.type === 'text').map((p) => p.text).join('');
      const kind = classifyUser(text);
      acc.injectedBytes += Buffer.byteLength(text, 'utf8');
      if (kind === 'real-user') acc.realUser += 1;
      else if (kind === 'snapshot') {
        acc.snapshotUser += 1; acc.turnSnapshots += 1;
        const hit = stripUntrusted(text).match(/【灵枢·逢十轮提醒】\s*本会话已完成\s*(\d+)\s*轮/);
        if (hit) { acc.reminders += 1; acc.reminderSeqs.push(r.seq ?? 0); acc.reminderMax = Math.max(acc.reminderMax, Number(hit[1])); }
      } else if (kind === 'workspace-reminder') acc.workspaceReminder += 1;
      else acc.memory += 1;
      continue;
    }
    if (r.type === 'assistant/message') {
      for (const p of r.data?.message?.content ?? []) {
        const n = Buffer.byteLength(p?.text ?? '', 'utf8');
        if (p?.type === 'text') acc.assistantText += n;
        else if (p?.type === 'reasoning') acc.assistantReasoning += n;
      }
      continue;
    }
    if (r.type === 'tool/result') {
      const n = byteLen(r.data?.message ?? {});
      acc.toolResult += n;
      if (n > acc.toolResultMax) acc.toolResultMax = n;
      continue;
    }
    if (r.type === 'tool/call') acc.tools += 1;
  }
  return acc;
}

// DSH nạp skill từ nhiều root (xem @deepseek-ai/dsh-skill-filesystem roots()):
// project (.dsh/skills, .agents/skills) → custom dir do plugin đăng ký → user (~/.dsh/skills,
// ~/.agents/skills) → bundled. Skill trùng tên thì root xếp trước thắng, nên dedupe theo name.
const PROFILE = process.env.DSH_PROFILE ?? 'web';
const MAX_SKILL_DEPTH = 4;

function walkSkillFiles(dir, depth = 0, out = []) {
  if (depth > MAX_SKILL_DEPTH) return out;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walkSkillFiles(p, depth + 1, out);
    else if (entry.name === 'SKILL.md') out.push(p);
  }
  return out;
}

/** Các thư mục skill theo đúng thứ tự ưu tiên của DSH. */
function skillRoots() {
  const roots = [
    { dir: path.join(process.cwd(), '.dsh', 'skills'), source: 'project-dsh' },
    { dir: path.join(process.cwd(), '.agents', 'skills'), source: 'project-agents' },
    // custom dir: dsh-ecc-adapter đăng ký <eccRoot>/skills
    { dir: path.join(DSH, 'ecc', 'source', 'skills'), source: 'ecc' },
    { dir: path.join(DSH, 'skills'), source: 'user-dsh' },
    { dir: path.join(HOME, '.agents', 'skills'), source: 'user-agents' },
  ];
  // custom dir: plugin đóng gói skill trong <pkg>/skills
  const mods = path.join(DSH, 'profiles', PROFILE, 'node_modules');
  let pkgs = [];
  try {
    pkgs = fs.readdirSync(mods, { withFileTypes: true });
  } catch {
    pkgs = [];
  }
  for (const entry of pkgs) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const dir = path.join(mods, entry.name, 'skills');
    if (fs.existsSync(dir)) roots.push({ dir, source: `plugin:${entry.name}` });
  }
  for (const extra of (process.env.DSH_SKILL_EXTRA_ROOTS ?? '').split(path.delimiter)) {
    if (extra.trim()) roots.push({ dir: extra.trim(), source: 'env' });
  }
  return roots;
}

function skillMeta(file, fallbackName) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8').slice(0, 4096);
  } catch {
    return null;
  }
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const fm = m ? m[1] : '';
  const name = (fm.match(/^name:\s*(.+)$/m)?.[1] ?? fallbackName).trim();
  const desc = (fm.match(/^description:\s*"?([\s\S]*?)"?\s*$/m)?.[1] ?? '').trim();
  return { name, chars: name.length + desc.length };
}

function skillCatalog() {
  const seen = new Set();
  const perSource = [];
  let count = 0;
  let chars = 0;
  for (const root of skillRoots()) {
    const files = walkSkillFiles(root.dir);
    let added = 0;
    for (const file of files) {
      const meta = skillMeta(file, path.basename(path.dirname(file)));
      if (!meta || seen.has(meta.name)) continue;
      seen.add(meta.name);
      count += 1;
      chars += meta.chars;
      added += 1;
    }
    if (added) perSource.push({ source: root.source, count: added });
  }
  return { count, chars, sources: perSource };
}

function usageToday() {
  const f = path.join(DSH, 'storages', 'usage-stats-cache.json');
  if (!fs.existsSync(f)) return null;
  const data = JSON.parse(fs.readFileSync(f, 'utf8'));
  const day = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD theo giờ máy
  const agg = { fresh: 0, cacheRead: 0, output: 0, sessions: 0, visionFresh: 0 };
  for (const v of Object.values(data.sessions ?? {})) {
    const d = v?.days?.[day];
    if (!d) continue;
    agg.sessions += 1;
    agg.fresh += d.totals?.inputTokens ?? 0;
    agg.cacheRead += d.totals?.cacheReadTokens ?? 0;
    agg.output += d.totals?.outputTokens ?? 0;
    for (const [m, mm] of Object.entries(d.models ?? {})) {
      if (m.includes('vision')) agg.visionFresh += mm.inputTokens ?? 0;
    }
  }
  const total = agg.fresh + agg.cacheRead;
  agg.hitRate = total ? (agg.cacheRead / total) * 100 : 0;
  return agg;
}

function sessionRanking(days = 7) {
  const f = path.join(DSH, 'storages', 'usage-stats-cache.json');
  if (!fs.existsSync(f)) return [];
  const data = JSON.parse(fs.readFileSync(f, 'utf8'));
  const cut = Date.now() - days * 86_400_000;
  const rows = [];
  for (const [sid, v] of Object.entries(data.sessions ?? {})) {
    let fresh = 0, cacheRead = 0, output = 0, last = 0;
    const models = new Set();
    for (const [day, d] of Object.entries(v?.days ?? {})) {
      if (new Date(`${day}T23:59:59`).getTime() < cut) continue;
      fresh += d.totals?.inputTokens ?? 0;
      cacheRead += d.totals?.cacheReadTokens ?? 0;
      output += d.totals?.outputTokens ?? 0;
      for (const m of Object.keys(d.models ?? {})) models.add(m);
    }
    if (!fresh && !cacheRead) continue;
    const total = fresh + cacheRead;
    rows.push({ sid: sid.replace(/^session-/, ''), fresh, cacheRead, output, hit: total ? (cacheRead / total) * 100 : 0, models: models.size });
  }
  return rows.sort((a, b) => b.fresh - a.fresh).slice(0, 8);
}

if (process.argv.includes('--skills-only')) {
  const catalog = skillCatalog();
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(catalog, null, 2));
    process.exit(0);
  }
  console.log(`Skill catalog   : ${catalog.count} skill, ${catalog.chars.toLocaleString('vi-VN')} ký tự ≈ ${Math.round(catalog.chars / 4).toLocaleString('vi-VN')} token / request`);
  console.log('  theo nguồn    : ' + catalog.sources.map((s) => `${s.source} ${s.count}`).join(', '));
  process.exit(0);
}

const sessions = listSessions();
if (!sessions.length) {
  console.error('Không thấy session nào trong ~/.dsh/sessions');
  process.exit(2);
}
const latest = sessions[0];
const rows = readJsonlZstd(latest.file);
const tools = toolBudget(rows);
const comp = sessionComposition(rows);
const catalog = skillCatalog();
const usage = usageToday();
const kb = (n) => `${(n / 1024).toFixed(1)} KB`;

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ session: latest.file, tools, composition: comp, catalog, usage }, null, 2));
} else {
  console.log(`Session mới nhất : ${path.basename(path.dirname(latest.file))}`);
  if (tools) {
    console.log(`Tool schema     : ${tools.count} tool, ${kb(tools.bytes)} ≈ ${tools.approxTokens.toLocaleString('vi-VN')} token / request`);
    console.log('  nặng nhất     : ' + tools.top.map((t) => `${t.name} ${kb(t.bytes)}`).join(', '));
  }
  console.log(`Skill catalog   : ${catalog.count} skill, ${catalog.chars.toLocaleString('vi-VN')} ký tự ≈ ${Math.round(catalog.chars / 4).toLocaleString('vi-VN')} token / request`);
  console.log('  theo nguồn    : ' + catalog.sources.map((s) => `${s.source} ${s.count}`).join(', '));
  if (catalog.chars > LIMITS.skillCharsWarn) {
    console.log(`  \x1b[33mCẢNH BÁO\x1b[0m  catalog > ${LIMITS.skillCharsWarn.toLocaleString('vi-VN')} ký tự — nên cắt root skill không dùng`);
  }
  console.log(`Thành phần session: ${comp.steps} step · user thật ${comp.realUser} · snapshot runtime ${comp.snapshotUser} (lượt này ${comp.turnSnapshots}/${comp.turnSteps} step) · reminder 灵枢 ${comp.reminders} (số lớn nhất ${comp.reminderMax}) · AGENTS ${comp.workspaceReminder} · memory-block ${comp.memory}`);
  console.log(`  tool result ${kb(comp.toolResult)} (max ${kb(comp.toolResultMax)}) · text ${kb(comp.assistantText)} · reasoning ${kb(comp.assistantReasoning)} · block bơm vào ${kb(comp.injectedBytes)}`);
  if (usage) {
    console.log(`Hôm nay         : ${usage.sessions} session · fresh in ${(usage.fresh / 1e6).toFixed(2)}M · cacheRead ${(usage.cacheRead / 1e6).toFixed(2)}M · hit ${usage.hitRate.toFixed(1)}% · vision fresh ${(usage.visionFresh / 1e6).toFixed(2)}M`);
  }
}

if (process.argv.includes('--sessions')) {
  console.log('\nTop session đốt token 7 ngày (fresh input là phần KHÔNG cache):');
  for (const r of sessionRanking()) {
    console.log(`  ${r.sid.slice(0, 12)}  fresh ${(r.fresh / 1e6).toFixed(2)}M  cacheRead ${(r.cacheRead / 1e6).toFixed(2)}M  hit ${r.hit.toFixed(1)}%  out ${(r.output / 1e3).toFixed(0)}K  model ${r.models}`);
  }
}

if (process.argv.includes('--check')) {
  const problems = [];
  if (tools && tools.bytes > LIMITS.toolsBytes) problems.push(`tool schema ${kb(tools.bytes)} > ${kb(LIMITS.toolsBytes)}`);
  if (tools && tools.count > LIMITS.toolsCount) problems.push(`${tools.count} tool > trần ${LIMITS.toolsCount} — plugin mới đang phình schema`);
  if (catalog.chars > LIMITS.skillChars) problems.push(`catalog skill ${catalog.chars} ký tự > ${LIMITS.skillChars}`);
  if (usage && usage.hitRate < LIMITS.minHitRate) problems.push(`cache hit hôm nay ${usage.hitRate.toFixed(1)}% < ${LIMITS.minHitRate}%`);
  // Hồi quy P0: nhắc 灵枢 đếm theo step ⇒ snapshot đổi mỗi step ⇒ đốt token.
  const recentReminders = comp.reminderSeqs.filter((s) => s > comp.lastTurnStart).length;
  if (recentReminders > 0) problems.push(`lượt hiện tại có ${recentReminders} nhắc 灵枢 trong snapshot — patch đếm lượt của dsh-memory đã mất, xem vibe-analysis/2026-10-28-p0-fixes.md`);
  if (comp.turnSteps > 10 && comp.turnSnapshots > comp.turnSteps * 0.6) problems.push(`snapshot runtime lượt này ${comp.turnSnapshots}/${comp.turnSteps} step — runtime context đổi gần như mỗi step`);
  if (problems.length) {
    console.log('  \x1b[31mLỖI\x1b[0m  ' + problems.join(' · '));
    process.exit(1);
  }
  console.log('  \x1b[32mĐẠT\x1b[0m  prefix + cache hit trong ngưỡng');
}