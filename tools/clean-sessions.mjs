#!/usr/bin/env node
// Dọn session rỗng trong ~/.dsh/sessions.
// Rỗng = file chỉ có record khung (session/created, permission/preset, sandbox/mode…),
// KHÔNG có user/message, assistant/message, tool/call hay request/header.
// Mặc định chỉ LIỆT KÊ. Muốn xoá thật: --apply --yes
import { spawn } from "node:child_process";
import { readdirSync, statSync, rmSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

const REAL_RECORDS = new Set(["user/message", "assistant/message", "tool/call", "tool/result", "request/header", "llm/retry"]);
const MIN_AGE_MS = 60 * 60 * 1000; // bỏ qua session vừa tạo trong 1 giờ

export function classify({ records, realRecords, mtimeMs, nowMs }) {
  if (mtimeMs > nowMs - MIN_AGE_MS) return "active-now";
  if (realRecords > 0) return "live";
  return records > 0 ? "empty" : "broken";
}

// Đọc stream zstd, dừng ngay khi gặp record thật (session thật thường thấy trong vài chục KB đầu).
export function probe(file, { maxRecords = 5000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn("zstd", ["-dc", file], { stdio: ["ignore", "pipe", "ignore"] });
    const rl = createInterface({ input: child.stdout, crlfDelay: Infinity });
    let records = 0;
    let realRecords = 0;
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      rl.close();
      child.kill("SIGKILL");
      resolve(value);
    };
    rl.on("line", (line) => {
      if (!line.trim()) return;
      records++;
      try {
        const rec = JSON.parse(line);
        if (REAL_RECORDS.has(rec?.type)) realRecords++;
      } catch {
        // dòng hỏng: coi như có nội dung, không xoá
        realRecords++;
      }
      if (realRecords > 0 || records >= maxRecords) finish({ records, realRecords });
    });
    rl.on("close", () => finish({ records, realRecords }));
    child.on("error", () => finish({ records: -1, realRecords: -1 }));
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
      const { records, realRecords } = await probe(file);
      const kind = classify({ records, realRecords, mtimeMs: st.mtimeMs, nowMs });
      rows.push({ workspace: ws, name, dir, size: st.size, mtimeMs: st.mtimeMs, records, realRecords, kind });
    }
  }
  return rows;
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const apply = args.has("--apply");
  const yes = args.has("--yes");
  const rows = await scan();
  const empty = rows.filter((r) => r.kind === "empty");
  const bytes = empty.reduce((n, r) => n + r.size, 0);
  const mb = (bytes / 1024 / 1024).toFixed(1);

  console.log(`Tổng session có file: ${rows.length}`);
  for (const kind of ["live", "active-now", "empty", "broken"]) {
    console.log(`  ${kind}: ${rows.filter((r) => r.kind === kind).length}`);
  }
  console.log(`  RỖNG chiếm: ${mb} MB`);
  const oldest = [...empty].sort((a, b) => a.mtimeMs - b.mtimeMs).slice(0, 8);
  for (const r of oldest) {
    console.log(`   - ${r.name}  ${r.records} record  ${(r.size / 1024).toFixed(1)} KB  ${new Date(r.mtimeMs).toISOString().slice(0, 10)}`);
  }
  if (!apply) {
    console.log("\nChưa xoá gì. Chạy lại với  --apply --yes  để xoá đúng các session RỖNG ở trên.");
    return;
  }
  if (!yes) {
    console.error("\nTừ chối xoá: cần thêm --yes.");
    process.exit(2);
  }
  let n = 0;
  let freed = 0;
  for (const r of empty) {
    const files = readdirSync(r.dir);
    if (files.length !== 1 || files[0] !== "session.v4.jsonl.zstd") {
      console.warn(`bỏ qua (có file lạ): ${r.name}`);
      continue;
    }
    // chốt lần cuối ngay trước khi xoá: record thật xuất hiện thì thôi
    const again = await probe(join(r.dir, "session.v4.jsonl.zstd"));
    if (again.realRecords > 0) {
      console.warn(`bỏ qua (vừa có nội dung): ${r.name}`);
      continue;
    }
    rmSync(r.dir, { recursive: true, force: true });
    n++;
    freed += r.size;
  }
  console.log(`\nĐã xoá ${n} session rỗng, giải phóng ${(freed / 1024 / 1024).toFixed(1)} MB.`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();