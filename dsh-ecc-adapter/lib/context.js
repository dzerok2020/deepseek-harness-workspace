import { join } from 'node:path';
import { FileSystemSkillProvider } from '@deepseek-ai/dsh-skill-filesystem';
import { scopeOf } from '@deepseek-ai/dsh-scope';
import { readRules, filterRules } from './inventory.js';

/** Use the first-party skill loader, but keep existing project/user owners ahead of ECC. */
export async function registerEccContext(ctx, config) {
  const disposers = [];
  disposers.push(ctx.skills.registerProvider(control => {
    const provider = new FileSystemSkillProvider(ctx, control, {
      providerName: 'ecc-upstream', includeDefaultRoots: false,
      customSkillDirs: [join(config.eccRoot, 'skills')], watch: false,
    });
    return {
      name: provider.name,
      async list(options) {
        const result = await provider.list(options);
        const candidates = (Array.isArray(result) ? result : result.candidates)
          .filter(candidate => !config.allowedAssets || config.allowedAssets.skills.includes(candidate.name))
          .map(candidate => ({ ...candidate, rank: 1000 }));
        return Array.isArray(result) ? candidates : { ...result, candidates };
      },
      get: (candidate, options) => provider.get(candidate, options),
      dispose: () => provider.dispose(),
    };
  }));

  const entries = (await readRules(config.eccRoot))
    .filter(rule => !config.allowedAssets || config.allowedAssets.rules.includes(rule.name));
  const pathsByScope = new WeakMap();
  const languages = config.ruleLanguages ?? [];
  const maxBytes = config.maxRuleBytes ?? 131072;
  const rules = {
    status: 'native-registered', count: entries.length,
    selection: 'common + configured language or observed file path; language-specific overrides common',
    selected: filterRules(entries, [], languages).map(rule => rule.name),
    maxBytes,
  };
  disposers.push(ctx.on('tools/result', execution => {
    if (!execution.agent?.ctx) return;
    const scope = scopeOf(execution.agent.ctx);
    if (!scope) return;
    const args = execution.arguments;
    if (!args || typeof args !== 'object') return;
    const paths = pathsByScope.get(scope) ?? new Set();
    const observations = [args, ...(Array.isArray(args.files) ? args.files.slice(0, 32) : [])];
    for (const observation of observations) {
      if (!observation || typeof observation !== 'object') continue;
      for (const key of ['path', 'file_path', 'filePath']) {
        if (typeof observation[key] === 'string' && observation[key].length <= 4096) paths.add(observation[key]);
      }
    }
    while (paths.size > 128) paths.delete(paths.values().next().value);
    pathsByScope.set(scope, paths);
  }));
  disposers.push(ctx.systemPrompt.context({
    name: 'ecc-upstream-rules', order: 1500, interpolate: false,
    text({ scope } = {}) {
      const selected = filterRules(entries, scope ? [...(pathsByScope.get(scope) ?? [])] : [], languages);
      const render = (selection, intro = 'ECC upstream rules (supplemental project context). Existing native permissions, user/project instructions and Hindsight ownership remain authoritative. Read common before language-specific overrides.') => [
        intro,
        ...selection.map(rule => `### ECC ${rule.name}\n${rule.content}`),
      ].join('\n\n');
      const text = render(selected);
      if (Buffer.byteLength(text, 'utf8') <= maxBytes) {
        rules.status = 'native-registered';
        return text;
      }
      const warning = `ECC rules partial: ${maxBytes}-byte budget exceeded; language-specific rules omitted. Common rules retained.`;
      const partial = render(selected.filter(rule => rule.language === 'common'), warning);
      if (Buffer.byteLength(partial, 'utf8') <= maxBytes) {
        rules.status = 'budget-partial';
        return partial;
      }
      rules.status = 'budget-exceeded';
      return `ECC rules unavailable: common upstream content with its warning exceeds the ${maxBytes}-byte context budget. No partial common rule set was injected.`;
    },
  }));
  return {
    skills: { status: 'provider-registered', provider: 'ecc-upstream', collisionPolicy: 'existing project/user/native skills win', resourceBase: 'original upstream skill directory' },
    async observeSkills(names, options = {}) {
      const catalog = await ctx.skills.snapshot(options);
      const winners = new Map(catalog.skills.map(skill => [skill.name, skill]));
      const assets = names.map(name => {
        if (!catalog.complete) return { name, status: 'unresolved', reason: 'Skill catalog discovery was incomplete.' };
        const winner = winners.get(name);
        if (!winner) return { name, status: 'unresolved', reason: 'No winning catalog entry was observed.' };
        if (winner.provider === 'ecc-upstream') return { name, status: 'native-registered', owner: winner.provider };
        return { name, status: 'shadowed', owner: winner.provider ?? 'registry-owned' };
      });
      const ownership = (config.ownershipAssets ?? []).map(row => {
        const observed = { kind: row.kind, name: row.name, action: row.action, nativeSkill: row.owner, owner: null, status: 'unresolved' };
        if (!catalog.complete) return { ...observed, reason: 'Skill catalog discovery was incomplete; native ownership is unresolved.' };
        const native = winners.get(row.owner);
        if (native && native.provider !== 'ecc-upstream') return { ...observed, status: 'native-available', owner: row.owner, provider: native.provider };
        if (row.kind === 'skills' && row.name === row.owner && winners.get(row.name)?.provider === 'ecc-upstream') {
          return { ...observed, status: 'ecc-fallback', owner: 'ecc-upstream', reason: 'Same-name ECC fallback is the catalog winner; native equivalence is not asserted in this view.' };
        }
        return { ...observed, status: 'native-unavailable', reason: 'Reviewed native owner is not visible in this workspace/scope; held upstream content remains withheld, not an active equivalent.' };
      });
      return { complete: catalog.complete, cwd: options.cwd ?? process.cwd(), scope: options.scope ? 'agent' : 'global', verification: 'catalog-only; skill execution was not tested', assets, ownership, collisions: assets.filter(asset => asset.status === 'shadowed') };
    },
    rules,
    gaps: ['Rule paths are selected after scoped native file-tool observations, not by undocumented model context inspection.'],
    disposers,
  };
}
