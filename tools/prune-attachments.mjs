#!/usr/bin/env node
// Dọn attachment MỒ CÔI trong ~/.dsh/attachments (mặc định chỉ LIỆT KÊ).
// Mồ côi = hash của blob không xuất hiện trong bất kỳ session nào còn trên đĩa.
// Không bao giờ xoá blob đang được session tham chiếu, và bỏ qua blob mới trong
// MIN_AGE_MS để không đụng file vừa upload. Muốn xoá thật: --apply --yes
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const HOME = os.homedir();
const DSH = path.join(HOME, '.dsh');
const ATTACH = path.join(DSH, 'attachments', 'v1');
const SESSIONS = path.join(DSH, 'sessions');
const BLOB_DIRS = ['objects', 'file-objects'];
const NAMED_DIR = 'files';
const MIN_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const HASH = /^[0-9a-f]{64}$/;

/** Mọi token 64-hex trong một đoạn text (session record nhắc hash dưới dạng path hoặc id). */
export function tokensOf(text) {
  const out = new Set();
  for (const m of text.matchAll(/[0-9a-f]{64}/g)) out.add(m[0]);
  return out;
}

/** Chia file attachment thành referenced / recent / orphan. */
export function classify(files, referenced, { nowMs = Date.now(), minAgeMs = MIN_AGE_MS } = {}) {
  const result = { referenced: [], recent: [], orphan: [], totalBytes: 0, referencedBytes: 0, recentBytes: 0, orphanBytes: 0 };
  for (const file of files) {
    result.totalBytes += file.size;
    const kind = referenced.has(file.hash) ? 'referenced' : file.mtimeMs > nowMs - minAgeMs ? 'recent' : 'orphan';
    result[kind].push(file);
    result[`${kind}Bytes`] += file.size;
  }
  return result;
}

/** Blob nội dung: <root>/<objects|file-objects>/<2 ký tự>/<hash>. */
export function collectBlobs(root, blobDirs = BLOB_DIRS) {
  const blobs = [];
  for (const dir of blobDirs) {
    const base = path.join(root, dir);
    if (!fs.existsSync(base)) continue;
    for (const shard of fs.readdirSync(base, { withFileTypes: true })) {
      if (!shard.isDirectory()) continue;
      const shardDir = path.join(base, shard.name);
      for (const entry of fs.readdirSync(shardDir, { withFileTypes: true })) {
        if (!entry.isFile() || !HASH.test(entry.name)) continue;
        const file = path.join(shardDir, entry.name);
        const st = fs.statSync(file);
        blobs.push({ kind: dir, hash: entry.name, file, size: st.size, mtimeMs: st.mtimeMs });
      }
    }
  }
  return blobs;
}

/** Hash được nhắc trong mọi session còn trên đĩa (nén zstd). */
export function collectReferences(sessionsDir = SESSIONS) {
  const refs = new Set();
  const files = [];
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.name.endsWith('.zstd')) files.push(p);
    }
  };
  walk(sessionsDir);
  for (const file of files) {
    let raw = '';
    try {
      raw = execFileSync('zstd', ['-dc', file], { maxBuffer: 1 << 30, encoding: 'utf8' });
    } catch {
      continue; // session hỏng: bỏ qua, không kết luận mồ côi từ nó
    }
    for (const token of tokensOf(raw)) refs.add(token);
  }
  return refs;
}

const mb = (n) => `${(n / 1024 / 1024).toFixed(1)} MB`;

function main() {
  const args = new Set(process.argv.slice(2));
  if (!fs.existsSync(ATTACH)) {
    console.log(`Không có ${ATTACH} — không cần dọn.`);
    return;
  }
  const blobs = collectBlobs(ATTACH);
  console.log(`Đang đọc session để biết attachment nào còn dùng… (${blobs.length} blob)`);
  const refs = collectReferences();
  const result = classify(blobs, refs);
  const named = fs.existsSync(path.join(ATTACH, NAMED_DIR)) ? fs.readdirSync(path.join(ATTACH, NAMED_DIR)) : [];

  console.log(`Tổng blob        : ${blobs.length} · ${mb(result.totalBytes)} (đã tính trùng hardlink)`);
  console.log(`  đang dùng      : ${result.referenced.length} · ${mb(result.referencedBytes)}`);
  console.log(`  mới (< 7 ngày) : ${result.recent.length} · ${mb(result.recentBytes)}`);
  console.log(`  mồ côi         : ${result.orphan.length} · ${mb(result.orphanBytes)}`);
  const top = [...result.orphan].sort((a, b) => b.size - a.size).slice(0, 8);
  for (const blob of top) console.log(`   - ${blob.kind}/${blob.hash.slice(0, 10)}  ${mb(blob.size)}`);

  if (!args.has('--apply')) {
    if (result.orphan.length) console.log('\nChưa xoá gì. Chạy lại với  --apply --yes  để xoá đúng các blob MỒ CÔI ở trên.');
    return;
  }
  if (!args.has('--yes')) {
    console.error('\nTừ chối xoá: cần thêm --yes.');
    process.exitCode = 2;
    return;
  }
  let removed = 0;
  let freed = 0;
  for (const blob of result.orphan) {
    if (refs.has(blob.hash)) continue; // tham chiếu xuất hiện giữa lúc quét và lúc xoá
    fs.rmSync(blob.file, { force: true });
    // bản có tên gốc dùng chung inode: xoá cả thư mục <hash>/ cho sạch
    const shard = blob.hash.slice(0, 2);
    const namedDir = path.join(ATTACH, NAMED_DIR, shard, blob.hash);
    if (named.includes(shard) && fs.existsSync(namedDir)) fs.rmSync(namedDir, { recursive: true, force: true });
    if (!fs.existsSync(blob.file)) {
      removed += 1;
      freed += blob.size;
    }
  }
  console.log(`\nĐã xoá ${removed}/${result.orphan.length} blob mồ côi ≈ ${mb(freed)}.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) main();
