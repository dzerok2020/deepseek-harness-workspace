#!/usr/bin/env node
// Kiểm mọi preset trong ~/.dsh/profiles/<profile>/cordis.patch.yml:
// - plugin name resolve được
// - Config của plugin nhận đúng config đã khai (bắt lỗi thiếu field bắt buộc
//   như tool-subagent.provider — lỗi làm preset không mount được).
// Chỉ đọc; exit 1 nếu có preset hỏng.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

const DSH = '/home/dzerok/.local/share/mise/installs/node/26.8.2/lib/node_modules/@deepseek-ai/dsh';
const requireDsh = createRequire(join(DSH, 'package.json'));
const yaml = requireDsh('js-yaml');

const profile = process.argv[2] ?? 'web';
const profileDir = join(homedir(), '.dsh', 'profiles', profile);
const requireProfile = createRequire(join(profileDir, 'package.json'));
const patchPath = join(profileDir, 'cordis.patch.yml');
const doc = yaml.load(readFileSync(patchPath, 'utf8'));

function* rows(list) {
  for (const row of list ?? []) {
    if (row?.group === true) {
      yield* rows(row.config);
      continue;
    }
    yield row;
  }
}

function* presets() {
  for (const layer of doc ?? []) {
    for (const insert of layer?.insert ?? []) {
      const config = insert?.config;
      if (config && typeof config === 'object' && Array.isArray(config.plugins)) {
        yield { id: config.id ?? insert.id, plugins: config.plugins };
      }
    }
  }
}

async function loadModule(name) {
  if (name.startsWith('cordis:')) return null;
  // Thử resolve qua exports của package trước: tên con kiểu
  // '@deepseek-ai/dsh-tool-subagent-control/list-agents' hoặc
  // '@deepseek-ai/dsh-plugin-market/tools' là subpath export, không phải thư mục,
  // nên cách ghép đường dẫn thủ công bên dưới sẽ báo lỗi sai.
  const resolvers = name.startsWith('@') ? [requireDsh, requireProfile] : [requireProfile, requireDsh];
  for (const resolver of resolvers) {
    try {
      return await import(pathToFileURL(resolver.resolve(name)).href);
    } catch (error) {
      if (error?.code !== 'MODULE_NOT_FOUND' && error?.code !== 'ERR_MODULE_NOT_FOUND') throw error;
    }
  }
  const candidates = name.startsWith('@')
    ? [join(DSH, 'node_modules', name), join(profileDir, 'node_modules', name)]
    : [join(profileDir, 'node_modules', name), join(DSH, 'node_modules', name)];
  for (const dir of candidates) {
    try {
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
      const entry = join(dir, pkg.module ?? pkg.main ?? 'lib/index.js');
      return await import(pathToFileURL(entry).href);
    } catch (error) {
      if (error?.code !== 'ENOENT' && error?.code !== 'MODULE_NOT_FOUND') throw error;
    }
  }
  throw new Error(`không resolve được ${name}`);
}

let checked = 0;
let failed = 0;
for (const preset of presets()) {
  for (const row of rows(preset.plugins)) {
    // Row disabled: true không được mount, kiểm nó chỉ tạo lỗi giả.
    if (row.disabled === true) continue;
    checked += 1;
    const label = `${preset.id} / ${row.id ?? row.name}`;
    try {
      const mod = await loadModule(row.name);
      if (typeof mod?.Config === 'function') mod.Config(row.config ?? {});
    } catch (error) {
      failed += 1;
      console.log(`LỖI ${label} (${row.name}): ${String(error?.message ?? error).split('\n')[0]}`);
    }
  }
}
console.log(`\n${checked} row trong ${[...presets()].length} preset, ${failed} lỗi`);
process.exit(failed === 0 ? 0 : 1);