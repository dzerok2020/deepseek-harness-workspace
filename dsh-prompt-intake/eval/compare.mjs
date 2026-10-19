import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { compare } from './evaluate.mjs';

async function main(args) {
  const flags = new Map();
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i];
    if (!['--baseline', '--candidate'].includes(flag) || flags.has(flag) || !args[i + 1] || args[i + 1].startsWith('--')) {
      throw new Error('Usage: node compare.mjs --baseline FILE --candidate FILE (local JSON arrays only)');
    }
    flags.set(flag, args[i + 1]);
  }
  if (flags.size !== 2) throw new Error('Both --baseline and --candidate are required');
  const paths = [new URL('./scenarios.json', import.meta.url), flags.get('--baseline'), flags.get('--candidate')];
  const contents = await Promise.all(paths.map(path => readFile(path, 'utf8')));
  const report = compare(...contents.map(content => JSON.parse(content)));
  report.inputs = Object.fromEntries(['dataset', 'baseline', 'candidate'].map((name, i) => [name, {
    path: String(paths[i]), sha256: createHash('sha256').update(contents[i]).digest('hex'),
  }]));
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
main(process.argv.slice(2)).catch(error => {
  process.stderr.write(`Evaluation refused: ${error.message}\n`);
  process.exitCode = 1;
});
