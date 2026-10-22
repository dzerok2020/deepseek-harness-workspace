# dsh-tool-name-normalize

Harness plugin that rewrites model-issued tool-call names to the names this
profile actually registers.

## Why

The `or` provider points at OmniRoute. OmniRoute treats Claude-format clients
as Claude Code and rewrites response tool-call names to Claude Code
capitalization (`bash` -> `Bash`, `read` -> `Read`, `skill` -> `Skill`, ...).
The harness registers built-in tools in lowercase and resolves a call by exact
name match, so a capitalized name throws
`ToolNotFoundError: unknown tool "Bash"` and every tool call fails.

## What it does

In the `tools/pre-execute` stage — before the registry resolves `exec.name` —
it probes `ctx.tools.get(name, exec.agent)` and, when the name does not resolve
but its lowercase form does, rewrites `exec.name` to the lowercase tool. Unknown
names are left untouched, so a genuine typo still surfaces as `unknown tool`.

Disable at runtime with `DSH_TOOL_NAME_NORMALIZE=off`.

`tools/pre-execute` runs before `dispatchToolBody` calls
`resolveExecution(exec.name, ...)`, and the execution object is not frozen until
after dispatch, so the rewrite decides what is dispatched. A `{ prepend: true }`
registration makes it run ahead of the other pre-execute listeners.

## Verification

- `node --test test/` covers the pure normalizer.
- An integration check against the real `ToolRuntime` (mount
  `systemPrompt` + `ToolRuntime`, register a `bash` fixture, call it as `Bash`)
  confirms the unpatched registry answers `Error: unknown tool "Bash"` while the
  plugin dispatches the call and runs the body.


## Layout

- `lib/index.js` — plugin entry (`name`, `inject`, `apply`) and the pure
  `normalizeToolCallName(name, resolve)` used by the hook.
- `cordis.patch.yml` — bundle patch that inserts the plugin row.
- `test/` — `node --test` unit tests for the normalizer.
