#!/usr/bin/env node
import { copyFileSync, existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const MARK = '[dsh-fuzzy-toolname]';
const TAB = String.fromCharCode(9);
const NL = String.fromCharCode(10);
const DEFAULT_TARGET = '/home/dzerok/.local/share/mise/installs/node/26.8.2/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-tools/lib/index.js';

const ORIG_HEAD = TAB + TAB + 'const tool = this.get(name, scope);' + NL + TAB + TAB + 'if (tool === void 0) return void 0;';
const NEW_HEAD = [
  TAB + TAB + '/* ' + MARK + ' */',
  TAB + TAB + 'let lookup = name;',
  TAB + TAB + 'let tool = this.get(lookup, scope);',
  TAB + TAB + 'if (tool === void 0 && lookup !== void 0 && lookup !== null) {',
  TAB + TAB + TAB + 'const wanted = String(lookup).toLowerCase();',
  TAB + TAB + TAB + 'let match;',
  TAB + TAB + TAB + 'for (const candidate of this.view(scope).visible.keys()) {',
  TAB + TAB + TAB + TAB + 'if (String(candidate).toLowerCase() === wanted) { match = candidate; break; }',
  TAB + TAB + TAB + '}',
  TAB + TAB + TAB + 'if (match !== void 0) { lookup = match; tool = this.view(scope).visible.get(match); }',
  TAB + TAB + '}',
  TAB + TAB + 'if (tool === void 0) return void 0;',
].join(NL);
const COLLAPSE_ORIG = TAB + TAB + 'if (this.collapses(name, scope, nested)) return void 0;';
const COLLAPSE_NEW = TAB + TAB + 'if (this.collapses(lookup, scope, nested)) return void 0;';

function countOccurrences(haystack, needle) {
  if (needle.length === 0) return 0;
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

function patch(text) {
  return text.split(ORIG_HEAD).join(NEW_HEAD).split(COLLAPSE_ORIG).join(COLLAPSE_NEW);
}

function unpatch(text) {
  return text.split(NEW_HEAD).join(ORIG_HEAD).split(COLLAPSE_NEW).join(COLLAPSE_ORIG);
}

function isApplied(text) {
  return text.includes(MARK) && text.includes(COLLAPSE_NEW);
}

function extractMethod(text) {
  const start = text.indexOf('resolveExecution(name, scope, nested) {');
  if (start === -1) throw new Error('resolveExecution not found');
  const end = text.indexOf(NL + TAB + '}', start);
  if (end === -1) throw new Error('resolveExecution end not found');
  return text.slice(start, end + NL.length + TAB.length + 1);
}

function assertSupported(text, applied) {
  const head = applied ? NEW_HEAD : ORIG_HEAD;
  const collapse = applied ? COLLAPSE_NEW : COLLAPSE_ORIG;
  const method = extractMethod(text);
  if (countOccurrences(text, head) !== 1 || countOccurrences(text, collapse) !== 1 ||
      countOccurrences(text, MARK) !== (applied ? 1 : 0) ||
      countOccurrences(text, applied ? ORIG_HEAD : NEW_HEAD) !== 0 ||
      countOccurrences(text, applied ? COLLAPSE_ORIG : COLLAPSE_NEW) !== 0 ||
      !method.includes(head) || !method.includes(collapse)) {
    throw new Error('unsupported or drifted fuzzy-toolname anchors; current bundle left unchanged');
  }
}

function syntaxGate(source, target) {
  const checkPath = target.slice(0, -3) + '.dshcheck.mjs';
  writeFileSync(checkPath, source);
  try {
    execFileSync(process.execPath, ['--check', checkPath], { stdio: 'pipe' });
  } finally {
    rmSync(checkPath, { force: true });
  }
}

function verifyBehaviour(text) {
  if (!isApplied(text)) throw new Error('patch marker missing');
  const method = extractMethod(text);
  const build = new Function([
    'class Stub {',
    TAB + 'get(name, scope) { return this.view(scope).visible.get(name); }',
    TAB + 'collapses() { return false; }',
    method,
    TAB + 'view(scope) { return this.__view; }',
    TAB + 'seed(map) { this.__view = { visible: map }; }',
    '}',
    'return new Stub();',
  ].join(NL));
  const stub = build();
  stub.seed(new Map([['bash', { name: 'bash' }], ['read_image', { name: 'read_image' }], ['write', { name: 'write' }]]));
  const cases = [['bash', 'bash'], ['Bash', 'bash'], ['READ_IMAGE', 'read_image'], ['Write', 'write']];
  const results = [];
  for (const pair of cases) {
    const got = stub.resolveExecution(pair[0], undefined, false);
    const name = got === undefined ? null : got.name;
    results.push({ input: pair[0], expected: pair[1], got: name, ok: name === pair[1] });
  }
  const miss = stub.resolveExecution('definitely_absent', undefined, false);
  results.push({ input: 'definitely_absent', expected: null, got: miss === undefined ? null : 'unexpected', ok: miss === undefined });
  return { results, ok: results.every((entry) => entry.ok) };
}

function main() {
  const args = process.argv.slice(2);
  const mode = args.find((entry) => entry.startsWith('--')) ?? '--check';
  const target = args.find((entry) => !entry.startsWith('--')) ?? DEFAULT_TARGET;
  const backup = target + '.dsh-fuzzy-toolname.bak';
  const text = readFileSync(target, 'utf8');
  const applied = isApplied(text);
  if (mode === '--check') {
    console.log(JSON.stringify({
      mode,
      target,
      applied,
      headCount: countOccurrences(text, applied ? NEW_HEAD : ORIG_HEAD),
      collapseCount: countOccurrences(text, applied ? COLLAPSE_NEW : COLLAPSE_ORIG),
      backupExists: existsSync(backup),
    }, null, 2));
    return 0;
  }
  if (mode === '--apply') {
    assertSupported(text, applied);
    if (applied) {
      console.log(JSON.stringify({ mode, target, applied: true, changed: false }, null, 2));
      return 0;
    }
    const patched = patch(text);
    syntaxGate(patched, target);
    if (!existsSync(backup)) copyFileSync(target, backup);
    const temp = target + '.dsh-fuzzy-toolname.tmp';
    writeFileSync(temp, patched);
    renameSync(temp, target);
    console.log(JSON.stringify({ mode, target, applied: true, changed: true, bytesBefore: text.length, bytesAfter: patched.length, backup }, null, 2));
    return 0;
  }
  if (mode === '--revert') {
    // Backups are historical evidence, not a restore source after an upgrade.
    assertSupported(text, applied);
    if (!applied) {
      console.log(JSON.stringify({ mode, target, applied: false, changed: false }, null, 2));
      return 0;
    }
    const original = unpatch(text);
    syntaxGate(original, target);
    const temp = target + '.dsh-fuzzy-toolname.tmp';
    writeFileSync(temp, original);
    renameSync(temp, target);
    console.log(JSON.stringify({ mode, target, applied: false, changed: true }, null, 2));
    return 0;
  }
  if (mode === '--verify') {
    const report = verifyBehaviour(text);
    console.log(JSON.stringify({ mode, target, applied, ok: report.ok, results: report.results }, null, 2));
    return report.ok ? 0 : 1;
  }
  throw new Error('unknown mode: ' + mode);
}

try {
  process.exitCode = main();
} catch (error) {
  console.error(JSON.stringify({ error: String(error && error.message ? error.message : error) }, null, 2));
  process.exitCode = 2;
}
