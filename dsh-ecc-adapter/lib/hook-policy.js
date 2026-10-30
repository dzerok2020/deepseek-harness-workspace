import { createHash } from 'node:crypto';

const SOURCE_REVISION = 'b92f181b3b748d1abbc2afd94af6aa7d8c8fca29';
// Evidence paths prefixed ecc: are relative to the pinned ECC root; workspace:
// paths are relative to this workspace; native: paths name the installed public
// package and declaration. Ownership is not feature equivalence.
const policy = (id, fingerprint, classification, reason, dependencies, evidence, candidate = false) => ({
  id, fingerprint, classification, reason, dependencies: Object.freeze(dependencies), evidence: Object.freeze(evidence), candidate,
});

/** Audited manifest-entry granularity: mixed dispatchers are never split implicitly. */
export const HOOK_POLICY = Object.freeze([
  policy('PreToolUse:0:0', '0c9573707f812899065716ce7b96297a587ca3d89f1d8e1d965f26b52683df63', 'native-owned',
    'Native monotonic tool guards own admission. The mixed Bash dispatcher also runs tmux, commit and GateGuard checks; native protection is not equivalent to those checks.',
    ['native-monotonic-guard', 'native-approval-policy'], ['ecc:scripts/hooks/bash-hook-dispatcher.js:22-51', 'workspace:dsh-vibe-guard/lib/index.js:95-104']),
  policy('PreToolUse:1:0', '65237e66cdac9d7aed31107f9859377d15cfa67f56e08d75749ffdf149ead051', 'native-owned',
    'Native admission policy owns PowerShell execution; it is not equivalent to ECC fact-forcing. GateGuard additionally requires project and session evidence state.',
    ['native-monotonic-guard', 'reviewed-project-snapshot', 'gateguard-session-evidence'], ['ecc:scripts/hooks/gateguard-fact-force.js:3-19', 'ecc:scripts/hooks/gateguard-fact-force.js:1448-1485', 'workspace:dsh-vibe-guard/lib/index.js:95-104']),
  policy('PreToolUse:2:0', 'c707db3a0b9f3af61401cf3c7bc14bbe64a0e287706f54680c61626c495140be', 'ecc-supplement',
    'Payload-only ad-hoc documentation filename warning; no project read, formatter, transcript, network or learned-memory dependency. Native context is queued for the next pre-step, not UI or same-step parity.',
    ['contained-runner', 'native-monotonic-guard', 'native-pre-tool-context'], ['ecc:scripts/hooks/doc-file-warning.js:21-40', 'ecc:scripts/hooks/doc-file-warning.js:47-69'], true),
  policy('PreToolUse:3:0', 'ed4b2282cf730c10216fb5fe00d5e8527ff78eef91e6b014351ffcb8591381db', 'native-owned',
    'DSH owns compaction. ECC counts tools and reads Claude transcript usage thresholds; native compaction is not equivalent to these counters or transcript signals.',
    ['native-compaction-owner', 'claude-usage-transcript'], ['ecc:scripts/hooks/suggest-compact.js:7-23', 'ecc:scripts/hooks/suggest-compact.js:35-45', 'native:@deepseek-ai/dsh-compaction/lib/types/index.d.ts:1-7']),
  policy('PreToolUse:4:0', '497de42a0a88765fdf70782b871a519af5fd924307d2554cbc510dae83425c29', 'memory-redirect',
    'Suppress continuous-learning observation. Hindsight is the sole memory owner; redirect requires a separately reviewed explicit Hindsight workflow, not automatic ingestion or observer startup.',
    ['explicit-hindsight-workflow'], ['ecc:scripts/hooks/observe-runner.js:4-10', 'ecc:skills/continuous-learning-v2/hooks/observe.sh:156-166']),
  policy('PreToolUse:5:0', '2e9559a33b256d083425cc1693ddfff914838f4e12f3484cd28ef901ab240b87', 'ecc-supplement',
    'Governance capture is opt-in telemetry including secret and policy detection. Hold pending redaction and state-sink review; native destructive-command guards are not a substitute for secret detection.',
    ['contained-runner', 'redacted-governance-sink', 'reviewed-state-backend'], ['ecc:scripts/hooks/governance-capture.js:3-17', 'ecc:scripts/hooks/governance-capture.js:294-294']),
  policy('PreToolUse:6:0', '88cf1a29f2d07bac1466ccbe54a24adf6131bfe3614b1b01009bf03eff14ce04', 'ecc-supplement',
    'Config protection needs lstat of the real target to distinguish first creation from weakening existing formatter/linter config. An empty isolated workspace would silently allow; native guards are not equivalent.',
    ['contained-runner', 'native-monotonic-guard', 'reviewed-project-snapshot'], ['ecc:scripts/hooks/config-protection.js:3-11', 'ecc:scripts/hooks/config-protection.js:158-185']),
  policy('PreToolUse:7:0', '73d19ebeaee04302e41de225b53b5b5b7d14d9129dcd37469bd993d7ca908b9e', 'native-owned',
    'DSH owns its MCP clients. ECC probes Claude MCP configuration and may reconnect with subprocess/network access; native ownership is not equivalent to ECC health-cache or reconnect behavior.',
    ['native-mcp-owner', 'claude-mcp-configuration', 'network-reconnect'], ['ecc:scripts/hooks/mcp-health-check.js:4-20', 'ecc:scripts/hooks/mcp-health-check.js:57-91', 'native:@deepseek-ai/dsh-mcp-client/lib/types/index.d.ts:1-10']),
  policy('PreToolUse:8:0', '83bf30ab60ba6f6ab260e3a56203417ae69ae43db40a2e8ffeb0bf7de1fdae8d', 'native-owned',
    'Native guards own file admission; this is not equivalent to GateGuard first-touch facts. Project classification and per-session evidence would need a separate reviewed port.',
    ['native-monotonic-guard', 'reviewed-project-snapshot', 'gateguard-session-evidence'], ['ecc:scripts/hooks/gateguard-fact-force.js:3-19', 'ecc:scripts/hooks/gateguard-fact-force.js:217-222', 'workspace:dsh-vibe-guard/lib/index.js:95-104']),
  policy('PreToolUse:9:0', '6f630a14af5d59982ff387b1841a28c132f93243c81c5616105175975576cf2e', 'ecc-supplement',
    'Hookify needs trusted project-local .claude rules and git tracking evidence. Empty contained project state is not rule enforcement; do not enable until those inputs have a reviewed binding.',
    ['contained-runner', 'native-monotonic-guard', 'reviewed-hookify-rules', 'reviewed-project-snapshot'], ['ecc:scripts/hooks/hookify-runtime.js:3-7', 'ecc:scripts/hooks/hookify-runtime.js:285-316', 'ecc:scripts/hooks/hookify-runtime.js:337-374']),
  policy('UserPromptSubmit:0:0', 'cac3e783613053b43715729e027004347bb011910b8030da836526701a56ad54', 'ecc-supplement',
    'Prompt Hookify needs the same trusted project rule binding and native prompt rejection/context seam. No rules in the isolated workspace must not be presented as enforcement.',
    ['contained-runner', 'native-prompt-context', 'reviewed-hookify-rules', 'reviewed-project-snapshot'], ['ecc:scripts/hooks/hookify-runtime.js:32-40', 'ecc:scripts/hooks/hookify-runtime.js:285-316']),
  policy('PreCompact:0:0', 'd21ed0ed7a7c8e13eee4f3e1d6a6a7770529c01b76abec2a7edfa89270ca71e2', 'memory-redirect',
    'Hindsight owns continuity. Suppress ECC transcript summaries and optional LLM calls; a true public pre-compaction seam is also absent. No synthetic event or automatic memory redirect.',
    ['explicit-hindsight-workflow', 'true-precompact-event', 'claude-transcript'], ['ecc:scripts/hooks/pre-compact.js:3-18']),
  policy('SessionStart:0:0', 'effb3e159f147cde69118dfd25da97f6368533ca4314efe700756b4313a1e66e', 'memory-redirect',
    'Mixed session bootstrap restores ECC summaries, learned skills and observer leases. Hindsight owns memory; suppress the whole entrypoint rather than accidentally start learning while retaining ancillary setup.',
    ['explicit-hindsight-workflow', 'claude-session-storage'], ['ecc:scripts/hooks/session-start-bootstrap.js:19-26', 'ecc:scripts/hooks/session-start.js:3-9', 'ecc:scripts/hooks/session-start.js:25-28']),
  policy('SessionStart:1:0', 'eadbb77d9d853d81d3c96fb977925e9bc72140db6c2f3be08d0b504dd44b13d5', 'host-unsupported',
    'Plan Canvas session surfacing depends on its Claude-profile registry and review workflow, neither exposed by the current native host/contained runner.',
    ['plan-canvas-registry', 'plan-canvas-feedback-bridge'], ['ecc:scripts/hooks/plan-canvas-sessions.js:3-13', 'ecc:scripts/hooks/plan-canvas-sessions.js:22-37']),
  policy('PostToolUse:0:0', '5fc088c7a196be40636e3f864bb9d4478cd2f411afee2dc2cf367f9418d61dd6', 'ecc-supplement',
    'Atomic sync dispatcher mixes Hookify, design checks, edit accumulator, console warnings, governance, activity, metrics and context monitoring. Do not bulk-run or split this command without child-level review.',
    ['contained-runner', 'reviewed-dispatcher-children', 'reviewed-project-snapshot', 'redacted-governance-sink', 'native-usage-projection'], ['ecc:scripts/hooks/posttooluse-dispatcher.js:13-25', 'ecc:scripts/hooks/posttooluse-dispatcher.js:34-51']),
  policy('PostToolUse:1:0', '4f4dabc750801b1477d9a4d8b56aa90f93299b74860b6a1573147ef2fce605d8', 'memory-redirect',
    'Atomic async dispatcher mixes Bash telemetry, quality checks, continuous learning and Skill tracking. Hindsight owns memory; suppress the whole command rather than indirectly execute observation.',
    ['explicit-hindsight-workflow', 'reviewed-dispatcher-children', 'reviewed-project-snapshot', 'claude-skill-tool-payload'], ['ecc:scripts/hooks/posttooluse-dispatcher.js:54-68', 'ecc:scripts/hooks/bash-hook-dispatcher.js:54-69']),
  policy('PostToolUseFailure:0:0', '721facb42fac0254bb34d0548e6abc072a05307d06a560fb7ae0b4c9d6cc7529', 'native-owned',
    'DSH owns MCP failure recovery. ECC Claude-config reconnects require network/CLI authority; native ownership is not equivalent to this cache and reconnect strategy.',
    ['native-mcp-owner', 'claude-mcp-configuration', 'network-reconnect'], ['ecc:scripts/hooks/mcp-health-check.js:4-20', 'ecc:scripts/hooks/mcp-health-check.js:57-91', 'native:@deepseek-ai/dsh-mcp-client/lib/types/index.d.ts:1-10']),
  policy('PostToolUseFailure:1:0', '479204e24b832af9249bf0ddea7a1379c5186d0a1004dee007f341cad7402e5c', 'host-unsupported',
    'Skill-run telemetry assumes the Claude Skill tool and payload identifiers. Native skills are a different public API; no matching invocation/outcome projection has been reviewed.',
    ['claude-skill-tool-payload', 'reviewed-skill-telemetry-sink'], ['ecc:scripts/hooks/skill-run-tracker.js:4-21', 'ecc:scripts/hooks/skill-run-tracker.js:26-35']),
  policy('Stop:0:0', '182a613e8a23cadb83f8bf0f782f4e35a6304ae7bad1b2f0d7f7c596118369d7', 'ecc-supplement',
    'Stop Hookify requires trusted project rules plus native same-turn reentry tracking. Preserve existing native Stop protection; do not claim rule enforcement from an empty contained project.',
    ['contained-runner', 'native-stop-reentry', 'reviewed-hookify-rules', 'reviewed-project-snapshot'], ['ecc:scripts/hooks/hookify-runtime.js:32-40', 'ecc:scripts/hooks/hookify-runtime.js:285-316', 'workspace:dsh-ecc-adapter/lib/hooks.js:289-296']),
  policy('Stop:1:0', '425c1cfed86b709dc3ad01b2122fa0b89dbc473e2be400f247c38aeb1e1e5ecc', 'host-unsupported',
    'Plan Canvas feedback draining needs a project-scoped registry and loopback server outside network-isolated containment; no native bridge is configured.',
    ['plan-canvas-registry', 'plan-canvas-feedback-bridge', 'native-stop-reentry'], ['ecc:scripts/hooks/plan-canvas-pending.js:3-22', 'ecc:scripts/hooks/plan-canvas-pending.js:27-37']),
  policy('Stop:2:0', '380b65408b83766b5209d49d46b0c59d4784e6f2de4c86c2ff968232471a363d', 'ecc-supplement',
    'Batch formatting/typechecking needs the edit accumulator, real project writes and formatter/tsc binaries. Its 270000ms internal budget/300s manifest timeout exceeds the current 60s runner cap; native safety is not formatting parity.',
    ['contained-runner', 'reviewed-project-write', 'reviewed-formatter-binaries', 'reviewed-typescript-project', 'post-edit-accumulator', 'reviewed-long-stop-budget', 'native-stop-reentry'], ['ecc:scripts/hooks/stop-format-typecheck.js:3-14', 'ecc:scripts/hooks/stop-format-typecheck.js:19-39']),
  policy('Stop:3:0', '92e9cf3bca6d0e03f2b927431e25af387ac3cd6e989465625961bc623f21715a', 'ecc-supplement',
    'Console-log warning scans git-modified JS/TS files. It cannot inspect the real project from the empty isolated workspace; hold until a reviewed read-only git/project snapshot exists.',
    ['contained-runner', 'reviewed-project-snapshot', 'reviewed-git-snapshot', 'native-stop-reentry'], ['ecc:scripts/hooks/check-console-log.js:3-17']),
  policy('Stop:4:0', 'd57e495621d47c738a5126f4aed2a94c64b279d28c8c0e87fa75bfb6cd0884e5', 'memory-redirect',
    'Hindsight owns cross-session continuity. Suppress ECC session-file writes, Claude transcript extraction and optional LLM summarization; Stop is not a true SessionEnd event.',
    ['explicit-hindsight-workflow', 'claude-transcript'], ['ecc:scripts/hooks/session-end.js:3-15', 'ecc:scripts/hooks/session-end.js:28-35']),
  policy('Stop:5:0', '2cbae02f7f80eb6fa30837129a6a281d50febc63d3b51d5e219b4c738a838d91', 'memory-redirect',
    'Hindsight is the sole memory owner. ECC evaluator reads Claude transcript and creates a learned-skills directory even when transcript input is unavailable; do not run as a supposedly harmless no-op.',
    ['explicit-hindsight-workflow', 'claude-transcript'], ['ecc:scripts/hooks/evaluate-session.js:3-12', 'ecc:scripts/hooks/evaluate-session.js:44-83']),
  policy('Stop:6:0', '875a70a1dfd6bf9700c27ea171da574ec8fd2bb8a90781cddbeb41bc16752b5f', 'native-owned',
    'Native provider usage accounting owns cost evidence. ECC expects Claude JSONL model/cache usage and writes Claude metrics; ownership is not equivalent to those estimates, and no fabricated transcript is supplied.',
    ['native-usage-owner', 'claude-usage-transcript'], ['ecc:scripts/hooks/cost-tracker.js:3-24', 'native:@deepseek-ai/dsh-session/lib/types/types.d.ts:321-337']),
  policy('Stop:7:0', '0b0bd6a544a0b4b8480e7b889e97de309fde90f025bdc14555a88360b265d6cd', 'host-unsupported',
    'Desktop notification code targets macOS/iTerm2/osascript or WSL PowerShell/BurntToast. The native Linux Web host exposes no reviewed GUI/TTY bridge inside containment.',
    ['reviewed-desktop-os-bridge'], ['ecc:scripts/hooks/desktop-notify.js:3-17', 'ecc:scripts/hooks/desktop-notify.js:22-40']),
  policy('SessionEnd:0:0', '78564bd94bbe03a50c27612bc0b6c86a0e41be3d8a8ca18fe66790c915a99868', 'host-unsupported',
    'No true public SessionEnd seam. This entrypoint also removes observer leases/stops learning observers; never synthesize it from Stop or agent disposal, and keep Hindsight as sole memory owner.',
    ['true-session-end', 'explicit-hindsight-workflow'], ['ecc:scripts/hooks/session-end-marker.js:4-15', 'ecc:scripts/hooks/session-end-marker.js:22-38']),
].map(Object.freeze));

