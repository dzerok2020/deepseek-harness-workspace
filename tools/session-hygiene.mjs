#!/usr/bin/env node
// Kỷ luật session: 1 việc / 1 session; archive khi > N lượt.
// Đọc ~/.dsh/sessions, đếm lượt NGƯỜI DÙNG thật (user/message source.kind === 'user').
// Mặc định chỉ báo cáo. Archive = move thư mục session sang ~/.dsh/sessions-archive.
import { spawn } from "node:child_process";
import { readdirSync, statSync, renameSync, mkdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, basename } from "node:path";
import { createInterface } from "node:readline";

const DEFAULT_TURNS = 50;
const MIN_AGE_MS = 24 * 60 * 60 * 1000; // không archive session vừa dùng trong 24h

export function countTurns(file, { maxRecords = 100000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn("zstd", ["-dc", file], { stdio: ["ignore", "pipe", "ignore"] });
    const rl = createInterface({ input: child.stdout, crlfDelay: Infinity });
    let turns = 0;
    let records = 0;
    let textBytes = 0;
    const done = () => {
      rl.close();
      child.kill("SIGKILL");
      resolve({ turns, records, textBytes });
    };
    rl.on("line", (line) => {
      if (!line.trim()) return;
      records++;
      if (records > maxRecords) return done();
      if (!line.includes('"user/message"')) return;
      try {
        const rec = JSON.parse(line);
        if (rec.type !== "user/message") return;
        const kind = rec.data?.source?.kind;
        if (kind === "user") turns++;
        textBytes += Buffer.byteLength(JSON.stringify(rec.data ?? {}));
      } catch {
        // dòng hỏng: bỏ qua, không đoán
      }
    });
    rl.on("close", done);
    child.on("error", () => {
      rl.close();
      resolve({ turns: -1, records: -1, textBytes: 0 });
    });
  });
}

export async function scan(root = join(homedir(), ".dsh", "sessions"), nowMs = Date.now()) {
  const rows = [];
  if (!existsSync(root)) return rows;
  for (const ws of readdirSync(root)) {
    const wsDir = join(root, ws);
    let entries;
    try { entries = readdirSync(wsDir); } catch { continue; }
    for (const name of entries) {
      const dir = join(wsDir, name);
      const file = join(dir, "session.v4.jsonl.zstd");
      if (!existsSync(file)) continue;
      const st = statSync(file);
      const { turns, records, textBytes } = await countTurns(file);
      rows.push({ workspace: ws, name, dir, size: st.size, mtimeMs: st.mtimeMs, turns, records, textBytes });
    }
  }
  return rows;
}

export function isArchivable(row, { turns = DEFAULT_TURNS, maxBytes = 6.5 * 1024 * 1024, nowMs = Date.now(), maxAgeMs = MIN_AGE_MS } = {}) {
  if (row.turns <= turns && (row.size ?? 0) <= maxBytes) return false;
  if (row.mtimeMs > nowMs - maxAgeMs) return false;
  return true;
}

export function archive(row, archiveRoot = join(homedir(), ".dsh", "sessions-archive")) {
  const destDir = join(archiveRoot, row.workspace);
  mkdirSync(destDir, { recursive: true });
  const dest = join(destDir, basename(row.dir));
  if (existsSync(dest)) throw new Error(`đã tồn tại: ${dest}`);
  renameSync(row.dir, dest);
  return dest;
}

async function main() {
  const argv = process.argv.slice(2);
  const flag = (name) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const turns = Number(flag("--turns") ?? DEFAULT_TURNS);
  const sizeMb = Number(flag("--size-mb") ?? 6.5);
  const maxBytes = sizeMb * 1024 * 1024;
  const apply = argv.includes("--archive");
  const rows = await scan();
  const nowMs = Date.now();
  const hot = rows
    .filter((r) => r.turns > turns || r.size > maxBytes)
    .sort((a, b) => b.size - a.size);
  const maxTurns = rows.reduce((m, r) => Math.max(m, r.turns), 0);
  const maxSize = rows.reduce((m, r) => Math.max(m, r.size), 0);

  console.log(`Tổng session: ${rows.length}`);
  console.log(`Lượt người dùng cao nhất trong 1 session: ${maxTurns}`);
  console.log(`Session lớn nhất: ${(maxSize / 1024 / 1024).toFixed(2)} MB`);
  console.log(`Session > ${turns} lượt hoặc > ${sizeMb} MB: ${hot.length}`);
  for (const r of hot.slice(0, 12)) {
    const days = ((nowMs - r.mtimeMs) / 86400000).toFixed(0);
    console.log(`  ${r.name}  ${r.turns} lượt  ${r.records} record  ${(r.size / 1024 / 1024).toFixed(2)} MB  ${days} ngày trước`);
  }
  const archivable = hot.filter((r) => isArchivable(r, { turns, maxBytes, nowMs }));
  console.log(`  trong đó đủ điều kiện archive (idle > 24h): ${archivable.length}`);

  if (!apply) {
    console.log("\nChưa move gì. Chạy lại với  --archive  để move các session đủ điều kiện sang ~/.dsh/sessions-archive.");
    return;
  }
  let moved = 0;
  for (const r of archivable) {
    const dest = archive(r);
    moved++;
    console.log(`  → ${dest}`);
  }
  console.log(`\nĐã archive ${moved} session. DSH sẽ không resume được các session này nữa.`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();