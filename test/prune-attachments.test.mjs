import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { classify, collectBlobs, tokensOf } from '../tools/prune-attachments.mjs';

const HASH = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);
const DAY = 86_400_000;

test('tokensOf nhặt hash 64-hex từ text session và bỏ qua chuỗi ngắn hơn', () => {
  const refs = tokensOf(`{"path":"attachments/v1/objects/aa/${HASH}"} ${'c'.repeat(63)} ${OTHER}x`);
  assert.deepEqual([...refs], [HASH, OTHER]);
});

test('classify: blob được tham chiếu luôn giữ, blob mới cũng giữ, chỉ blob cũ không tham chiếu là mồ côi', () => {
  const now = 1_000 * DAY;
  const files = [
    { hash: HASH, size: 100, mtimeMs: now - 30 * DAY },
    { hash: OTHER, size: 200, mtimeMs: now - 30 * DAY },
    { hash: 'd'.repeat(64), size: 300, mtimeMs: now - DAY / 2 },
  ];
  const r = classify(files, new Set([HASH]), { nowMs: now });
  assert.deepEqual(r.referenced.map((f) => f.hash), [HASH]);
  assert.deepEqual(r.recent.map((f) => f.hash), ['d'.repeat(64)]);
  assert.deepEqual(r.orphan.map((f) => f.hash), [OTHER]);
  assert.equal(r.totalBytes, 600);
  assert.equal(r.orphanBytes, 200);
});

test('collectBlobs chỉ nhận file có tên là hash 64-hex trong objects/ và file-objects/', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'dsh-attach-'));
  try {
    const shard = path.join(root, 'objects', HASH.slice(0, 2));
    mkdirSync(shard, { recursive: true });
    writeFileSync(path.join(shard, HASH), 'x'.repeat(10));
    writeFileSync(path.join(shard, 'not-a-hash.txt'), 'x');
    const named = path.join(root, 'files', HASH.slice(0, 2), HASH);
    mkdirSync(named, { recursive: true });
    writeFileSync(path.join(named, HASH), 'y'.repeat(20));

    const blobs = collectBlobs(root);
    assert.equal(blobs.length, 1);
    assert.equal(blobs[0].hash, HASH);
    assert.equal(blobs[0].size, 10);
    assert.equal(blobs[0].kind, 'objects');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
