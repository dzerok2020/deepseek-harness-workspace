#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const packPath = new URL('../test/fixtures/harness-eval/task-pack.json', import.meta.url);
const configNames = ['package.json', 'cordis.yml', 'cordis.patch.yml'];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const limits = { transcriptBytes: 1024 * 1024, fileBytes: 64 * 1024, totalFileBytes: 1024 * 1024, files: 100 };

function options(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--allow-live' && !result.allowLive) result.allowLive = true;
    else if (['--task', '--repetition', '--output-dir'].includes(arg) && !result[arg]) {
      if (!argv[i + 1] || argv[i + 1].startsWith('--')) throw Error('Missing option value');
      result[arg] = argv[++i];
    } else throw Error('Unknown or repeated option');
  }
  if (!result.allowLive) throw Error('Live collection blocked without --allow-live; no DSH invoked');
  if (!result['--task'] || !['1', '2'].includes(result['--repetition'])) throw Error('Require --task ID --repetition 1|2');
  return result;
}

function profileConfig(env) {
  const home = path.resolve(env.DSH_HOME || path.join(os.homedir(), '.dsh'));
  const profiles = fs.realpathSync(path.join(home, 'profiles'));
  const profile = path.join(profiles, 'harness-eval');
  if (fs.realpathSync(profile) !== profile) throw Error('Profile directory must not be a symlink');
  const config = configNames.map(name => {
    if (!fs.lstatSync(path.join(profile, name)).isFile()) throw Error('Require regular profile config files');
    return fs.readFileSync(path.join(profile, name));
  });
  const bundles = JSON.parse(config[0]).dsh?.profile?.bundles;
  const patch = config[2].toString('utf8');
  if (!Array.isArray(bundles) || bundles.length !== 2 || bundles[0] !== '@deepseek-ai/dsh-base' || bundles[1] !== '@deepseek-ai/dsh-headless' ||
      !/^\s+apiKeyEnv:\s*OR_API_KEY\s*$/m.test(patch) || !/^\s+mode:\s*read-only\s*$/m.test(patch) || /danger-full-access|workspace-write/.test(patch) ||
      !fs.statSync(path.join(profile, 'node_modules')).isDirectory()) throw Error('Require reviewed base + headless profile with OR_API_KEY and read-only policy');
  return { profile, config, sha256: hash(Buffer.concat(config.flatMap((bytes, i) => [Buffer.from(configNames[i] + '\0'), bytes, Buffer.from('\0')]))) };
}

