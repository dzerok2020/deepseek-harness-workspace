import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, utimesSync, renameSync, symlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classify, probe, scan } from "../clean-sessions.mjs";

const HOUR = 60 * 60 * 1000;
const base = { records: 1, realRecords: 0, complete: true, mtimeMs: 0, nowMs: 10 * HOUR };
const script = fileURLToPath(new URL("../clean-sessions.mjs", import.meta.url));

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "dsh-clean-offline-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dir = join(root, ".dsh", "sessions", "ws", "session");
  mkdirSync(dir, { recursive: true });
  return { root, dir, file: join(dir, "session.v4.jsonl.zstd") };
}

function writeCompressed(file, content) {
  writeFileSync(file, execFileSync("zstd", ["-q", "-c"], { input: content }));
  utimesSync(file, 0, 0);
}

function writeDecoder(root, source) {
  const bin = join(root, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "zstd"), `#!${process.execPath}\n${source}`, { mode: 0o755 });
  return bin;
}

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

test("classify: chỉ xác nhận empty khi đã đọc hết và decoder thành công", () => {
  assert.equal(classify({ ...base, complete: false }), "broken");
  assert.equal(classify({ ...base, complete: undefined }), "broken");
  assert.equal(classify({ ...base, complete: false, realRecords: 1 }), "live");
});

test("probe: EOF sạch giữ record cuối không có newline", async (t) => {
  const { file } = fixture(t);
  writeCompressed(file, '{"type":"session/created"}\n{"type":"permission/preset"}');
  assert.deepEqual(await probe(file), { records: 2, realRecords: 0, complete: true });
});

test("probe: EOF sạch nhưng không có record vẫn là broken", async (t) => {
  const { file } = fixture(t);
  writeCompressed(file, "");
  const result = await probe(file);
  assert.deepEqual(result, { records: 0, realRecords: 0, complete: true });
  assert.equal(classify({ ...base, ...result }), "broken");
});

test("probe và scan: giới hạn 5000 không chứng minh session rỗng", async (t) => {
  const { root, file } = fixture(t);
  writeCompressed(file, '{"type":"session/created"}\n'.repeat(5000) + '{"type":"user/message"}\n');
  const result = await probe(file);
  assert.deepEqual(result, { records: 5000, realRecords: 0, complete: false });
  const rows = await scan(join(root, ".dsh", "sessions"));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, "broken");
  assert.equal(rows[0].complete, false);
});

test("probe: decoder hỏng sau prefix hợp lệ không chứng minh empty", async (t) => {
  const { file } = fixture(t);
  const prefix = '{"type":"session/created"}\n';
  const frame = execFileSync("zstd", ["-q", "-c"], { input: prefix });
  writeFileSync(file, Buffer.concat([frame, Buffer.from("invalid zstd frame")]));
  const decoded = spawnSync("zstd", ["-dc", file], { encoding: "utf8" });
  assert.notEqual(decoded.status, 0);
  assert.equal(decoded.stdout, prefix);
  const result = await probe(file);
  assert.deepEqual(result, { records: 1, realRecords: 0, complete: false });
  assert.equal(classify({ ...base, ...result }), "broken");
});

