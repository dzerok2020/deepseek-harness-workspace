import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

const workspaceRoot = process.cwd();
const backupDir = path.join(workspaceRoot, 'dsh-backup');
const scriptPath = path.join(workspaceRoot, 'tools', 'adapt-restore-config.mjs');

test('adapt-restore-config adapts paths for Linux targets', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-adapt-test-'));

  try {
    const fakeWorkspace = '/fake/custom/workspace';
    const fakeDshHome = '/fake/custom/.dsh';
    const targetProfile = path.join(tmpDir, 'web');

    execFileSync(process.execPath, [
      scriptPath,
      fakeWorkspace,
      fakeDshHome,
      backupDir,
      targetProfile,
    ]);

    // Check package.json
    const adaptedPkg = JSON.parse(fs.readFileSync(path.join(targetProfile, 'package.json'), 'utf8'));
    assert.equal(adaptedPkg.dependencies['dsh-loop-guard'], 'file:/fake/custom/workspace/dsh-loop-guard');
    assert.equal(adaptedPkg.dependencies['dsh-decide'], 'file:/fake/custom/workspace/dsh-decide');

    // Check cordis.patch.yml
    const adaptedCordis = fs.readFileSync(path.join(targetProfile, 'cordis.patch.yml'), 'utf8');
    assert.ok(adaptedCordis.includes('/fake/custom/.dsh/ecc/source'));
    assert.ok(!adaptedCordis.includes('/home/dzerok/.dsh'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('adapt-restore-config handles Windows paths with backslashes correctly', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-adapt-win-test-'));

  try {
    const fakeWinWorkspace = 'C:\\Users\\John Doe\\Documents\\workspace';
    const fakeWinDshHome = 'C:\\Users\\John Doe\\.dsh';
    const targetProfile = path.join(tmpDir, 'web');

    execFileSync(process.execPath, [
      scriptPath,
      fakeWinWorkspace,
      fakeWinDshHome,
      backupDir,
      targetProfile,
    ]);

    // Check package.json: backslashes should be normalized to forward slashes
    const adaptedPkg = JSON.parse(fs.readFileSync(path.join(targetProfile, 'package.json'), 'utf8'));
    assert.equal(adaptedPkg.dependencies['dsh-loop-guard'], 'file:C:/Users/John Doe/Documents/workspace/dsh-loop-guard');
    assert.equal(adaptedPkg.dependencies['dsh-decide'], 'file:C:/Users/John Doe/Documents/workspace/dsh-decide');

    // Check cordis.patch.yml
    const adaptedCordis = fs.readFileSync(path.join(targetProfile, 'cordis.patch.yml'), 'utf8');
    assert.ok(adaptedCordis.includes('C:/Users/John Doe/.dsh/ecc/source'));
    assert.ok(!adaptedCordis.includes('/home/dzerok/.dsh'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
