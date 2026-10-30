import { posix, win32 } from 'node:path';
import { createUserMessage } from '@deepseek-ai/dsh-llm';

const MAX_TEXT_BYTES = 128 * 1024;
const MAX_PATH_BYTES = 4096;
const MAX_EDITS = 100;
const WARNING = 'ECC payload-only warning (advisory, not policy): the successful JS/TS write/edit payload contains literal console.log. Review whether the logging is intentional before committing. Only submitted new text was inspected; this is not an AST, project scan or Stop hook.';
const GAPS = [
  'Payload-only literal console.log warning, not AST/lint or upstream Stop/git-modified-file scan parity.',
  'Only .js/.jsx/.ts/.tsx; .test/.spec/.config and scripts/__tests__/__mocks__ paths are excluded.',
  'Only submitted new text is scanned for the literal (128KiB, 100 edits, 4096-byte path); native before/after snapshots are validated only for change/receipt binding, each capped at 128KiB.',
  'Native receipts require canonical absolute paths matching normalized absolute inputs; relative inputs, symlink aliases and unknown-before updates are conservatively suppressed without filesystem IO.',
  'Advisory context uses native additionalContexts for the next request; no tool veto, UI alert, Stop continuation or Hindsight write.',
];
const REVIEWED = { Write: ['write', 'ops_write_file'], Edit: ['edit', 'ops_edit_file'] };

function eligiblePath(path) {
  if (typeof path !== 'string' || !path || path.length > MAX_PATH_BYTES || Buffer.byteLength(path, 'utf8') > MAX_PATH_BYTES || /[\u0000-\u001f\u007f]/.test(path)) return false;
  const normalized = path.replaceAll('\\', '/');
  return /\.[jt]sx?$/.test(normalized) && !/\.(?:test|spec|config)\.[jt]sx?$/.test(normalized) && !/(?:^|\/)(?:scripts|__tests__|__mocks__)(?:\/|$)/.test(normalized);
}

function boundedText(value) {
  return typeof value === 'string' && value.length <= MAX_TEXT_BYTES && Buffer.byteLength(value, 'utf8') <= MAX_TEXT_BYTES;
}

function absolutePath(path) {
  if (typeof path !== 'string' || path.length > MAX_PATH_BYTES || Buffer.byteLength(path, 'utf8') > MAX_PATH_BYTES || /[\u0000-\u001f\u007f]/.test(path)) return undefined;
  if (posix.isAbsolute(path)) return posix.normalize(path);
  if (/^[a-z]:[\\/]/i.test(path) || /^\\\\[^\\]+\\[^\\]+(?:\\|$)/.test(path)) return win32.normalize(path).replaceAll('\\', '/');
  return undefined;
}

function nativeChanged(name, args, value) {
  const fields = name === 'write' ? ['path', 'operation', 'before', 'after'] : ['path', 'before', 'after'];
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== fields.length || !fields.every(key => Object.hasOwn(value, key))) return false;
  const target = absolutePath(value.path);
  if (!target || target !== value.path.replaceAll('\\', '/') || target !== absolutePath(args.file_path) || !eligiblePath(value.path) || !boundedText(value.after)) return false;
  if (name === 'write') {
    if (value.after !== args.content.replaceAll('\r\n', '\n')) return false;
    return value.operation === 'create' ? value.before === null : value.operation === 'update' && boundedText(value.before) && value.before !== value.after;
  }
  if (!boundedText(value.before) || value.before === value.after || !boundedText(args.old_string) || (args.replace_all !== undefined && typeof args.replace_all !== 'boolean')) return false;
  const oldText = args.old_string.replaceAll('\r\n', '\n'), newText = args.new_string.replaceAll('\r\n', '\n');
  if (!oldText) return false;
  const parts = value.before.split(oldText), count = parts.length - 1;
  if (!count || (count > 1 && args.replace_all !== true)) return false;
  // Check length before joining: repeated insertions must not allocate beyond the bounded receipt.
  return value.before.length + count * (newText.length - oldText.length) === value.after.length && parts.join(newText) === value.after;
}

function containsConsole(name, args, value) {
  if (!args || typeof args !== 'object' || Array.isArray(args) || args.dryRun === true) return false;
  const ops = name.startsWith('ops_');
  if (ops && (!value || value.status !== 'completed' || value.complete !== true || !Number.isInteger(value.changed) || value.changed <= 0 || value.dryRun !== false || value.error != null || (value.failed != null && value.failed !== 0))) return false;
  if (ops && !eligiblePath(args.path)) return false;
  let texts;
  if (name === 'ops_edit_file') {
    if (!Array.isArray(args.edits) || !args.edits.length || args.edits.length > MAX_EDITS) return false;
    texts = args.edits.map(edit => edit?.newText);
  } else texts = [name === 'edit' ? args.new_string : args.content];
  let bytes = 0;
  for (const item of texts) {
    if (typeof item !== 'string' || item.length > MAX_TEXT_BYTES) return false;
    bytes += Buffer.byteLength(item, 'utf8');
    if (bytes > MAX_TEXT_BYTES) return false;
  }
  if (!ops && !nativeChanged(name, args, value)) return false;
  // shortcut: literal matching includes comments/strings; use a reviewed AST owner if that distinction is needed.
  return texts.some(item => item.includes('console.log'));
}

/** A bounded in-process advisory port; raw upstream Stop:3 remains held. */
export function registerPayloadHooks(ctx, { enableHooks = false, toolMap = {} } = {}) {
  const gaps = [...GAPS];
  const row = { event: 'PostToolUse', nativeEvent: 'tools/post-execute', port: 'console-log-payload', status: 'disabled', toolNames: [] };
  if (enableHooks !== true) return { status: 'disabled', hooks: [row], gaps, disposers: [] };
  for (const role of ['Write', 'Edit']) {
    const name = Object.hasOwn(toolMap, role) ? toolMap[role] : REVIEWED[role][0];
    if (REVIEWED[role].includes(name)) row.toolNames.push(name);
    else gaps.push(`Unsupported ${role} tool mapping; no unreviewed alias or payload shape is inferred.`);
  }
  if (!row.toolNames.length) return { status: 'unavailable', hooks: [{ ...row, status: 'unavailable' }], gaps, disposers: [] };
  const names = new Set(row.toolNames);
  let disposed = false;
  const off = ctx.on('tools/post-execute', async (execution, result, next) => {
    const downstream = await next();
    if (disposed || execution.signal?.aborted || result.isError !== false || downstream.kind !== 'accept' || !names.has(execution.name)) return downstream;
    const value = Object.hasOwn(downstream, 'value') ? downstream.value : result.value;
    if (!containsConsole(execution.name, execution.arguments, value)) return downstream;
    return { ...downstream, additionalContexts: [...(downstream.additionalContexts ?? []), createUserMessage({ source: { kind: 'ecc-payload-console-warning' }, content: [{ type: 'text', text: WARNING }] })] };
  });
  const dispose = () => { if (disposed) return; disposed = true; off(); };
  ctx.effect(() => dispose);
  return { status: 'partial', hooks: [{ ...row, status: 'registered' }], gaps, disposers: [dispose] };
}
