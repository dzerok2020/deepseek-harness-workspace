import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { scopeOf } from '@deepseek-ai/dsh-scope';
import { splitFrontmatter } from './inventory.js';

const defaultToolMap = {
  Read: 'read', Write: 'write', Edit: 'edit', Grep: 'grep', Glob: 'glob', Bash: 'bash',
  WebSearch: 'web_search', WebFetch: 'web_fetch', AskUserQuestion: 'ask_user_question',
};
const externalRuntime = /codeagent-wrapper|ccg-workflow|astra-review\.(?:js|py)|\$\{CLAUDE_PLUGIN_ROOT\}|~\/\.claude\/|\b(?:codex\s+exec|claude\s+-p|gemini\s+-p)\b/i;

function nativeModel(requested, modelMap) {
  const mapped = modelMap?.[requested];
  if (mapped !== undefined && (typeof mapped !== 'string' || !mapped.trim())) {
    throw new Error('modelMap must contain native model IDs only; provider overrides are unsupported');
  }
  return { requested: requested ?? null, mode: mapped === undefined ? 'inherit-current' : 'native-model', nativeModel: mapped ?? null, provider: 'current' };
}

function sourceTools(value) {
  if (value === undefined) throw new Error('Agent has no explicit tool restriction; refusing an unrestricted preset');
  const tools = typeof value === 'string' ? value.split(',').map(tool => tool.trim()).filter(Boolean) : value;
  if (!Array.isArray(tools) || tools.some(tool => typeof tool !== 'string' || !tool.trim())) {
    throw new Error('Agent tools must be a comma-separated string or a list of tool names');
  }
  return [...new Set(tools)];
}

function mapTools(requested, toolMap, tools, scope) {
  const mapped = requested.flatMap(tool => {
    const target = Object.hasOwn(toolMap ?? {}, tool) ? toolMap[tool] : defaultToolMap[tool];
    if (target === undefined) throw new Error(`No native mapping for tool ${tool}`);
    const names = Array.isArray(target) ? target : [target];
    if (!names.length || names.some(name => typeof name !== 'string' || !name || name === 'run_code')) {
      throw new Error(`Invalid native mapping for tool ${tool}`);
    }
    for (const name of names) if (!tools.get(name, scope)) throw new Error(`Native tool ${name} required by ${tool} is unavailable in this scope`);
    return names;
  });
  return [...new Set(mapped)];
}

// The preset loader loads this same module. These contributions belong only to
// that preset's scope, not to the adapter or the global harness.
export const name = 'ecc-agent-persona';
export const inject = ['tools', 'systemPrompt'];
export function apply(ctx, config) {
  const allowed = new Set(config.tools);
  ctx.systemPrompt.section({
    name: 'ecc-agent-persona', order: 0, interpolate: false,
    text: `${config.prompt}\n\n[ECC native adapter]\n${config.model.requested ?? 'unspecified'} → ${config.model.nativeModel ?? 'current native model'}; provider is inherited from the current native request. ECC model aliases do not imply model equivalence.`,
  });
  // PTC's reserved run_code cannot be restricted; opt into native presentation
  // so it cannot tunnel a call outside the ECC allowlist.
  ctx.tools.presentAs('native');
  ctx.tools.restrict({ allow: config.tools });
  ctx.tools.guard(execution => allowed.has(execution.name) ? undefined : `ECC preset denies tool ${execution.name}`);
  ctx.on('system-prompt/assemble', async (assembly, _context, next) => {
    const result = await next();
    return { ...result, tools: result.tools.filter(tool => allowed.has(tool.name)) };
  });
  if (config.model.nativeModel !== null) {
    ctx.on('agent/request', async (_payload, next) => ({ ...await next(), model: config.model.nativeModel }));
  }
}

