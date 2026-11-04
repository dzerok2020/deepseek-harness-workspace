#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

// Usage: node tools/adapt-restore-config.mjs <workspaceDir> <dshHomeDir> <backupDir> <targetProfileDir>
const [,, workspaceDir, dshHomeDir, backupDir, targetProfileDir] = process.argv;

if (!workspaceDir || !dshHomeDir || !backupDir || !targetProfileDir) {
  console.error('Usage: node tools/adapt-restore-config.mjs <workspaceDir> <dshHomeDir> <backupDir> <targetProfileDir>');
  process.exit(1);
}

// 1. Adapt package.json
const sourcePkgPath = path.join(backupDir, 'profiles', 'web', 'package.json');
const targetPkgPath = path.join(targetProfileDir, 'package.json');

const pkg = JSON.parse(fs.readFileSync(sourcePkgPath, 'utf8'));

if (pkg.dependencies) {
  for (const [dep, ver] of Object.entries(pkg.dependencies)) {
    if (typeof ver === 'string' && (ver.startsWith('file:') || ver.startsWith('link:'))) {
      const protocol = ver.startsWith('link:') ? 'link:' : 'file:';
      let resolved;
      if (/^[a-zA-Z]:/.test(workspaceDir)) {
        const cleanBase = workspaceDir.replace(/\\/g, '/').replace(/\/+$/, '');
        resolved = `${cleanBase}/${dep}`;
      } else {
        resolved = path.resolve(workspaceDir, dep).replace(/\\/g, '/');
      }
      pkg.dependencies[dep] = `${protocol}${resolved}`;
    }
  }
}

fs.mkdirSync(targetProfileDir, { recursive: true });
fs.writeFileSync(targetPkgPath, JSON.stringify(pkg, null, 2) + '\n');
console.log(`[adapt-restore-config] Wrote adapted package.json -> ${targetPkgPath}`);

// 2. Adapt cordis.patch.yml
const sourceCordisPath = path.join(backupDir, 'profiles', 'web', 'cordis.patch.yml');
const targetCordisPath = path.join(targetProfileDir, 'cordis.patch.yml');

if (fs.existsSync(sourceCordisPath)) {
  const cordisSrc = fs.readFileSync(sourceCordisPath, 'utf8');
  const normalizedHome = dshHomeDir.replace(/\\/g, '/');
  const nodeBin = process.execPath.replace(/\\/g, '/');

  let updated = cordisSrc
    .replace(/\/home\/[a-zA-Z0-9._-]+\/\.dsh/g, normalizedHome)
    .replace(/command:\s*.*\/node(\.exe)?/g, `command: ${nodeBin}`);

  fs.writeFileSync(targetCordisPath, updated);
  console.log(`[adapt-restore-config] Wrote adapted cordis.patch.yml -> ${targetCordisPath}`);
}
