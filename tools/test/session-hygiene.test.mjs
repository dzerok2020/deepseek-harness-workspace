import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { countTurns, scan, isArchivable, archive } from "../session-hygiene.mjs";

function writeSession(root, ws, id, lines) {
  const dir = join(root, ws, id);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "session.v4.jsonl.zstd");
  const zstd = execFileSync("zstd", ["-q", "-c"], { input: lines.join("\n") + "\n" });
  writeFileSync(file, zstd);
  return { dir, file };
}

const user = (kind) => JSON.stringify({ type: "user/message", data: { source: { kind }, content: "x" } });
const assistant = () => JSON.stringify({ type: "assistant/message", data: {} });

test("countTurns đếm user/message kind=user, bỏ snapshot runtime", async () => {
  const root = mkdtempSync(join(tmpdir(), "hyg-"));
  const { file } = writeSession(root, "ws", "s1", [
    user("user"), assistant(), user("runtime"), user("user"), assistant(),
  ]);
  const r = await countTurns(file);
  assert.equal(r.turns, 2);
  assert.equal(r.records, 5);
});

test("scan liệt kê session + kích thước", async () => {
  const root = mkdtempSync(join(tmpdir(), "hyg-"));
  writeSession(root, "ws", "s1", [user("user")]);
  const rows = await scan(root);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, "s1");
  assert.ok(rows[0].size > 0);
});

test("isArchivable: chỉ >50 lượt và idle >24h", () => {
  const old = { turns: 60, mtimeMs: Date.now() - 48 * 3600 * 1000 };
  const fresh = { turns: 60, mtimeMs: Date.now() };
  const small = { turns: 50, mtimeMs: Date.now() - 48 * 3600 * 1000 };
  assert.equal(isArchivable(old), true);
  assert.equal(isArchivable(fresh), false);
  assert.equal(isArchivable(small), false);
});

test("archive move thư mục, không copy", () => {
  const root = mkdtempSync(join(tmpdir(), "hyg-"));
  const { dir } = writeSession(root, "ws", "s9", [user("user")]);
  const out = mkdtempSync(join(tmpdir(), "arch-"));
  const dest = archive({ dir, workspace: "ws" }, out);
  assert.equal(existsSync(dir), false);
  assert.equal(existsSync(join(dest, "session.v4.jsonl.zstd")), true);
});