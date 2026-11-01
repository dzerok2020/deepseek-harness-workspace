import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Chạy tools/prompt-budget.mjs trong một HOME giả để kiểm tra phép đo catalog skill:
// phải thấy skill từ MHCM root mà DSH nạp (project, ECC, plugin, user), không chỉ ~/.dsh/skills.
const script = path.join(import.meta.dirname, '..', 'tools', 'prompt-budget.mjs');

function skill(dir, name, description) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`);
}

function fakeHome() {
  const home = mkdtempSync(path.join(os.tmpdir(), 'dsh-prompt-budget-'));
  const project = path.join(home, 'project');
  mkdirSync(project, { recursive: true });
  const dsh = path.join(home, '.dsh');
  const profile = path.join(dsh, 'profiles', 'web');
  return { home, project, dsh, profile };
}

function runCatalog(home, project) {
  const out = execFileSync(process.execPath, [script, '--skills-only', '--json'], {
    env: { ...process.env, HOME: home, DSH_PROFILE: 'web' },
    cwd: project,
    encoding: 'utf8',
  });
  return JSON.parse(out);
}

test('catalog counts skills from project, ECC, plugin and user roots', () => {
  const env = fakeHome();
  try {
    skill(path.join(env.project, '.dsh', 'skills'), 'alpha', 'aaa');
    skill(path.join(env.dsh, 'ecc', 'source', 'skills'), 'gamma', 'gggg');
    skill(path.join(env.profile, 'node_modules', 'pkg-x', 'skills'), 'beta', 'bbbbbb');
    skill(path.join(env.dsh, 'skills'), 'delta', 'd');

    const catalog = runCatalog(env.home, env.project);
    assert.equal(catalog.count, 4);
    // chars = độ dài name + description của từng skill
    assert.equal(catalog.chars, 5 + 3 + 5 + 4 + 6 + 4 + 5 + 1);
    const sources = catalog.sources.map((s) => s.source).sort();
    assert.deepEqual(sources, ['ecc', 'plugin:pkg-x', 'project-dsh', 'user-dsh']);
  } finally {
    rmSync(env.home, { recursive: true, force: true });
  }
});

test('skill trùng tên chỉ tính một lần và root project thắng user', () => {
  const env = fakeHome();
  try {
    skill(path.join(env.project, '.dsh', 'skills'), 'dup', 'X');
    skill(path.join(env.dsh, 'skills'), 'dup', 'YYYYYYYYYY');
    skill(path.join(env.dsh, 'skills'), 'unique', 'Z');

    const catalog = runCatalog(env.home, env.project);
    assert.equal(catalog.count, 2);
    // 'dup' lấy bản project (3 + 1 ký tự), không lấy bản user dài hơn
    assert.equal(catalog.chars, 3 + 1 + 6 + 1);
  } finally {
    rmSync(env.home, { recursive: true, force: true });
  }
});

test('extra root qua DSH_SKILL_EXTRA_ROOTS được tính vào catalog', () => {
  const env = fakeHome();
  try {
    const extra = path.join(env.home, 'extra-skills');
    skill(extra, 'epsilon', 'eeee');
    const out = execFileSync(process.execPath, [script, '--skills-only', '--json'], {
      env: { ...process.env, HOME: env.home, DSH_PROFILE: 'web', DSH_SKILL_EXTRA_ROOTS: extra },
      cwd: env.project,
      encoding: 'utf8',
    });
    const catalog = JSON.parse(out);
    assert.equal(catalog.count, 1);
    assert.deepEqual(catalog.sources, [{ source: 'env', count: 1 }]);
  } finally {
    rmSync(env.home, { recursive: true, force: true });
  }
});
