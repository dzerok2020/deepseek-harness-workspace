/**
 * Test xác minh chất lượng tài liệu trong docs/ — chạy: node --test test/vibe-docs.test.mjs
 * Đây chính là bước 4 của quy trình vibe coding: thứ gì viết ra phải có kiểm chứng tự động.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DOCS = join(ROOT, "docs");

const mdFiles = readdirSync(DOCS).filter((f) => f.endsWith(".md")).map((f) => join(DOCS, f));

test("docs/ có ít nhất cẩm nang vibe-code-cho-nguoi-moi.md", () => {
  assert.ok(mdFiles.some((f) => f.endsWith("vibe-code-cho-nguoi-moi.md")), "thiếu cẩm nang chính");
});

for (const file of mdFiles) {
  const name = file.split("/").pop();

  test(`${name}: tồn tại và không rỗng`, () => {
    const text = readFileSync(file, "utf8");
    assert.ok(text.trim().length > 0, "file rỗng");
  });

  test(`${name}: code fence cân bằng (mở đúng đóng)`, () => {
    const text = readFileSync(file, "utf8");
    const fences = text.split("\n").filter((l) => l.trimStart().startsWith("```")).length;
    assert.equal(fences % 2, 0, `số dòng fence lẻ (${fences}) — có block chưa đóng`);
  });

  test(`${name}: mọi bảng có cấu trúc hợp lệ (dòng trống phía trước, số cột khớp, có dòng phân cách)`, () => {
    const lines = readFileSync(file, "utf8").split("\n");
    let i = 0;
    while (i < lines.length) {
      if (!lines[i].trimStart().startsWith("|")) { i++; continue; }
      // bắt đầu một bảng: dòng trước phải trống (hoặc là dòng đầu file)
      const prev = i > 0 ? lines[i - 1].trim() : "";
      assert.equal(prev, "", `bảng tại dòng ${i + 1} thiếu dòng trống phía trước`);
      // `\|` bên trong ô là pipe literal theo GFM, không phải ngăn cột
      const cols = (h) => h.replace(/\\\|/g, "¦").split("|").length - 2; // bỏ | đầu/cuối
      const header = lines[i];
      assert.ok(lines[i + 1]?.match(/^\|[\s:-]+\|/), `bảng tại dòng ${i + 1} thiếu dòng phân cách |---|`);
      const n = cols(header);
      let j = i;
      while (j < lines.length && lines[j].trimStart().startsWith("|")) {
        assert.equal(cols(lines[j]), n, `dòng ${j + 1} của bảng (header ${n} cột) sai số cột: ${lines[j]}`);
        j++;
      }
      i = j;
    }
  });
}

test("cẩm nang đủ 7 phần theo thiết kế", () => {
  const text = readFileSync(join(DOCS, "vibe-code-cho-nguoi-moi.md"), "utf8");
  for (const [n, keyword] of [[1, "Bạn đã có gì sẵn"], [2, "Quy trình 5 bước"], [3, "Dự án đang sống"],
    [4, "Lộ trình nâng cao"], [5, "Từ điển 60 giây"], [6, "4 lỗi người mới"], [7, "Mẹo prompt"]]) {
    assert.ok(text.includes(`## ${n}.`) && text.includes(keyword), `thiếu phần ${n} (${keyword})`);
  }
});
