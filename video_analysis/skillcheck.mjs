// Verify SKILL.md files against DSH's real parser components (isSkillName + usix YAML).
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';

const NM = '/home/dzerok/.local/share/mise/installs/node/26.8.2/lib/node_modules/@deepseek-ai/dsh/node_modules';
const { isSkillName } = await import(`file://${NM}/@deepseek-ai/dsh-skill/lib/index.js`);

let parse;
try {
  parse = (await import(`file://${NM}/yaml`)).parse;
} catch (e) {
  const req = createRequire(`file://${NM}/__resolver__.cjs`);
  parse = req('yaml').parse;
}
if (typeof parse !== 'function') throw new Error('no yaml parse fn');

// mirror of dsh-skill-filesystem extractFrontmatter + parseSkillFile checks
const FM = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;
const FORBIDDEN = ['userInvocable', 'disableModelInvocation', 'allowedTools', 'exports'];

const roots = [
  '/home/dzerok/.dsh/skills',
  '/home/dzerok/Documents/deepseek-harness/default-workspace/.agents/skills',
];
let fail = 0, seen = 0;
for (const root of roots) {
  if (!existsSync(root)) { console.log(`SKIP root missing: ${root}`); continue; }
  for (const dir of readdirSync(root)) {
    const p = `${root}/${dir}/SKILL.md`;
    if (!existsSync(p)) continue;
    seen++;
    const text = readFileSync(p, 'utf8');
    const m = FM.exec(text);
    if (!m) { console.log(`FAIL ${p}: no frontmatter block`); fail++; continue; }
    let data;
    try { data = parse(m[1]); } catch (e) { console.log(`FAIL ${p}: yaml error: ${e.message}`); fail++; continue; }
    const errs = [];
    if (typeof data?.name !== 'string') errs.push('name not string');
    else if (!isSkillName(data.name)) errs.push(`name "${data.name}" fails isSkillName`);
    if (typeof data?.description !== 'string' || !data.description.length) errs.push('description missing/not string');
    for (const k of FORBIDDEN) if (k in (data ?? {})) errs.push(`legacy camelCase key "${k}" (would throw → file ignored)`);
    if ('metadata' in (data ?? {}) && (typeof data.metadata !== 'object' || data.metadata === null)) errs.push('metadata not object');
    const body = text.slice(m[0].length).trim();
    if (!body.length) errs.push('empty body');
    if (errs.length) { console.log(`FAIL ${p}: ${errs.join('; ')}`); fail++; }
    else console.log(`PASS ${p}  name="${data.name}" desc=${data.description.length}ch body=${body.length}ch whenToUse=${'whenToUse' in data ? 'yes' : 'no'}`);
  }
}
console.log(`\nCHECKED ${seen} file(s), ${fail} failure(s)`);
process.exit(fail ? 1 : 0);
