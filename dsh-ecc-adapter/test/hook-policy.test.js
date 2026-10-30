import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { HOOK_POLICY, classifyHooks, selectApprovedHooks } from '../lib/hook-policy.js';

const revision = 'b92f181b3b748d1abbc2afd94af6aa7d8c8fca29';
const capabilities = ['contained-runner', 'native-monotonic-guard', 'native-pre-tool-context'];
// Reviewed command strings are inert fixture data. Never import/eval/run ECC scripts.
const resolver = "const p=require('path');const r=(function(){var p=require('path'),f=require('fs'),o=require('os');var e=process.env.CLAUDE_PLUGIN_ROOT;if(e&&e.trim())return e.trim();var d=(process.env.CLAUDE_CONFIG_DIR||'').trim()||p.join(o.homedir(),'.claude');if(d==='~')d=o.homedir();else if(d.charAt(0)==='~'&&(d.charAt(1)==='/'||d.charCodeAt(1)===92))d=p.join(o.homedir(),d.slice(2));d=p.resolve(d);function L(x){try{return require(p.join(x,'scripts','lib','resolve-ecc-root')).resolveEccRoot()}catch(_){return null}}var r=L(d);if(r)return r;var s=['ecc','ecc@ecc','marketplaces/ecc','everything-claude-code','everything-claude-code@everything-claude-code','marketplaces/everything-claude-code'];for(var i=0;i<s.length;i++){r=L(p.join(d,'plugins',s[i]));if(r)return r}function D(x){try{return f.readdirSync(x,{withFileTypes:true}).filter(function(z){return z.isDirectory()}).map(function(z){return z.name})}catch(e){if(e.code==='ENOENT')return [];throw e}}var g=['ecc','everything-claude-code'];for(var j=0;j<g.length;j++){var c=p.join(d,'plugins','cache',g[j]);var O=D(c);for(var k=0;k<O.length;k++){var q=p.join(c,O[k]);var V=D(q);for(var m=0;m<V.length;m++){r=L(p.join(q,V[m]));if(r)return r}}}return d})();";
const plugin = "const s=p.join(r,'scripts/hooks/plugin-hook-bootstrap.js');process.env.CLAUDE_PLUGIN_ROOT=r;process.argv.splice(1,0,s);require(s)";
const post = "const s=p.join(r,'scripts/hooks/posttooluse-dispatcher.js');process.env.CLAUDE_PLUGIN_ROOT=r;process.argv.splice(1,0,s);require(s).cli()";
const lifecycle = "const n=process.platform==='win32'&&r.charAt(0)==='/'&&/[a-zA-Z]/.test(r.charAt(1))&&(r.length===2||r.charAt(2)==='/')?r.charAt(1).toUpperCase()+':/'+r.slice(3):r;const s=p.join(n,'scripts/hooks/lifecycle-hook-bootstrap.js');process.env.CLAUDE_PLUGIN_ROOT=n;if(require('fs').existsSync(s)){process.argv.splice(1,0,s);require(s).cli()}else{process.stderr.write('[Hook] lifecycle bootstrap unavailable; skipping hook'+String.fromCharCode(10))}";
const run = (id, script, profiles = 'standard,strict') => `node scripts/hooks/run-with-flags.js ${id} scripts/hooks/${script}.js ${profiles}`;
const rows = [
  ['PreToolUse', 'Bash', plugin, 'node scripts/hooks/pre-bash-dispatcher.js'],
  ['PreToolUse', 'PowerShell', plugin, run('pre:powershell:gateguard-fact-force', 'gateguard-fact-force'), 5],
  ['PreToolUse', 'Write', plugin, run('pre:write:doc-file-warning', 'doc-file-warning')],
  ['PreToolUse', 'Edit|Write', plugin, run('pre:edit-write:suggest-compact', 'suggest-compact')],
  ['PreToolUse', '.*', plugin, run('pre:observe', 'observe-runner'), 10, true],
  ['PreToolUse', 'Bash|PowerShell|Write|Edit|MultiEdit', plugin, run('pre:governance-capture', 'governance-capture'), 10],
  ['PreToolUse', 'Write|Edit|MultiEdit', plugin, run('pre:config-protection', 'config-protection'), 5],
  ['PreToolUse', '^mcp__', plugin, run('pre:mcp-health-check', 'mcp-health-check')],
  ['PreToolUse', 'Edit|Write|MultiEdit|NotebookEdit', plugin, run('pre:edit-write:gateguard-fact-force', 'gateguard-fact-force'), 5],
  ['PreToolUse', '.*', plugin, run('pre:hookify-runtime', 'hookify-runtime', 'minimal,standard,strict'), 10],
  ['UserPromptSubmit', undefined, plugin, run('prompt:hookify-runtime', 'hookify-runtime', 'minimal,standard,strict'), 10],
  ['PreCompact', '.*', plugin, run('pre:compact', 'pre-compact')],
  ['SessionStart', '.*', plugin, 'node scripts/hooks/session-start-bootstrap.js'],
  ['SessionStart', '.*', plugin, run('session-start:plan-canvas-sessions', 'plan-canvas-sessions')],
  ['PostToolUse', '.*', post, 'sync', 30],
  ['PostToolUse', '.*', post, 'async', 45, true],
  ['PostToolUseFailure', '^mcp__', plugin, run('post:mcp-health-check', 'mcp-health-check')],
  ['PostToolUseFailure', 'Skill', plugin, run('post:skill:track', 'skill-run-tracker')],
  ['Stop', '.*', lifecycle, 'stop:hookify-runtime scripts/hooks/hookify-runtime.js minimal,standard,strict 10000', 10],
  ['Stop', '.*', lifecycle, 'stop:plan-canvas-pending scripts/hooks/plan-canvas-pending.js minimal,standard,strict 30000'],
  ['Stop', '.*', lifecycle, 'stop:format-typecheck scripts/hooks/stop-format-typecheck.js standard,strict 300000', 300],
  ['Stop', '.*', lifecycle, 'stop:check-console-log scripts/hooks/check-console-log.js standard,strict 30000'],
  ['Stop', '.*', lifecycle, 'stop:session-end scripts/hooks/session-end.js minimal,standard,strict 30000', 10, true],
  ['Stop', '.*', lifecycle, 'stop:evaluate-session scripts/hooks/evaluate-session.js minimal,standard,strict 30000', 10, true],
  ['Stop', '.*', lifecycle, 'stop:cost-tracker scripts/hooks/cost-tracker.js minimal,standard,strict 30000', 10, true],
  ['Stop', '.*', lifecycle, 'stop:desktop-notify scripts/hooks/desktop-notify.js standard,strict 30000', 10, true],
  ['SessionEnd', '.*', lifecycle, 'session:end:marker scripts/hooks/session-end-marker.js minimal,standard,strict 30000', 10, true],
];
function manifest() {
  const hooks = {};
  for (const [event, matcher, bootstrap, args, timeout, async] of rows) {
    const hook = { type: 'command', command: `node -e "${resolver}${bootstrap}" ${args}` };
    if (timeout !== undefined) hook.timeout = timeout;
    if (async !== undefined) hook.async = async;
    (hooks[event] ??= []).push({ ...(matcher === undefined ? {} : { matcher }), hooks: [hook] });
  }
  return { hooks };
}
const options = (availableCapabilities = []) => ({ sourceRevision: revision, availableCapabilities });
const ids = classification => HOOK_POLICY.filter(row => row.classification === classification).map(row => row.id);

