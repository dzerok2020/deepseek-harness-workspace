// dsh-tool-name-normalize — normalize model-issued tool-call names to the
// names this registry actually holds.
//
// OmniRoute (the gateway in front of the `or` provider) rewrites response
// tool-call names to Claude Code capitalization (`bash` -> `Bash`, `read` ->
// `Read`, ...) because it treats Claude-format clients as Claude Code. The
// harness registers its built-in tools in lowercase and resolves a tool call
// by exact name match, so a capitalized name raises
// `ToolNotFoundError: unknown tool "Bash"` and every call fails.
//
// This plugin runs in the `tools/pre-execute` stage — before the registry
// resolves `exec.name` — and rewrites a Claude-cased name to its registered
// lowercase twin when (and only when) that twin is visible in the caller's
// scope. Unknown names are left untouched so a genuine typo still surfaces as
// `unknown tool`.

export const name = 'dsh-tool-name-normalize';

// `exec.agent` scopes the visibility lookup, so depend on the tools service.
export const inject = ['tools'];

/** Turn quickly off without editing config: `DSH_TOOL_NAME_NORMALIZE=off`. */
const OFF_VALUES = new Set(['off', '0', 'false', 'no']);

function isOff() {
  const raw = process.env.DSH_TOOL_NAME_NORMALIZE;
  if (typeof raw !== 'string') return false;
  return OFF_VALUES.has(raw.trim().toLowerCase());
}

/**
 * Resolve the tool name to dispatch.
 *
 * @param name - the name the model asked for.
 * @param resolve - visibility probe: returns truthy iff `name` is callable.
 * @returns `name` unchanged when it resolves, else its lowercase twin when that
 *   resolves, else `name` unchanged (so the registry still reports it).
 */
export function normalizeToolCallName(name, resolve) {
  if (typeof name !== 'string' || name.length === 0) return name;
  if (resolve(name) !== undefined) return name;
  const lower = name.toLowerCase();
  if (lower !== name && resolve(lower) !== undefined) return lower;
  return name;
}

function safeLogger(ctx) {
  const logger = ctx?.logger;
  return {
    info(message) {
      try {
        logger?.info?.(message);
      } catch {
        /* logging must never break a turn */
      }
    },
    warn(message) {
      try {
        logger?.warn?.(message);
      } catch {
        /* ignore */
      }
    },
  };
}

export function apply(ctx) {
  const log = safeLogger(ctx);

  if (isOff()) {
    log.info('[dsh-tool-name-normalize] disabled via DSH_TOOL_NAME_NORMALIZE=off.');
    return;
  }

  let renamed = 0;

  ctx.on(
    'tools/pre-execute',
    (exec, next) => {
      try {
        if (exec !== null && typeof exec === 'object') {
          const target = normalizeToolCallName(exec.name, (candidate) =>
            ctx.tools.get(candidate, exec.agent),
          );
          if (target !== exec.name) {
            renamed += 1;
            log.info(`[dsh-tool-name-normalize] "${exec.name}" -> "${target}" (${renamed} total)`);
            exec.name = target;
          }
        }
      } catch (error) {
        log.warn(
          `[dsh-tool-name-normalize] skipped a call: ${error?.message ?? error}`,
        );
      }
      return next();
    },
    { prepend: true },
  );

  log.info('[dsh-tool-name-normalize] enabled — Claude-cased tool names map to their registered lowercase tools.');
}
