import { mkdir, lstat, realpath, readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join, sep } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { scopeOf } from '@deepseek-ai/dsh-scope';
const exec = promisify(execFile);
import Schema from '@deepseek-ai/schemastery';
import { readInventory } from './inventory.js';
import { registerEccContext } from './context.js';
import { registerNativeAssets } from './native-assets.js';
import { registerHooks } from './hooks.js';

export const name = 'dsh-ecc-adapter';
export const inject = ['skills', 'systemPrompt', 'commands', 'tools', 'agentPresets'];
export const Config = Schema.object({
  eccRoot: Schema.string().required(),
  dataRoot: Schema.string().required(),
  expectedRevision: Schema.string(),
  enableHooks: Schema.boolean().default(false),
  ruleLanguages: Schema.array(Schema.string()).default([]),
  maxRuleBytes: Schema.natural().default(131072),
  modelMap: Schema.dict(Schema.string()).default({}),
  toolMap: Schema.dict(Schema.string()).default({}),
});

/** Mount only into the configured host; never change global instructions or other profiles. */
export async function apply(ctx, config) {
  if (!isAbsolute(config.eccRoot ?? '') || !isAbsolute(config.dataRoot ?? '')) {
    throw new Error('eccRoot and dataRoot must be absolute');
  }
  const inventory = await readInventory(config.eccRoot);
  if (config.expectedRevision && inventory.revision !== config.expectedRevision) {
    throw new Error(`ECC revision mismatch: expected ${config.expectedRevision}, received ${inventory.revision}`);
  }
  if (config.expectedRevision) {
    const { stdout } = await exec('git', ['status', '--porcelain=v1', '--untracked-files=normal'], { cwd: config.eccRoot, timeout: 10000, maxBuffer: 1048576 });
    if (stdout.trim()) throw new Error('ECC source is dirty; restore the reviewed upstream revision before activation');
  }
  if (ctx.commands.find(scopeOf(ctx) ?? {}, 'ecc-status')) {
    throw new Error('ecc-status already exists; the existing owner was preserved');
  }
  await mkdir(config.dataRoot, { recursive: true, mode: 0o700 });
  const dataRoot = await realpath(config.dataRoot);
  const sourceRoot = await realpath(config.eccRoot);
  if ((await lstat(config.dataRoot)).isSymbolicLink() || dataRoot === sep || dataRoot === sourceRoot || dataRoot.startsWith(sourceRoot + sep)) {
    throw new Error('Adapter dataRoot must not be a symlink, filesystem root or upstream source directory');
  }
  const disposers = [];
  let disposed = false;
  const cleanup = async () => {
    if (disposed) return;
    disposed = true;
    for (const dispose of disposers.reverse()) await dispose();
  };
  ctx.effect(() => cleanup);
  try {
    const context = await registerEccContext(ctx, config);
    disposers.push(...context.disposers);
    const native = await registerNativeAssets(ctx, config);
    disposers.push(...native.disposers);
    const hooks = await registerHooks(ctx, config);
    disposers.push(...hooks.disposers);
    const statusPath = join(dataRoot, 'status.json');
    const snapshot = () => ({
      adapter: 'dsh-ecc-adapter', version: '0.1.0', status: 'ready-partial', parity: 'partial',
      source: { root: sourceRoot, revision: inventory.revision },
      inventory,
      skills: context.skills,
      rules: context.rules,
      native: { commands: native.commands, agents: native.agents, collisions: native.collisions, unsupported: native.unsupported },
      hooks: { hooks: hooks.hooks, status: hooks.status, gaps: hooks.gaps },
      mcp: { status: 'disabled', count: inventory.counts.mcp, reason: 'Templates are present; credentials and server startup were not authorized.' },
      memory: { status: 'disabled', owner: 'Hindsight', reason: 'No ECC memory, observer or external-model service is started.' },
      gaps: [...context.gaps, ...hooks.gaps,
        'Native agent model aliases inherit the current route unless explicitly mapped; this is not proof of the original Opus/Sonnet behavior.',
        'Registered commands enqueue the original prompt; real model generation and task quality are not verified by registration.',
        'Unsupported and collision entries remain visible and are not silently treated as active.',
      ],
    });
    const save = async (agent) => {
      const status = snapshot();
      const observation = await context.observeSkills(inventory.assets.skills.map(asset => asset.name), { cwd: process.cwd(), scope: agent?.ctx ? scopeOf(agent.ctx) : undefined });
      status.skills = { ...status.skills, observation };
      status.inventory = { ...inventory, assets: { ...inventory.assets, skills: inventory.assets.skills.map((asset, index) => ({ ...asset, ...observation.assets[index] })) } };
      // Observe any prior adapter-owned snapshot before replacing it.
      await readFile(statusPath).catch(error => { if (error.code !== 'ENOENT') throw error; });
      await writeFile(statusPath, JSON.stringify(status, null, 2) + '\n', { mode: 0o600 });
      return status;
    };
    disposers.push(ctx.commands.register({
      name: 'ecc-status', description: 'Show pinned ECC inventory, active native assets and explicit compatibility gaps',
      async handler({ agent }) { return { kind: 'success', text: JSON.stringify(await save(agent), null, 2) }; },
    }));
    await save();
  } catch (error) {
    await cleanup();
    throw error;
  }
}