test('classifies all 27 pinned hooks with immutable bounded evidence and no default execution', () => {
  const input = manifest();
  const before = structuredClone(input);
  const report = classifyHooks(input, options());
  assert.equal(report.status, 'reviewed', report.gaps.join('\n'));
  assert.equal(report.hooks.length, 27);
  assert.equal(new Set(report.hooks.map(row => row.id)).size, 27);
  assert.deepEqual(report.approvedHooks, []);
  assert.deepEqual(input, before);
  assert.deepEqual(selectApprovedHooks(input, options()), { hooks: {} });
  assert.ok(Object.isFrozen(HOOK_POLICY));
  for (const row of HOOK_POLICY) {
    assert.ok(Object.isFrozen(row));
    assert.ok(Object.isFrozen(row.dependencies));
    assert.ok(Object.isFrozen(row.evidence));
    assert.match(row.fingerprint, /^[a-f0-9]{64}$/);
    assert.ok(row.reason.length > 30, row.id);
    assert.ok(row.evidence.length > 0, row.id);
    for (const evidence of row.evidence) assert.match(evidence, /:[0-9]+(?:-[0-9]+)?$/);
  }
});

test('preserves native ownership, sole Hindsight memory and unsupported host boundaries per hook', () => {
  assert.deepEqual(ids('native-owned'), ['PreToolUse:0:0', 'PreToolUse:1:0', 'PreToolUse:3:0', 'PreToolUse:7:0', 'PreToolUse:8:0', 'PostToolUseFailure:0:0', 'Stop:6:0']);
  assert.deepEqual(ids('ecc-supplement'), ['PreToolUse:2:0', 'PreToolUse:5:0', 'PreToolUse:6:0', 'PreToolUse:9:0', 'UserPromptSubmit:0:0', 'PostToolUse:0:0', 'Stop:0:0', 'Stop:2:0', 'Stop:3:0']);
  assert.deepEqual(ids('memory-redirect'), ['PreToolUse:4:0', 'PreCompact:0:0', 'SessionStart:0:0', 'PostToolUse:1:0', 'Stop:4:0', 'Stop:5:0']);
  assert.deepEqual(ids('host-unsupported'), ['SessionStart:1:0', 'PostToolUseFailure:1:0', 'Stop:1:0', 'Stop:7:0', 'SessionEnd:0:0']);
  const report = classifyHooks(manifest(), options(capabilities));
  for (const row of report.hooks.filter(row => row.classification === 'memory-redirect')) assert.match(row.reason, /Hindsight/);
  assert.match(report.hooks.find(row => row.id === 'PreToolUse:0:0').reason, /not equivalent/i);
  assert.match(report.hooks.find(row => row.id === 'Stop:2:0').reason, /270|300/);
  assert.match(report.hooks.find(row => row.id === 'SessionEnd:0:0').reason, /Stop|SessionEnd/);
  assert.match(report.gaps.join('\n'), /transcript/i);
});

