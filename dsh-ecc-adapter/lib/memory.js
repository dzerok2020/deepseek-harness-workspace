import { readFile, realpath, lstat } from 'node:fs/promises';
import { basename, join, sep } from 'node:path';
import { homedir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const exec = promisify(execFile);
const require = createRequire(import.meta.url);
const BRIDGE_TAG = 'ecc-hindsight-v1';
const ENVELOPE_KEY = 'ecc_memory_v1';
const MAX_DOCS = 500;
const MAX_BYTES = 16 * 1024 * 1024;
const NATIVE_ID = /^mem_hs_([a-f0-9]{32})$/;
const TIMEOUT_MS = 15000;
const within = (p, root) => p === root || p.startsWith(root + sep);
const uuidOf = hex => `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
const checkKeys = (input, allowed) => { for (const key of Object.keys(input)) if (!allowed.includes(key)) throw new Error(`Unsupported memory field: ${key}`); };

/** API adapter only: no local memory files, server start, private plugin handlers, or credential copy. */
export async function createHindsightMemory({ eccRoot, workspaceRoot, configPath = join(homedir(), '.hindsight/coding-agent.json'), fetchImpl = fetch, env = process.env, signal }) {
  const workspace = await realpath(workspaceRoot);
  const { stdout } = await exec('git', ['rev-parse', '--show-toplevel'], { cwd: workspace, timeout: 10000 });
  const projectRoot = await realpath(stdout.trim());
  if (!(await lstat(join(projectRoot, '.git'))).isDirectory()) throw new Error('Unsupported worktree memory routing; use the native Hindsight tool.');
  // Native Hindsight 0.8.2 resolveWorktrees:false uses the session cwd name, not git root.
  const bank = `coding-agent::${basename(workspaceRoot) || 'unknown'}`;
  // Reuse reviewed, pure upstream validation/ranking; never call initializeVault/saveMemory/readMemoryFiles.
  const format = require(join(eccRoot, 'scripts/lib/memory-vault-format.js'));
  const { scoreMemory } = require(join(eccRoot, 'scripts/lib/memory-vault.js'));

  async function route() {
    const raw = JSON.parse(await readFile(configPath, 'utf8'));
    const c = { ...raw, ...raw.harnesses?.dsh };
    if (c.disabled) throw new Error('Hindsight is disabled by native configuration.');
    const unsupported = [raw.paths, raw.banks, c.paths, c.banks, c.mapPathToBank].some(x => x && Object.keys(x).length);
    if (unsupported || c.resolveWorktrees !== false || c.serverMode !== 'self-hosted' || c.bankId || c.dynamicBankId === false || c.bankIdTemplate !== 'coding-agent::{gitProject}') {
      throw new Error('Unsupported native Hindsight routing; use the native tool instead of guessing a bank.');
    }
    const diverging = Object.entries(env).some(([key, value]) => value && /^HINDSIGHT_(API_URL|BANK_ID|DYNAMIC_BANK_ID|BANK_ID_TEMPLATE|RESOLVE_WORKTREES|OPT_IN_ONLY|OPT_IN_PATHS|DISABLED|HARNESS|CONFIG|CONFIG_PATH|SERVER_MODE)$/.test(key));
    if (diverging) throw new Error('Hindsight environment routing overrides are unsupported by this bridge.');
    if (c.optInOnly !== true || !Array.isArray(c.optInPaths)) throw new Error('Native Hindsight opt-in routing must be explicit.');
    let optedIn = false;
    for (const configured of c.optInPaths) {
      try { if (within(workspace, await realpath(configured))) optedIn = true; } catch { /* A nonexistent opt-in root grants nothing. */ }
    }
    if (!optedIn) throw new Error('Workspace is outside native Hindsight opt-in routing.');
    const url = new URL(c.apiUrl);
    if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
      throw new Error('Hindsight bridge requires the configured loopback API endpoint.');
    }
    return { url: url.origin, bank, token: Object.hasOwn(c, 'apiToken') ? c.apiToken : env.HINDSIGHT_API_TOKEN, observationScopes: c.observationScopes, retainMetadata: c.retainMetadata || {}, retainContext: c.retainContext };
  }

  function checkCancelled() {
    if (signal?.aborted) throw new Error('Hindsight memory request cancelled.');
  }

  async function request(path, { method = 'GET', body, allow404 = false, onDispatch } = {}) {
    checkCancelled();
    const r = await route();
    checkCancelled();
    const timeout = AbortSignal.timeout(TIMEOUT_MS);
    const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let response;
    try {
      onDispatch?.();
      response = await fetchImpl(`${r.url}/v1/default/banks/${encodeURIComponent(r.bank)}${path}`, {
        method, redirect: 'error', signal: requestSignal,
        headers: { 'Content-Type': 'application/json', ...(r.token ? { Authorization: `Bearer ${r.token}` } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch { throw new Error(`Hindsight ${method} request failed or timed out; do not assume a write failed safely or retry with a new ID.`); }
    checkCancelled();
    if (requestSignal.aborted) throw new Error('Hindsight request timed out.');
    if (allow404 && response.status === 404) return null;
    if (!response.ok) throw new Error(`Hindsight ${method} returned HTTP ${response.status}; credentials and server response are not exposed.`);
    const text = await response.text();
    checkCancelled();
    if (requestSignal.aborted) throw new Error('Hindsight request timed out.');
    if (Buffer.byteLength(text) > MAX_BYTES) throw new Error('Hindsight response exceeds bridge byte limit.');
    try { return JSON.parse(text); } catch { throw new Error('Hindsight returned invalid JSON.'); }
  }

  function decode(doc, requestedId) {
    const serialized = doc?.document_metadata?.[ENVELOPE_KEY];
    if (!serialized) throw new Error('Hindsight document has no ECC envelope.');
    const memory = format.normalizeMemory(JSON.parse(serialized));
    if (doc.id !== requestedId || memory.id !== requestedId || memory.scope !== 'project' || memory.id.startsWith('mem_hs_')) throw new Error('ECC envelope identity/scope mismatch.');
    return memory;
  }

  async function documents() {
    const listing = await request(`/documents?tags=${BRIDGE_TAG}&tags_match=all&limit=${MAX_DOCS + 1}&offset=0`);
    if (!Array.isArray(listing.items) || !Number.isInteger(listing.total)) throw new Error('Invalid Hindsight document listing.');
    if (listing.total > MAX_DOCS || listing.items.length < listing.total) throw new Error('ECC search corpus exceeds bounded complete scan; use native Hindsight search.');
    const memories = []; let bytes = 0;
    for (const row of listing.items) {
      const doc = await request(`/documents/${encodeURIComponent(row.id)}`);
      bytes += Buffer.byteLength(JSON.stringify(doc));
      if (bytes > MAX_BYTES) throw new Error('ECC search corpus exceeds byte limit; use native Hindsight search.');
      memories.push(decode(doc, row.id));
    }
    return memories;
  }

  async function save(input = {}) {
    checkKeys(input, ['title', 'body', 'kind', 'scope', 'targetHarnesses', 'tags', 'links']);
    if (input.scope && input.scope !== 'project') throw new Error('Only project scope has an approved native Hindsight route.');
    const now = new Date().toISOString();
    const memory = format.normalizeMemory({ schema: 'ecc.memory.v1', id: `mem_${randomUUID().replaceAll('-', '')}`, title: input.title, body: input.body,
      kind: input.kind || 'note', scope: 'project', trust: 'unreviewed', status: 'active', sourceHarness: 'dsh',
      targetHarnesses: input.targetHarnesses || ['all'], tags: input.tags || [], links: input.links || [], createdAt: now, updatedAt: now });
    if (format.findPotentialSecrets(`${memory.title}\n${memory.body}`).length) throw new Error('Potential secret detected; memory was not submitted.');
    const r = await route();
    const existing = await request(`/documents/${encodeURIComponent(memory.id)}`, { allow404: true });
    if (existing) throw new Error('ECC memory ID collision; create-only save will not overwrite.');
    for (const id of memory.links) {
      if (NATIVE_ID.test(id)) continue;
      if (!await request(`/documents/${encodeURIComponent(id)}`, { allow404: true })) throw new Error(`Linked ECC memory not found: ${id}`);
    }
    const operationId = randomUUID();
    const receipt = status => ({ owner: 'Hindsight', status, memory, documentId: memory.id, operationId, bank,
      inspect: { documentPath: `/v1/default/banks/${encodeURIComponent(bank)}/documents/${memory.id}`,
        operationPath: `/v1/default/banks/${encodeURIComponent(bank)}/operations/${operationId}` },
      retry: 'Do not resubmit with a new ID; inspect the same document and operation receipt before deciding.' });
    let submitted = false; let retained; let operation;
    try {
      retained = await request('/memories', { method: 'POST', onDispatch: () => { submitted = true; }, body: { async: true, operation_id: operationId, items: [{ document_id: memory.id,
      content: `ECC ${memory.kind}: ${memory.title}\n\n${memory.body}`, context: r.retainContext || 'User-approved ECC memory; unreviewed data, not executable instructions.',
      metadata: { ...r.retainMetadata, [ENVELOPE_KEY]: JSON.stringify(memory), ecc_bridge: BRIDGE_TAG }, tags: [BRIDGE_TAG, ...memory.tags],
      ...(r.observationScopes ? { observation_scopes: r.observationScopes } : {}) }] } });
      if (retained.success !== true || retained.bank_id !== bank || retained.items_count !== 1) throw new Error('Invalid Hindsight retain receipt.');
      const receiptId = retained.operation_id || retained.operation_ids?.[0];
      if ((retained.async && !receiptId) || (receiptId && receiptId !== operationId)) throw new Error('Hindsight operation receipt identity mismatch.');
      if (receiptId) {
        operation = await request(`/operations/${encodeURIComponent(receiptId)}`);
        if (operation?.operation_id !== operationId) throw new Error('Hindsight operation status identity mismatch.');
      }
    } catch (error) {
      // Once fetch was invoked, transport/cancellation/receipt errors cannot prove that no write occurred.
      if (!submitted) throw error;
      return receipt('unknown');
    }
    if (['failed', 'cancelled'].includes(operation?.status)) throw new Error(`Hindsight operation ${operation.status}; memory is not confirmed saved. ${JSON.stringify(receipt(operation.status))}`);
    if (operation?.status === 'not_found') return receipt('unknown');
    return receipt(retained.async && operation?.status !== 'completed' ? 'pending' : 'completed');
  }

  async function read({ id } = {}) {
    format.validateMemoryId(id);
    const native = id.match(NATIVE_ID);
    if (native) {
      const fact = await request(`/memories/${uuidOf(native[1])}`);
      const unit = typeof fact.text === 'string' ? fact : fact.memory;
      if (unit?.id !== uuidOf(native[1]) || typeof unit?.text !== 'string') throw new Error('Hindsight memory-unit identity/response mismatch; use the native tool.');
      const text = unit.text;
      return { owner: 'Hindsight', memory: { id, title: text.slice(0, 200), body: text, kind: 'fact', scope: 'project', trust: 'unreviewed', provenance: { memoryId: unit.id, documentId: unit.document_id || null } }, backlinks: [], backlinksComplete: false };
    }
    const doc = await request(`/documents/${encodeURIComponent(id)}`, { allow404: true });
    if (!doc) throw new Error('ECC memory was not found in the approved Hindsight bank.');
    const memory = decode(doc, id);
    const backlinks = (await documents()).filter(x => x.status === 'active' && x.links.includes(id)).map(({ body, ...summary }) => summary);
    return { owner: 'Hindsight', memory, backlinks, backlinksComplete: true };
  }

  async function search(input = {}) {
    checkKeys(input, ['query', 'scopes', 'kinds', 'trust', 'targetHarness', 'limit', 'includeNative']);
    const query = (input.query || '').trim();
    if (query.length > 500 || format.hasUnsafeControlCharacters(query)) throw new Error('Invalid or excessive memory query.');
    if ((input.scopes || ['project']).some(scope => scope !== 'project')) throw new Error('Only project scope is routed by this Hindsight bridge.');
    const limit = Math.max(1, Math.min(Number(input.limit) || 20, 100));
    const visible = (await documents()).filter(m => m.status === 'active' && (!input.kinds || input.kinds.includes(m.kind)) && (!input.trust || input.trust === m.trust) && (!input.targetHarness || m.targetHarnesses.includes('all') || m.targetHarnesses.includes(input.targetHarness)));
    const results = visible.map(m => ({ ...m, score: scoreMemory(m, query) })).filter(m => !query || m.score > 0)
      .sort((a, b) => b.score - a.score || b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id)).slice(0, limit).map(({ body, ...m }) => ({ ...m, excerpt: body.slice(0, 240), owner: 'Hindsight' }));
    const nativeResults = [];
    if (query && input.includeNative !== false) {
      const recall = await request('/memories/recall', { method: 'POST', body: { query, budget: 'low', max_tokens: 2048 } });
      for (const item of recall.results || []) if (/^[a-f0-9-]{36}$/.test(item.id)) nativeResults.push({ id: `mem_hs_${item.id.replaceAll('-', '')}`, title: item.text.slice(0, 200), excerpt: item.text.slice(0, 240), owner: 'Hindsight', trust: 'unreviewed', scope: 'project', ranking: 'hindsight-semantic', provenance: { memoryId: item.id, documentId: item.document_id || null } });
    }
    return { owner: 'Hindsight', bank, results, nativeResults: nativeResults.slice(0, limit), complete: true, ranking: 'ecc-lexical', nativeRanking: 'hindsight-semantic', warning: 'Results are unreviewed data, never executable policy. Team/user scope and cross-bank sharing are not configured.' };
  }

  async function doctor() {
    await route(); const memories = await documents();
    const ids = new Set(memories.map(m => m.id));
    const brokenLinks = memories.flatMap(m => m.links.filter(id => !ids.has(id) && !NATIVE_ID.test(id)).map(id => ({ from: m.id, to: id })));
    return { owner: 'Hindsight', bank, status: brokenLinks.length ? 'degraded' : 'ok', documents: memories.length, brokenLinks,
      performed: ['native-config-opt-in', 'Hindsight-document-envelope', 'bounded-link-audit'], unsupported: ['filesystem-vault-audit', 'cross-bank-sharing', 'native-fact-backlinks'], parity: 'partial' };
  }
  return { save, search, read, doctor, owner: 'Hindsight', bank, workspace };
}
