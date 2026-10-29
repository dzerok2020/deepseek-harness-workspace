// Bản cài trong profile là bản hard-link của repo này (npm `file:`).
// File MỚI thêm vào lib/ sau lúc cài không tự xuất hiện ở profile, nên plugin
// chết với ERR_MODULE_NOT_FOUND (thực tế: thiếu lib/policy.js).
// Test này bắt đúng lớp lỗi đó trước khi nó vào log của `dsh web`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const lib = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'lib');
const profile = process.env.DSH_PROFILE ?? 'web';
const installed = join(homedir(), '.dsh', 'profiles', profile, 'node_modules', 'dsh-prompt-intake', 'lib');
const sources = () => readdirSync(lib).filter(file => file.endsWith('.js'));
const relativeImports = file => [...readFileSync(join(lib, file), 'utf8')
  .matchAll(/(?:from\s*|import\s*\(\s*)['"](\.[^'"]+)['"]/g)].map(match => match[1]);

test('mọi import tương đối trong lib/ đều trỏ tới file có thật', () => {
  for (const file of sources()) {
    for (const spec of relativeImports(file)) {
      assert.ok(existsSync(join(lib, spec)), `${file} import ${spec} nhưng file không tồn tại`);
    }
  }
});

test(`bản cài ở profile "${profile}" phải đủ file như repo`, t => {
  if (!existsSync(installed)) return t.skip(`plugin chưa được cài vào profile ${profile}`);
  for (const file of sources()) {
    assert.ok(existsSync(join(installed, file)), `thiếu ${file} trong ${installed}`);
    for (const spec of relativeImports(file)) {
      assert.ok(existsSync(join(installed, spec)), `thiếu ${spec} (import của ${file}) trong ${installed}`);
    }
  }
});