test('requires each explicit containment/native capability and approves only the reviewed payload-only supplement', () => {
  const input = manifest();
  for (const missing of capabilities) {
    const report = classifyHooks(input, options(capabilities.filter(capability => capability !== missing)));
    assert.deepEqual(report.approvedHooks, [], missing);
    assert.ok(report.hooks.find(row => row.id === 'PreToolUse:2:0').missingCapabilities.includes(missing));
  }
  assert.deepEqual(classifyHooks(input, options(['*'])).approvedHooks, []);
  const report = classifyHooks(input, options([...capabilities, ...HOOK_POLICY.flatMap(row => row.dependencies)]));
  assert.deepEqual(report.approvedHooks.map(row => row.id), ['PreToolUse:2:0']);
  assert.equal(report.hooks.find(row => row.id === 'PreToolUse:2:0').disposition, 'approved');
  assert.equal(report.hooks.find(row => row.id === 'Stop:2:0').disposition, 'review-required');
  assert.deepEqual(selectApprovedHooks(input, options(capabilities)), {
    hooks: { PreToolUse: [structuredClone(input.hooks.PreToolUse[2])] },
  });
});

test('selector returns independent original hook data and never modifies matcher, async or timeout', () => {
  const input = manifest();
  const selected = selectApprovedHooks(input, options(capabilities));
  selected.hooks.PreToolUse[0].hooks[0].command = 'unreviewed';
  const report = classifyHooks(input, options(capabilities));
  report.approvedHooks[0].hook.command = 'another unreviewed command';
  assert.equal(classifyHooks(input, options(capabilities)).status, 'reviewed');
  assert.equal(selectApprovedHooks(input, options(capabilities)).hooks.PreToolUse[0].hooks[0].command, input.hooks.PreToolUse[2].hooks[0].command);
});

