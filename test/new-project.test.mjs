import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const template = readFileSync(join(root, 'tools/templates/AGENTS.md'), 'utf8');

for (const name of ['ordinary-project', 'project & notes', 'project\\notes', 'project\nnotes', 'project\n', 'project\n\n', 'trailing-slashes']) {
  test(`project template preserves literal name ${JSON.stringify(name)}`, () => {
    const temp = mkdtempSync(join(tmpdir(), 'dsh-project-test-'));
    try {
      const target = join(temp, name) + (name === 'trailing-slashes' ? '///' : '');
      const result = spawnSync('bash', [join(root, 'tools/new-project.sh'), target], {
        encoding: 'utf8',
        env: {
          ...process.env,
          GIT_CONFIG_GLOBAL: '/dev/null',
          GIT_CONFIG_NOSYSTEM: '1',
          GIT_AUTHOR_NAME: 'DSH fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
          GIT_COMMITTER_NAME: 'DSH fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
        },
      });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(readFileSync(join(target, 'AGENTS.md'), 'utf8'), template.replaceAll('{{TÊN_DỰ_ÁN}}', name));
    } finally {
      assert.ok(temp.startsWith(join(tmpdir(), 'dsh-project-test-')));
      rmSync(temp, { recursive: true, force: true });
    }
  });
}
