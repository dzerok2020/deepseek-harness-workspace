import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classify, probe, scan } from "../clean-sessions.mjs";

const HOUR = 60 * 60 * 1000;
const base = { records: 1, realRecords: 0, mtimeMs: 0, nowMs: 10 * HOUR };

test("classify: có record thật là live", () => {
  assert.equal(classify({ ...base, realRecords: 3 }), "live");
});

test("classify: chỉ record khung là empty", () => {
  assert.equal(classify({ ...base, records: 4 }), "empty");
});

test("classify: không record nào là broken", () => {
  assert.equal(classify({ ...base, records: 0 }), "broken");
});

test("classify: vừa tạo trong 1 giờ là active-now", () => {
  assert.equal(classify({ ...base, mtimeMs: 10 * HOUR - 1000 }), "active-now");
});

test("probe: phân biệt session có user/message với session chỉ có khung", async () => {
  const root = mkdtempSync(join(tmpdir(), "dsh-sess-"));
  try {
    const liveRaw = join(root, "live.jsonl");
    const emptyRaw = join(root, "empty.jsonl");
    writeFileSync(liveRaw, '{"type":"session/created"}\n{"type":"user/message"}\n');
    writeFileSync(emptyRaw, '{"type":"session/created"}\n{"type":"permission/preset"}\n');
    const live = join(root, "live.zst");
    const empty = join(root, "empty.zst");
    execFileSync("zstd", ["-q", "-f", liveRaw, "-o", live]);
    execFileSync("zstd", ["-q", "-f", emptyRaw, "-o", empty]);
    assert.equal((await probe(live)).realRecords, 1);
    assert.equal((await probe(empty)).realRecords, 0);
    assert.equal((await probe(empty)).records, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("scan: chỉ đánh dấu empty cho session không có nội dung", async () => {
  const root = mkdtempSync(join(tmpdir(), "dsh-sess-"));
  try {
    const ws = join(root, "ws");
    const liveDir = join(ws, "a-live");
    const emptyDir = join(ws, "b-empty");
    mkdirSync(liveDir, { recursive: true });
    mkdirSync(emptyDir, { recursive: true });
    const liveRaw = join(root, "l.jsonl");
    const emptyRaw = join(root, "e.jsonl");
    writeFileSync(liveRaw, '{"type":"session/created"}\n{"type":"tool/call"}\n');
    writeFileSync(emptyRaw, '{"type":"session/created"}\n');
    execFileSync("zstd", ["-q", "-f", liveRaw, "-o", join(liveDir, "session.v4.jsonl.zstd")]);
    execFileSync("zstd", ["-q", "-f", emptyRaw, "-o", join(emptyDir, "session.v4.jsonl.zstd")]);
    const rows = await scan(root, Date.now() + 2 * HOUR);
    const byName = Object.fromEntries(rows.map((r) => [r.name, r.kind]));
    assert.equal(byName["a-live"], "live");
    assert.equal(byName["b-empty"], "empty");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});