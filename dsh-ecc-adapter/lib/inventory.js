import { readFile, readdir, realpath } from 'node:fs/promises';
import { join, relative, matchesGlob } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parse } from 'yaml';

const exec = promisify(execFile);
const languageExtensions = {
  typescript: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'],
  python: ['.py'], golang: ['.go'], rust: ['.rs'], swift: ['.swift'],
  kotlin: ['.kt', '.kts'], java: ['.java'], php: ['.php'],
  cpp: ['.c', '.h', '.cc', '.cpp', '.hpp'], ruby: ['.rb'],
  elixir: ['.ex', '.exs'], csharp: ['.cs'], web: ['.html', '.css', '.scss'],
};

async function markdownFiles(root, recursive = false) {
  const result = [];
  for (const entry of (await readdir(root, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(root, entry.name);
    if (entry.isFile() && entry.name.endsWith('.md')) result.push(path);
    else if (recursive && entry.isDirectory()) result.push(...await markdownFiles(path, true));
  }
  return result;
}

export function splitFrontmatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (!match) return { metadata: {}, content: text };
  const metadata = parse(match[1]);
  return { metadata: metadata && typeof metadata === 'object' ? metadata : {}, content: text.slice(match[0].length) };
}

export async function readInventory(eccRoot) {
  let root;
  try { root = await realpath(eccRoot); }
  catch (error) { throw new Error(`ECC source is unavailable: ${eccRoot}`, { cause: error }); }
  const assets = { skills: [], commands: [], agents: [], rules: [], hooks: [], mcp: [] };
  for (const entry of (await readdir(join(root, 'skills'), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue;
    const path = join(root, 'skills', entry.name, 'SKILL.md');
    try { await readFile(path); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    assets.skills.push({ name: entry.name, path, status: 'source-present' });
  }
  for (const kind of ['commands', 'agents', 'rules']) {
    const base = join(root, kind);
    for (const path of await markdownFiles(base, kind === 'rules')) {
      if (relative(base, path) === 'README.md') continue;
      assets[kind].push({ name: relative(base, path).replace(/\.md$/, ''), path, status: 'source-present' });
    }
  }
  const config = JSON.parse(await readFile(join(root, 'hooks/hooks.json'), 'utf8'));
  for (const [event, groups] of Object.entries(config.hooks ?? {})) {
    for (const [groupIndex, group] of groups.entries()) {
      for (const [index, hook] of (group.hooks ?? []).entries()) {
        assets.hooks.push({ ...hook, name: `${event}/${groupIndex}/${index}`, event, matcher: group.matcher, status: 'source-present' });
      }
    }
  }
  const mcp = JSON.parse(await readFile(join(root, 'mcp-configs/mcp-servers.json'), 'utf8'));
  for (const name of Object.keys(mcp.mcpServers ?? {})) {
    assets.mcp.push({ name, status: 'disabled', reason: 'Selected servers require separate configuration and credential review.' });
  }
  let revision = null;
  try { revision = (await exec('git', ['-C', root, 'rev-parse', 'HEAD'])).stdout.trim(); }
  catch (error) { if (error.code !== 128) throw error; }
  return { root, revision, counts: Object.fromEntries(Object.entries(assets).map(([kind, items]) => [kind, items.length])), assets };
}

export async function readRules(eccRoot) {
  const root = join(eccRoot, 'rules');
  const entries = [];
  for (const path of await markdownFiles(root, true)) {
    const name = relative(root, path).replace(/\.md$/, '');
    if (!name.includes('/')) continue;
    const content = await readFile(path, 'utf8');
    const { metadata } = splitFrontmatter(content);
    entries.push({ name, path, content, language: name.split('/')[0], patterns: Array.isArray(metadata.paths) ? metadata.paths.filter(p => typeof p === 'string') : [] });
  }
  return entries;
}

export function filterRules(entries, paths = [], languages = []) {
  return entries.filter(({ language, patterns }) => language === 'common' || languages.includes(language) || (patterns.length > 0
    ? paths.some(file => patterns.some(pattern => matchesGlob(file.replaceAll('\\', '/'), pattern)))
    : paths.some(file => (languageExtensions[language] ?? []).some(ext => file.endsWith(ext)))))
    .sort((a, b) => Number(b.name.startsWith('common/')) - Number(a.name.startsWith('common/')) || a.name.localeCompare(b.name));
}

export async function selectRules(eccRoot, paths = [], languages = []) {
  return filterRules(await readRules(eccRoot), paths, languages);
}