test('requires the full exact revision, not a prefix or caller capabilities to bypass source gating', () => {
  for (const sourceRevision of [undefined, null, revision.slice(0, 7), `${revision}\n`, 'f'.repeat(40)]) {
    const input = manifest();
    const opts = { sourceRevision, availableCapabilities: capabilities };
    const report = classifyHooks(input, opts);
    assert.equal(report.status, 'blocked');
    assert.equal(report.hooks.length, 27);
    assert.deepEqual(report.approvedHooks, []);
    assert.deepEqual(selectApprovedHooks(input, opts), { hooks: {} });
    assert.match(report.gaps.join('\n'), /revision/i);
  }
});

test('fails closed across command, matcher, type, async, timeout, event and unknown-hook drift', () => {
  const mutations = [
    input => { input.hooks.PreToolUse[2].hooks[0].command += '; echo injected'; },
    input => { input.hooks.PreToolUse[2].matcher = '.*'; },
    input => { input.hooks.PreToolUse[2].hooks[0].type = 'prompt'; },
    input => { input.hooks.PreToolUse[2].hooks[0].async = true; },
    input => { input.hooks.PreToolUse[2].hooks[0].timeout = 5; },
    input => { input.hooks.PreToolUse[0].hooks[0].command += ' '; },
    input => { input.hooks.Stop[0].hooks[0].command = 'unreviewed Stop'; },
    input => { delete input.hooks.SessionEnd; },
    input => { input.hooks.NewEvent = [{ hooks: [{ type: 'command', command: 'echo unknown' }] }]; },
    input => { input.hooks.PreToolUse[2].hooks.push({ type: 'command', command: 'echo extra' }); },
    input => { input.hooks.PreToolUse[2].hooks[0].asyncRewake = true; },
    input => { input.hooks.PreToolUse[2].matcher = null; },
  ];
  for (const mutate of mutations) {
    const input = manifest();
    mutate(input);
    const report = classifyHooks(input, options(capabilities));
    assert.equal(report.status, 'blocked');
    assert.deepEqual(report.approvedHooks, []);
    assert.deepEqual(selectApprovedHooks(input, options(capabilities)), { hooks: {} });
    assert.ok(report.gaps.length > 0);
  }
});

test('rejects malformed manifests and capabilities without throwing or executing fallbacks', () => {
  for (const input of [undefined, null, [], {}, { hooks: [] }, { hooks: null }, { hooks: { PreToolUse: null } }, { hooks: { PreToolUse: [null] } }, { hooks: { PreToolUse: [{ hooks: null }] } }, { hooks: { PreToolUse: [{ hooks: [null] }] } }]) {
    assert.equal(classifyHooks(input, options(capabilities)).status, 'blocked');
    assert.deepEqual(selectApprovedHooks(input, options(capabilities)), { hooks: {} });
  }
  for (const availableCapabilities of ['contained-runner', {}, null, [null], [1]]) {
    const report = classifyHooks(manifest(), { sourceRevision: revision, availableCapabilities });
    assert.equal(report.status, 'blocked');
    assert.deepEqual(report.approvedHooks, []);
  }
});

test('portable manifest fixture matches the pinned upstream JSON without importing upstream code', { skip: !process.env.ECC_ROOT }, async () => {
  const upstream = JSON.parse(await readFile(join(process.env.ECC_ROOT, 'hooks/hooks.json'), 'utf8'));
  const report = classifyHooks(upstream, options(capabilities));
  assert.equal(report.status, 'reviewed', report.gaps.join('\n'));
  assert.deepEqual(report.approvedHooks.map(row => row.id), ['PreToolUse:2:0']);
});
