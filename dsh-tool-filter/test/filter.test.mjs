import { test } from "node:test";
import assert from "node:assert/strict";
import { apply } from "../lib/index.js";

function fakeCtx(failOnce) {
  const calls = [];
  const warnings = [];
  let fail = failOnce;
  return {
    calls,
    warnings,
    tools: {
      restrict(filter) {
        calls.push(filter);
        if (fail) {
          fail = false;
          throw new Error('tools.restrict() names unknown global tool "gone_tool"; known global tools: a, b');
        }
        return () => {};
      },
    },
    logger: { warn: (m) => warnings.push(m) },
  };
}

test("allow: áp dụng đúng danh sách", () => {
  const ctx = fakeCtx(false);
  apply(ctx, { allow: ["a", "b"] });
  assert.deepEqual(ctx.calls, [{ allow: ["a", "b"] }]);
});

test("deny: áp dụng đúng danh sách", () => {
  const ctx = fakeCtx(false);
  apply(ctx, { deny: ["x"] });
  assert.deepEqual(ctx.calls, [{ deny: ["x"] }]);
});

test("không có config thì không gọi restrict", () => {
  const ctx = fakeCtx(false);
  apply(ctx, {});
  assert.equal(ctx.calls.length, 0);
});

test("tên đã biến mất: bỏ tên đó rồi thử lại", () => {
  const ctx = fakeCtx(true);
  apply(ctx, { allow: ["a", "gone_tool"] });
  assert.deepEqual(ctx.calls, [{ allow: ["a", "gone_tool"] }, { allow: ["a"] }]);
  assert.match(ctx.warnings[0], /gone_tool/);
});

test("lọc hết sạch sau khi bỏ tên lỗi: không gọi restrict rỗng", () => {
  const ctx = fakeCtx(true);
  apply(ctx, { allow: ["gone_tool"] });
  assert.equal(ctx.calls.length, 1);
  assert.equal(ctx.warnings.length, 0);
});