const known = new Map(HOOK_POLICY.map(row => [row.id, row]));
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const keysWithin = (value, keys) => Object.keys(value).every(key => keys.includes(key));
const signature = (event, group, hook) => createHash('sha256').update(JSON.stringify({
  event, matcher: group.matcher ?? null, type: hook.type, command: hook.command,
  async: hook.async ?? false, timeout: hook.timeout ?? null,
})).digest('hex');

/** Pure classification only. Caller capabilities attest existing host mechanisms;
 * they neither grant permissions nor authorize held/memory/native entrypoints.
 * The caller must independently verify source revision and script integrity.
 */
export function classifyHooks(manifest, { sourceRevision, availableCapabilities = [] } = {}) {
  const gaps = [
    'Native ownership does not establish ECC security, fact-forcing, formatter or Claude transcript equivalence.',
    'No host project, HOME or Claude transcript is mounted; held supplements need a separately reviewed port.',
    'Hindsight remains the sole memory owner; classification never invokes memory, LLMs, observers or subprocesses.',
    'Manifest fingerprints bind command metadata, not upstream script bytes; the caller must verify pinned source integrity.',
  ];
  const errors = [];
  if (sourceRevision !== SOURCE_REVISION) errors.push(`ECC source revision must exactly equal ${SOURCE_REVISION}.`);
  const validCapabilities = Array.isArray(availableCapabilities) && availableCapabilities.every(value => typeof value === 'string');
  if (!validCapabilities) errors.push('availableCapabilities must be an explicit array of strings.');
  const capabilities = new Set(validCapabilities ? availableCapabilities : []);
  const entries = new Map();
  const unknown = [];
  if (!object(manifest) || !keysWithin(manifest, ['hooks']) || !object(manifest.hooks)) {
    errors.push('Expected a reviewed hooks manifest object.');
  } else {
    for (const [event, groups] of Object.entries(manifest.hooks)) {
      if (!Array.isArray(groups) || groups.length === 0) { errors.push(`Invalid hook groups: ${event}.`); continue; }
      for (const [groupIndex, group] of groups.entries()) {
        if (!object(group) || !keysWithin(group, ['matcher', 'hooks']) ||
            (group.matcher !== undefined && typeof group.matcher !== 'string') || !Array.isArray(group.hooks) || group.hooks.length === 0) {
          errors.push(`Invalid matcher group: ${event}:${groupIndex}.`); continue;
        }
        for (const [hookIndex, hook] of group.hooks.entries()) {
          const id = `${event}:${groupIndex}:${hookIndex}`;
          if (!object(hook) || !keysWithin(hook, ['type', 'command', 'async', 'timeout']) || hook.type !== 'command' || typeof hook.command !== 'string' ||
              (hook.async !== undefined && typeof hook.async !== 'boolean') || (hook.timeout !== undefined && (!Number.isFinite(hook.timeout) || hook.timeout <= 0))) {
            errors.push(`Invalid or unreviewed command metadata: ${id}.`); continue;
          }
          const fingerprint = signature(event, group, hook);
          entries.set(id, { event, groupIndex, hookIndex, matcher: group.matcher, hook, fingerprint });
          if (!known.has(id)) {
            errors.push(`Unreviewed hook: ${id}.`);
            unknown.push({ id, event, groupIndex, hookIndex, matcher: group.matcher, fingerprint, classification: 'host-unsupported', disposition: 'blocked', reason: 'Unreviewed hook has no approved policy.', dependencies: [], evidence: [], missingCapabilities: [] });
          }
        }
      }
    }
  }
  for (const row of HOOK_POLICY) {
    if (entries.get(row.id)?.fingerprint !== row.fingerprint) errors.push(`Missing or changed reviewed hook: ${row.id}.`);
  }
  const status = errors.length ? 'blocked' : 'reviewed';
  const hooks = HOOK_POLICY.map(row => {
    const [event, groupIndex, hookIndex] = row.id.split(':');
    const entry = entries.get(row.id);
    const missingCapabilities = row.dependencies.filter(capability => !capabilities.has(capability));
    const disposition = status === 'blocked' ? 'blocked' : row.candidate ? (missingCapabilities.length ? 'capability-missing' : 'approved') :
      row.classification === 'ecc-supplement' ? 'review-required' : row.classification === 'memory-redirect' ? 'memory-redirect' :
      row.classification === 'native-owned' ? 'native-owned' : 'unsupported';
    return { ...row, event, groupIndex: Number(groupIndex), hookIndex: Number(hookIndex), matcher: entry?.matcher,
      disposition, missingCapabilities, ...(entry ? { hook: structuredClone(entry.hook) } : {}) };
  });
  hooks.push(...unknown);
  return { status, sourceRevision, hooks, approvedHooks: hooks.filter(row => row.disposition === 'approved'), gaps: [...gaps, ...errors] };
}

/** Re-classify instead of trusting a caller-edited report; return only exact,
 * independently cloned matcher groups that the current policy approves.
 */
export function selectApprovedHooks(manifest, options) {
  const report = classifyHooks(manifest, options);
  const hooks = {};
  for (const row of report.approvedHooks) {
    (hooks[row.event] ??= []).push({ ...(row.matcher === undefined ? {} : { matcher: row.matcher }), hooks: [structuredClone(row.hook)] });
  }
  return { hooks };
}
