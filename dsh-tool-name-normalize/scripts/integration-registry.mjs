// Integration check against the real ToolRuntime (not part of `node --test`).
//
// Mounts a `systemPrompt` stub + the real `ToolRuntime`, registers a `bash`
// fixture, then calls it as `Bash` with and without this plugin. Proves the
// plugin turns the registry's `unknown tool "Bash"` failure into a successful
// dispatch.
//
//   node scripts/integration-registry.mjs
//
// Override the DSH installation with DSH_NODE_MODULES=<...>/@deepseek-ai.

const base =
  (process.env.DSH_NODE_MODULES ??
    '/home/dzerok/.local/share/mise/installs/node/26.8.2/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai') +
  '/';

const { Context, Service } = await import(base + 'cordis/lib/index.js');
const { default: ToolRuntime, defineContentToolFixture } = await import(
  base + 'dsh-tools/lib/index.js'
);
const { apply: normalizeApply, name: normalizeName, inject: normalizeInject } =
  await import(new URL('../lib/index.js', import.meta.url).href);

class SystemPromptStub extends Service {
  constructor(ctx) {
    super(ctx, 'systemPrompt');
  }
  tools() {
    return () => {};
  }
  section() {
    return () => {};
  }
}

async function run({ withPlugin }) {
  const ctx = new Context();
  await ctx.plugin(SystemPromptStub);
  await ctx.plugin(ToolRuntime);
  await new Promise((r) => setTimeout(r, 20));
  if (withPlugin) {
    await ctx.plugin({ name: normalizeName, inject: normalizeInject, apply: normalizeApply });
  }
  let ran = 0;
  ctx.tools.register(
    defineContentToolFixture({
      name: 'bash',
      description: 'run a command',
      parameters: {},
      execute: async () => {
        ran += 1;
        return [{ type: 'text', text: 'ran' }];
      },
    }),
  );
  const controller = new AbortController();
  const result = await ctx.tools.execute({
    name: 'Bash',
    callId: 'call-1',
    arguments: {},
    signal: controller.signal,
  });
  return { ran, isError: result.isError === true, text: JSON.stringify(result.content) };
}

const withoutPlugin = await run({ withPlugin: false });
const withPlugin = await run({ withPlugin: true });

console.log('WITHOUT plugin:', JSON.stringify(withoutPlugin));
console.log('WITH    plugin:', JSON.stringify(withPlugin));

const ok =
  withoutPlugin.ran === 0 &&
  withoutPlugin.isError === true &&
  withPlugin.ran === 1 &&
  withPlugin.isError === false;

console.log(ok ? 'PASS' : 'FAIL');
process.exit(ok ? 0 : 1);
