import { scopeOf } from '@deepseek-ai/dsh-scope';

const READ_TOOLS = Object.freeze(['ops_read_files', 'ops_grep', 'ops_glob']);
const MEMORY = new Set(['ecc-memory-vault', 'memory', 'omega-memory', 'longhand', 'memxus']);

/** Observe existing native capabilities; never load, call, or configure an MCP. */
export function registerConnectorDiagnostics(ctx, { templates = [] } = {}) {
  let disposed = false;
  const observe = agent => {
    const scope = agent?.ctx ? scopeOf(agent.ctx) : undefined;
    const missing = READ_TOOLS.filter(name => !ctx.tools.get(name, scope));
    return {
      status: disposed ? 'disposed' : 'native-preferred', serversStarted: 0, count: templates.length,
      view: { cwd: agent?.session?.header?.cwd ?? null, scope: scope ? 'agent' : 'global', verification: 'Catalog presence only; no tool call or external server health is inferred.' },
      capabilities: [{ id: 'repository-read-search', template: 'filesystem', owner: 'native-ops',
        tools: [...READ_TOOLS], status: disposed ? 'disposed' : missing.length ? 'capability-missing' : 'native-tools-visible', missing,
        runtimeVerified: false, parity: 'partial-readonly',
        reason: 'Native file reading, literal search and glob discovery are preferred. This is not the filesystem MCP write/transport contract.' }],
      templates: templates.map(({ name }) => ({ name,
        status: MEMORY.has(name) ? 'memory-redirect' : name === 'filesystem' ? 'native-preferred' : 'disabled',
        owner: MEMORY.has(name) ? 'Hindsight' : name === 'filesystem' ? 'native-ops' : null,
        reason: MEMORY.has(name) ? 'Hindsight owns project memory; no alternate server is started.' : name === 'filesystem'
          ? 'Use the current scoped native readonly capability; MCP process remains disabled.'
          : 'No selected use case requiring an additional server, credential, deployment or external service.' })),
    };
  };
  return { observe, disposers: [() => { disposed = true; }] };
}
