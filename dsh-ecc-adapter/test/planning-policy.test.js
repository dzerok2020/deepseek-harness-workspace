import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const policyUrl = new URL('../planning-policy.md', import.meta.url);
const live = process.env.ECC_PLANNING_LIVE === '1';
const nativeEntry = process.env.DSH_INSTRUCTIONS_ENTRY;
const start = '<!-- ecc-selective-planning:start -->';
const end = '<!-- ecc-selective-planning:end -->';

test('selective planning guidance covers activation, reuse, skips and native safety limits', () => {
  const policy = readFileSync(policyUrl, 'utf8');
  assert.ok(Buffer.byteLength(policy) < 6000, 'Keep always-loaded guidance small.');
  for (const [branch, text] of Object.entries({
    parent: 'Chỉ AI chính (parent)',
    newProject: 'dự án mới đã rõ mục tiêu',
    largeFeature: 'tính năng lớn hoặc thay đổi nhiều module',
    sensitiveChange: 'dữ liệu, quyền truy cập, API hoặc migration',
    invocation: 'gọi tool `ecc_planner` trước khi code',
    reuse: 'kế hoạch hiện có còn phù hợp',
    smallWork: 'sửa lỗi nhỏ, đổi chữ/màu, giải thích code, chạy test',
    noSessionTrigger: 'mở thư mục, tạo repository, đổi session hoặc restart DSH',
    clarify: 'làm rõ trước',
    deduplication: 'một lần tự gọi cho cùng workspace + mục tiêu/phạm vi',
    scopeChange: 'chỉ lập lại phần bị ảnh hưởng khi phạm vi thay đổi đáng kể',
    failure: 'không tự retry',
    availability: 'tool không có trong catalog hoặc bị native policy chặn',
    noRouterModel: 'không gọi model riêng để phân loại',
    approval: 'không thay thế phê duyệt',
    inheritance: 'giữ nguyên model/routing, permissions và depth cap native',
    storage: 'không tạo store/counter hoặc memory service mới',
    limit: 'không phải bảo đảm kỹ thuật exactly-once',
  })) assert.ok(policy.includes(text), `Missing ${branch}: ${text}`);
});

test('installed global guidance exactly matches the versioned managed fragment', { skip: !live }, () => {
  const globalText = readFileSync(join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'AGENTS.md'), 'utf8');
  assert.equal(globalText.split(start).length - 1, 1);
  assert.equal(globalText.split(end).length - 1, 1);
  const installed = globalText.slice(globalText.indexOf(start) + start.length, globalText.indexOf(end)).trim();
  assert.equal(installed, readFileSync(policyUrl, 'utf8').trim());
});

test('public native loader retains selective guidance in project and new-folder contexts', { skip: !live || !nativeEntry }, async () => {
  const { loadBaselineInstructions } = await import(pathToFileURL(nativeEntry).href);
  for (const cwd of [process.cwd(), tmpdir()]) {
    const rendered = await loadBaselineInstructions({ cwd, maxBytes: 65536 });
    assert.equal(typeof rendered?.text, 'string');
    assert.ok(rendered.text.includes('## ECC planner — tự động chọn lọc'), `Global guidance omitted for ${cwd}`);
    assert.ok(rendered.text.includes('không phải bảo đảm kỹ thuật exactly-once'));
    assert.ok(rendered.text.includes('giữ nguyên model/routing, permissions và depth cap native'));
    assert.deepEqual(rendered.truncated, []);
    assert.deepEqual(rendered.omitted, []);
  }
});
