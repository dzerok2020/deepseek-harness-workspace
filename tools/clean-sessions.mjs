#!/usr/bin/env node
// Dọn session rỗng trong ~/.dsh/sessions.
// Rỗng = file chỉ có record khung (session/created, permission/preset, sandbox/mode…),
// KHÔNG có user/message, assistant/message, tool/call hay request/header.
// Mặc định chỉ LIỆT KÊ. Muốn xoá thật: --apply --yes
import { spawn } from "node:child_process";
import { readdirSync, lstatSync, realpathSync, rmSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";

const REAL_RECORDS = new Set(["user/message", "assistant/message", "tool/call", "tool/result", "request/header", "llm/retry"]);
const MIN_AGE_MS = 60 * 60 * 1000; // bỏ qua session vừa tạo trong 1 giờ

export function classify({ records, realRecords, complete, mtimeMs, nowMs }) {
  if (mtimeMs > nowMs - MIN_AGE_MS) return "active-now";
  if (realRecords > 0) return "live";
  return complete === true && records > 0 ? "empty" : "broken";
}

// Đọc stream zstd, dừng ngay khi gặp record thật (session thật thường thấy trong vài chục KB đầu).
export function probe(file, { maxRecords = 5000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn("zstd", ["-dc", file], { stdio: ["ignore", "pipe", "ignore"] });
    const rl = createInterface({ input: child.stdout, crlfDelay: Infinity });
    let records = 0;
    let realRecords = 0;
    let done = false;
    let eof = false;
    child.stdout.on("end", () => { eof = true; });
    const finish = (value) => {
      if (done) return;
      done = true;
      rl.close();
      child.kill("SIGKILL");
      resolve(value);
    };
    rl.on("line", (line) => {
      if (done || !line.trim()) return;
      records++;
      try {
        const rec = JSON.parse(line);
        if (REAL_RECORDS.has(rec?.type)) realRecords++;
      } catch {
        // dòng hỏng: coi như có nội dung, không xoá
        realRecords++;
      }
      if (realRecords > 0 || records >= maxRecords) finish({ records, realRecords, complete: false });
    });
    rl.on("error", () => finish({ records, realRecords, complete: false }));
    child.on("close", (code, signal) => finish({ records, realRecords, complete: eof && code === 0 && signal === null }));
    child.on("error", () => finish({ records: -1, realRecords: -1, complete: false }));
  });
}

function inspectCandidate(root, dir) {
  try {
    const wsDir = dirname(dir);
    if (dirname(wsDir) !== root) return null;
    const paths = [wsDir, dir, join(dir, "session.v4.jsonl.zstd")];
    const stats = paths.map((path) => lstatSync(path));
    if (!stats[0].isDirectory() || !stats[1].isDirectory() || !stats[2].isFile()) return null;
    if (paths.some((path) => realpathSync(path) !== path)) return null;
    return { st: stats[2], identity: stats.map((st) => `${st.dev}:${st.ino}`).join("/") };
  } catch {
    return null;
  }
}

export async function scan(root = join(homedir(), ".dsh", "sessions"), nowMs = Date.now()) {
  const rows = [];
  if (!existsSync(root)) return rows;
  root = realpathSync(root);
  for (const ws of readdirSync(root)) {
    const wsDir = join(root, ws);
    let entries;
    try {
      if (!lstatSync(wsDir).isDirectory() || realpathSync(wsDir) !== wsDir) continue;
      entries = readdirSync(wsDir);
    } catch { continue; }
    for (const name of entries) {
      const dir = join(wsDir, name);
      const candidate = inspectCandidate(root, dir);
      if (!candidate) continue;
      const { st, identity } = candidate;
      const { records, realRecords, complete } = await probe(join(dir, "session.v4.jsonl.zstd"));
      const kind = classify({ records, realRecords, complete, mtimeMs: st.mtimeMs, nowMs });
      rows.push({ root, workspace: ws, name, dir, identity, size: st.size, mtimeMs: st.mtimeMs, records, realRecords, complete, kind });
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
    const before = inspectCandidate(r.root, r.dir);
    if (!before || before.identity !== r.identity) {
      console.warn(`bỏ qua (đường dẫn đã đổi/không an toàn): ${r.name}`);
      continue;
    }
    // Chỉ xoá khi lần đọc cuối vẫn xác nhận đầy đủ là rỗng và không vừa hoạt động.
    const again = await probe(join(r.dir, "session.v4.jsonl.zstd"));
    const after = inspectCandidate(r.root, r.dir);
    if (!after || after.identity !== r.identity || classify({ ...again, mtimeMs: after.st.mtimeMs, nowMs: Date.now() }) !== "empty") {
      console.warn(`bỏ qua (không xác nhận rỗng/đường dẫn đã đổi): ${r.name}`);
      continue;
    }
    const files = readdirSync(r.dir);
    if (files.length !== 1 || files[0] !== "session.v4.jsonl.zstd") {
      console.warn(`bỏ qua (có file lạ): ${r.name}`);
      continue;
    }
    rmSync(r.dir, { recursive: true, force: true });
    n++;
    freed += r.size;
  }
  console.log(`\nĐã xoá ${n} session rỗng, giải phóng ${(freed / 1024 / 1024).toFixed(1)} MB.`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();