function sanitizer(key) {
  return text => {
    let value = String(text ?? '');
    if (key) {
      value = value.split(key).join('[REDACTED]').split(JSON.stringify(key).slice(1, -1)).join('[REDACTED]');
    }
    return value.replace(/\bBearer\s+[^\s"']+/gi, 'Bearer [REDACTED]');
  };
}

function snapshot(workspace, sanitize) {
  const files = [];
  let total = 0;
  let truncated = false;
  function visit(directory, prefix = '') {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (files.length >= limits.files || total >= limits.totalFileBytes) { truncated = true; return; }
      const relative = prefix + entry.name;
      const full = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) { files.push({ path: sanitize(relative), status: 'symlink-not-followed' }); continue; }
      if (entry.isDirectory()) { visit(full, relative + '/'); continue; }
      if (!entry.isFile()) continue;
      const size = fs.statSync(full).size;
      const count = Math.min(size, limits.fileBytes, limits.totalFileBytes - total);
      const bytes = Buffer.alloc(count);
      const fd = fs.openSync(full, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      try { fs.readSync(fd, bytes, 0, count, 0); } finally { fs.closeSync(fd); }
      total += count;
      files.push({ path: sanitize(relative), sizeBytes: size, truncated: size > count, content: sanitize(bytes.toString('utf8')) });
    }
  }
  visit(workspace);
  return { files, truncated, limits };
}

// Headless emits per-step totals (including provider attempts) on status/step_end.
// Missing usage in any completed step makes aggregate usage unknown.
function tokenSums(stdout) {
  let input = null, output = null;
  let complete = true;
  for (const line of String(stdout || '').split('\n')) {
    let event;
    try { event = JSON.parse(line); } catch { continue; }
    if (event.type !== 'status' || event.phase !== 'step_end') continue;
    const usage = event.usage;
    if (!usage) { complete = false; continue; }
    const a = usage.inputTokens ?? usage.prompt_tokens;
    const b = usage.outputTokens ?? usage.completion_tokens;
    if (Number.isSafeInteger(a) && a >= 0) input = (input ?? 0) + a;
    else complete = false;
    if (Number.isSafeInteger(b) && b >= 0) output = (output ?? 0) + b;
    else complete = false;
  }
  return complete ? { input, output, total: input === null || output === null ? null : input + output } : { input: null, output: null, total: null };
}

// spawn is injectable only for offline tests; CLI always uses 60000ms and one spawn.
export function collectBaseline(argv, { env = process.env, spawn = spawnSync } = {}) {
  const opts = options(argv);
  const packBytes = fs.readFileSync(packPath);
  const pack = JSON.parse(packBytes);
  const task = pack.tasks.find(item => item.id === opts['--task']);
  if (!task) throw Error('Unknown task ID');
  const source = profileConfig(env);
  const key = env.OR_API_KEY;
  const sanitize = sanitizer(key);
  const startedAt = new Date().toISOString();
  const record = {
    kind: 'baseline-observation', scoring: 'unscored', observational: true,
    taskId: task.id, repetition: Number(opts['--repetition']), taskPackId: pack.id,
    taskPackSha256: hash(packBytes), configSha256: source.sha256,
    startedAt, finishedAt: null, timeMs: null, tokens: { input: null, output: null, total: null }, costUsd: null,
    status: null, exitCode: null, signal: null, captureError: null, captureStatus: 'not-started',
    transcript: { stdout: '', stderr: '', truncated: false }, workspace: null,
    environmentLimitations: ['Reviewed profile remains read-only; file-editing tasks cannot demonstrate implementation quality. Environment restrictions are not agent quality failures.',
      'Config checks are not a full YAML/plugin security audit; inherited provider retry policy is unchanged. Collector makes one invocation and performs no retry.'],
    invocation: { command: 'dsh', profile: 'harness-eval', json: true, timeoutMs: 60000, collectorRetries: 0 }
  };
  let temporary;
  try {
    temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-eval-baseline-'));
    fs.chmodSync(temporary, 0o700);
    const workspace = path.join(temporary, 'workspace');
    fs.mkdirSync(workspace);
    for (const [relative, content] of Object.entries(task.files)) {
      const target = path.resolve(workspace, relative);
      if (!target.startsWith(workspace + path.sep)) throw Error('Unsafe task path');
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content, { flag: 'wx', mode: 0o600 });
    }
    if (['ui-evidence', 'permission-boundary'].includes(task.id)) {
      record.status = 'environment-unavailable';
      record.environmentLimitations.push(task.id === 'ui-evidence' ? 'No pre-provisioned browser page URL is supplied by this collector; no model call.' : 'No evaluator-provisioned safe outside-workspace canary is supplied; no model call.');
    } else {
      if (!key) throw Error('Require inherited OR_API_KEY; credentials are never accepted via arguments or files');
      const isolatedHome = path.join(temporary, 'home');
      const isolatedDsh = path.join(isolatedHome, '.dsh');
      const isolatedProfile = path.join(isolatedDsh, 'profiles/harness-eval');
      fs.mkdirSync(isolatedProfile, { recursive: true });
      source.config.forEach((bytes, i) => fs.writeFileSync(path.join(isolatedProfile, configNames[i]), bytes, { mode: 0o600 }));
      fs.cpSync(fs.realpathSync(path.join(source.profile, 'node_modules')), path.join(isolatedProfile, 'node_modules'), { recursive: true, dereference: true });
      const childEnv = { PATH: env.PATH, OR_API_KEY: key, TERM: 'dumb', HOME: isolatedHome, DSH_HOME: isolatedDsh, DSH_TELEMETRY_DISABLED: '1' };
      const before = performance.now();
      const result = spawn('dsh', ['--profile', 'harness-eval', '--json', task.prompt], {
        cwd: workspace, env: childEnv, input: '', encoding: 'utf8', timeout: 60000, killSignal: 'SIGKILL', maxBuffer: limits.transcriptBytes
      });
      record.timeMs = Math.round(performance.now() - before);
      record.exitCode = result.status ?? null;
      record.signal = result.signal ?? null;
      record.captureError = result.error?.code ?? null;
      record.status = result.error?.code === 'ETIMEDOUT' ? 'timeout' : result.error ? 'capture-error' : result.status === 0 ? 'completed' : 'process-error';
      record.captureStatus = result.error ? 'incomplete' : 'complete';
      record.tokens = result.error ? { input: null, output: null, total: null } : tokenSums(result.stdout);
      record.transcript = { stdout: sanitize(String(result.stdout || '').slice(0, limits.transcriptBytes)), stderr: sanitize(String(result.stderr || '').slice(0, limits.transcriptBytes)), truncated: Boolean(result.error?.code === 'ENOBUFS') || Buffer.byteLength(result.stdout || '') > limits.transcriptBytes || Buffer.byteLength(result.stderr || '') > limits.transcriptBytes };
    }
    record.workspace = snapshot(workspace, sanitize);
    record.finishedAt = new Date().toISOString();
    const output = path.resolve(opts['--output-dir'] || 'vibe-analysis/harness-eval-baseline');
    fs.mkdirSync(output, { recursive: true, mode: 0o700 });
    const artifact = path.join(output, `${task.id}-${record.repetition}-${randomUUID()}.json`);
    fs.writeFileSync(artifact, sanitize(JSON.stringify(record, null, 2)) + '\n', { flag: 'wx', mode: 0o600 });
    return { artifact, record };
  } finally {
    // Only the exact private mkdtemp result is removed, never a caller-supplied path.
    if (temporary && path.dirname(temporary) === os.tmpdir() && path.basename(temporary).startsWith('harness-eval-baseline-')) fs.rmSync(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { artifact, record } = collectBaseline(process.argv.slice(2));
    console.log(`Unscored observational artifact: ${artifact}`);
    process.exitCode = ['completed', 'environment-unavailable'].includes(record.status) ? 0 : 1;
  } catch {
    console.error('Collection blocked: require --allow-live --task ID --repetition 1|2, inherited OR_API_KEY, and reviewed read-only harness-eval profile. No raw diagnostics emitted.');
    process.exitCode = 2;
  }
}