for (const code of [0, 7]) {
  test(`probe: đợi EOF và decoder exit ${code} trước khi kết luận`, (t) => {
    const { root, file } = fixture(t);
    const marker = join(root, "decoder-exited");
    const bin = writeDecoder(root, `
      const fs = require("node:fs");
      fs.writeSync(1, '{"type":"session/created"}\\n');
      fs.closeSync(1);
      setTimeout(() => {
        fs.writeFileSync(${JSON.stringify(marker)}, "exited");
        process.exit(${code});
      }, 30);
    `);
    const result = JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", `
      import { probe } from ${JSON.stringify(new URL("../clean-sessions.mjs", import.meta.url).href)};
      import { existsSync } from "node:fs";
      console.log(JSON.stringify({ result: await probe(${JSON.stringify(file)}), exited: existsSync(${JSON.stringify(marker)}) }));
    `], { env: { ...process.env, PATH: bin }, encoding: "utf8" }));
    assert.equal(result.exited, true);
    assert.deepEqual(result.result, { records: 1, realRecords: 0, complete: code === 0 });
  });
}

test("probe: thiếu decoder không chứng minh empty", (t) => {
  const { root, file } = fixture(t);
  const result = JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", `
    import { probe } from ${JSON.stringify(new URL("../clean-sessions.mjs", import.meta.url).href)};
    console.log(JSON.stringify(await probe(${JSON.stringify(file)})));
  `], { env: { ...process.env, PATH: root }, encoding: "utf8" }));
  assert.deepEqual(result, { records: -1, realRecords: -1, complete: false });
  assert.equal(classify({ ...base, ...result }), "broken");
});

test("main --apply: revalidation chỉ xoá khi xác nhận empty lần nữa", async (t) => {
  for (const mode of ["empty", "limit", "decoder-error", "decoder-missing", "no-records", "live", "active-now"]) {
    await t.test(mode, (t) => {
      const { root, dir, file } = fixture(t);
      writeFileSync(file, "offline fixture, not a real session");
      utimesSync(file, 0, 0);
      const bin = writeDecoder(root, `
        const fs = require("node:fs");
        const counter = ${JSON.stringify(join(root, "decode-count"))};
        const count = fs.existsSync(counter) ? Number(fs.readFileSync(counter, "utf8")) + 1 : 1;
        fs.writeFileSync(counter, String(count));
        const mode = ${JSON.stringify(mode)};
        const frame = '{"type":"session/created"}\\n';
        if (count === 1) {
          if (mode === "decoder-missing") fs.unlinkSync(process.argv[1]);
          process.stdout.write(frame);
        } else if (mode === "limit") {
          process.stdout.write(frame.repeat(5000) + '{"type":"user/message"}\\n');
        } else if (mode === "live") {
          process.stdout.write('{"type":"user/message"}\\n');
        } else if (mode !== "no-records") {
          if (mode === "active-now") fs.utimesSync(process.argv[3], new Date(), new Date());
          process.stdout.write(frame);
          if (mode === "decoder-error") process.exitCode = 7;
        }
      `);
      const output = execFileSync(process.execPath, [script, "--apply", "--yes"], {
        env: { ...process.env, HOME: root, PATH: bin }, encoding: "utf8",
      });
      const removed = mode === "empty";
      assert.equal(existsSync(dir), !removed);
      assert.match(output, new RegExp(`Đã xoá ${removed ? 1 : 0} session rỗng`));
    });
  }
});

test("scan và main --apply: không theo symlink workspace/session/file", async (t) => {
  for (const mode of ["workspace", "session", "file"]) {
    await t.test(mode, async (t) => {
      const { root, dir, file } = fixture(t);
      writeCompressed(file, '{"type":"session/created"}\n');
      const target = mode === "workspace" ? join(root, ".dsh", "sessions", "ws") : mode === "session" ? dir : file;
      const external = join(root, "outside-sessions");
      renameSync(target, external);
      symlinkSync(external, target);
      const rows = await scan(join(root, ".dsh", "sessions"));
      const output = execFileSync(process.execPath, [script, "--apply", "--yes"], {
        env: { ...process.env, HOME: root }, encoding: "utf8",
      });
      assert.equal(existsSync(file), true, "không xoá candidate qua symlink");
      assert.equal(existsSync(external), true, "giữ nguyên dữ liệu ngoài sessions");
      assert.equal(rows.length, 0, "symlink không được thành cleanup candidate");
      assert.match(output, /Đã xoá 0 session rỗng/);
    });
  }
});

test("main --apply: canonical root symlink vẫn cho phép session con bình thường", (t) => {
  const { root, file } = fixture(t);
  writeCompressed(file, '{"type":"session/created"}\n');
  const sessions = join(root, ".dsh", "sessions");
  const physical = join(root, "physical-sessions");
  renameSync(sessions, physical);
  symlinkSync(physical, sessions);
  const output = execFileSync(process.execPath, [script, "--apply", "--yes"], {
    env: { ...process.env, HOME: root }, encoding: "utf8",
  });
  assert.equal(existsSync(join(physical, "ws", "session")), false);
  assert.match(output, /Đã xoá 1 session rỗng/);
});

test("main --apply: từ chối thay parent/identity hoặc thêm file trong lần probe cuối", async (t) => {
  for (const mode of ["workspace-symlink", "session-symlink", "file-symlink", "workspace-replaced", "session-replaced", "file-replaced", "extra-file"]) {
    await t.test(mode, (t) => {
      const { root, dir, file } = fixture(t);
      writeFileSync(file, "offline fixture, not a real session");
      utimesSync(file, 0, 0);
      const bin = writeDecoder(root, `
        const fs = require("node:fs");
        const path = require("node:path");
        const counter = ${JSON.stringify(join(root, "decode-count"))};
        const count = fs.existsSync(counter) ? Number(fs.readFileSync(counter, "utf8")) + 1 : 1;
        fs.writeFileSync(counter, String(count));
        if (count === 2) {
          const file = process.argv[3];
          const dir = path.dirname(file);
          const ws = path.dirname(dir);
          const mode = ${JSON.stringify(mode)};
          if (mode === "extra-file") {
            fs.writeFileSync(path.join(dir, "new-user-data"), "keep me");
          } else {
            const target = mode.startsWith("workspace") ? ws : mode.startsWith("session") ? dir : file;
            const previous = ${JSON.stringify(join(root, "previous-candidate"))};
            fs.renameSync(target, previous);
            if (mode.endsWith("symlink")) {
              fs.symlinkSync(previous, target);
            } else {
              fs.mkdirSync(dir, { recursive: true });
              fs.writeFileSync(file, "replacement fixture, not original candidate");
              fs.utimesSync(file, 0, 0);
            }
          }
        }
        process.stdout.write('{"type":"session/created"}\\n');
      `);
      const output = execFileSync(process.execPath, [script, "--apply", "--yes"], {
        env: { ...process.env, HOME: root, PATH: bin }, encoding: "utf8",
      });
      assert.equal(existsSync(file), true, "candidate đã đổi phải được giữ lại");
      if (mode === "extra-file") assert.equal(existsSync(join(dir, "new-user-data")), true);
      assert.match(output, /Đã xoá 0 session rỗng/);
    });
  }
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