/** Register pinned ECC prompt commands and scoped native Agent presets. */
export async function registerNativeAssets(ctx, config) {
  const result = { commands: [], agents: [], collisions: [], unsupported: [], disposers: [] };
  const scope = scopeOf(ctx);
  const commands = ctx.get('commands');
  const presets = ctx.get('agentPresets');
  const tools = ctx.get('tools');
  const systemPrompt = ctx.get('systemPrompt');

  for (const kind of ['commands', 'agents']) {
    const directory = join(config.eccRoot, kind);
    const entries = (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.md') || entry.name === 'README.md') continue;
      const asset = { kind, name: entry.name.slice(0, -3), path: join(directory, entry.name), nativeName: `ecc-${entry.name.slice(0, -3)}`, status: 'unsupported' };
      result[kind].push(asset);
      try {
        const { metadata, content } = splitFrontmatter(await readFile(asset.path, 'utf8'));
        if (!/^[a-z][a-z0-9-]*$/.test(asset.nativeName)) throw new Error('Asset name is not a valid native ecc- identifier');
        if (!content.trim()) throw new Error('ECC document has no prompt body');
        if (externalRuntime.test(content)) throw new Error('ECC prompt requires an external CLI or host-specific runtime; native execution is not equivalent');
        const description = typeof metadata.description === 'string' ? metadata.description : `ECC ${asset.name}`;

        if (kind === 'commands') {
          if (!commands) throw new Error('Native commands service is unavailable');
          const unsupportedKeys = ['allowed-tools', 'model', 'context', 'agent', 'hooks', 'disable-model-invocation'].filter(key => metadata[key] !== undefined);
          if (unsupportedKeys.length) throw new Error(`Command metadata has no equivalent in a queued native message: ${unsupportedKeys.join(', ')}`);
          if (commands.find(scope ?? {}, asset.nativeName)) {
            asset.status = 'collision';
            asset.reason = 'Native command already exists; existing registration kept';
            result.collisions.push(asset);
            continue;
          }
          const dispose = commands.register({
            name: asset.nativeName, description, input: { hint: typeof metadata['argument-hint'] === 'string' ? metadata['argument-hint'] : '<arguments>' },
            handler({ agent, rawInput, signal }) {
              if (signal.aborted) return { kind: 'error', text: 'ECC command was cancelled before enqueue' };
              if (typeof agent.followup !== 'function') return { kind: 'error', text: 'Native Agent.followup inbox seam is unavailable; no ECC prompt was queued' };
              const expanded = content.replaceAll('$ARGUMENTS', () => rawInput);
              const prompt = `${expanded}\n\n[ECC command /${asset.nativeName}; arguments follow verbatim]\n${rawInput}`;
              agent.followup(createUserMessage({ content: [{ type: 'text', text: prompt }], source: { kind: 'user' } }));
              return { kind: 'success', text: `Queued /${asset.nativeName} on the current native Agent; normal approval policies remain in effect.` };
            },
          });
          result.disposers.push(dispose);
        } else {
          if (!presets || !tools || !systemPrompt) throw new Error('Native agentPresets, tools and systemPrompt services are required');
          const requested = sourceTools(metadata.tools);
          const native = mapTools(requested, config.toolMap, tools, scope);
          asset.tools = { requested, native };
          asset.model = nativeModel(metadata.model, config.modelMap);
          const unsupportedKeys = ['disallowedTools', 'permissionMode', 'hooks', 'mcpServers', 'isolation', 'background'].filter(key => metadata[key] !== undefined);
          if (unsupportedKeys.length) throw new Error(`Agent metadata has no verified native equivalent: ${unsupportedKeys.join(', ')}`);
          const dispose = await presets.register({
            id: asset.nativeName, name: `ECC / ${metadata.name ?? asset.name}`, description,
            plugins: [{ name: import.meta.url, config: { prompt: content, tools: native, model: asset.model } }],
          });
          try {
            const ready = await presets.resolve(asset.nativeName);
            if (ready.broken) throw new Error(`Native preset activation failed: ${ready.broken}`);
          } catch (error) {
            await dispose();
            throw error;
          }
          result.disposers.push(dispose);
        }
        asset.status = 'registered';
      } catch (error) {
        asset.reason = error instanceof Error ? error.message : String(error);
        if (kind === 'agents' && asset.reason === `Duplicate agent preset: ${asset.nativeName}`) {
          asset.status = 'collision';
          result.collisions.push(asset);
        } else {
          result.unsupported.push(asset);
        }
      }
    }
  }
  return result;
}
