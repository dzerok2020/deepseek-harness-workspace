import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = name => fs.readFileSync(new URL('../' + name, import.meta.url), 'utf8');

test('workspace contract routes real work to the native playbook', () => {
  const contract = read('AGENTS.md');
  assert.match(contract, /docs\/vibe-native-playbook\.md/);
  assert.match(contract, /thông báo trùng/);
});

test('playbook covers six task types and five operating priorities', () => {
  const playbook = read('docs/vibe-native-playbook.md');
  for (const section of ['1. Tác vụ thật', '2. Propose', '3. Bài học', '4. Luật', '5. Điều phối']) {
    assert.ok(playbook.includes(section), section);
  }
  for (const kind of ['Yêu cầu mơ hồ', 'Sửa bug', 'Tính năng nhỏ', 'UI', 'Tool lỗi', 'Ngoài workspace']) {
    assert.ok(playbook.includes(kind), kind);
  }
  assert.match(playbook, /chưa đo/);
  assert.match(playbook, /không tự ghi memory/);
  assert.match(playbook, /không nới sandbox/);
});

test('continuity guidance preserves one carrier and checks effects before resuming', () => {
  const playbook = read('docs/vibe-native-playbook.md');
  for (const requirement of [
    '6. Giữ tiến độ và phục hồi',
    'long-task-continuation',
    'một bản ghi công việc',
    'yêu cầu gốc',
    'git status',
    'job_output',
    'không tự chạy lại',
    'preflight_compress_failed',
    'chưa verify end-to-end',
  ]) {
    assert.ok(playbook.includes(requirement), requirement);
  }
});

test('old evaluation guide explicitly yields to approved native workflow', () => {
  assert.match(read('docs/harness-eval-guide.md'), /không còn là điều kiện tiên quyết/);
});
