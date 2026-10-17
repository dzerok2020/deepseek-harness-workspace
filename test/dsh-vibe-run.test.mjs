// Tests for tools/dsh-vibe-run.mjs — the 4-role one-command pipeline.
// Run: node --test test/dsh-vibe-run.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseFinal, stripCgwAdvisory, parseJsonLoose } from "../tools/dsh-vibe-run.mjs";

const TOOL = join(import.meta.dirname, "..", "tools", "dsh-vibe-run.mjs");

test("parseFinal takes the LAST final event", () => {
  const jsonl = [
    '{"type":"session","id":"x"}',
    '{"type":"text","text":"partial"}',
    '{"type":"final","text":"FIRST"}',
    '{"type":"status","note":"x"}',
    '{"type":"final","text":"REAL ANSWER"}',
    "not-json",
  ].join("\n");
  assert.equal(parseFinal(jsonl), "REAL ANSWER");
});

test("parseFinal returns null without a final event", () => {
  assert.equal(parseFinal('{"type":"text","text":"a"}\n{"type":"status"}'), null);
  assert.equal(parseFinal(""), null);
});

test("stripCgwAdvisory removes the leading blockquote advisory only", () => {
  const cgw = '> **Local tools unavailable**: the ChatGPT bridge is text-only.\n>\n\nHere is your JSON:\n{"ok":1}';
  assert.equal(stripCgwAdvisory(cgw), 'Here is your JSON:\n{"ok":1}');
  assert.equal(stripCgwAdvisory("no advisory here"), "no advisory here");
});

test("stripCgwAdvisory keeps answer concatenated on the advisory's last line", () => {
  // Observed live: ChatGPT continued right after "...access to local tools." with no newline.
  const cgw =
    "> **Local tools unavailable**\n>\n> `ChatGPT Web Instant` cannot access the local Codex computer.\n>\n" +
    "> **Action:** Open `MCP` in `Codex Web GPT` and connect the `Full` harness to give the selected ChatGPT Web model access to local tools." +
    '{"verdict":"pass","blocking":[]}';
  assert.equal(stripCgwAdvisory(cgw), '{"verdict":"pass","blocking":[]}');
});

test("parseJsonLoose survives code fences and prose around the object", () => {
  const t = "Here you go:\n```json\n{\"verdict\":\"rework\",\"blocking\":[\"x\"]}\n```\nDone.";
  assert.equal(parseJsonLoose(t).verdict, "rework");
  assert.equal(parseJsonLoose("no object here"), null);
});

test("parseJsonLoose unescapes ChatGPT markdown brackets", () => {
  const t = '{"verdict":"rework","blocking":\\["DIFF STAT trống","TEST thiếu log"\\],"nits":\\["x"\\]}';
  const v = parseJsonLoose(t);
  assert.equal(v.verdict, "rework");
  assert.equal(v.blocking.length, 2);
});

// Exercise the actual DSH process boundary without spending model calls.
function runFixture(dir, outputs, extra = []) {
  const bin = join(dir, 'fake-dsh.mjs');
  writeFileSync(bin, `#!/usr/bin/env node
const outputs = JSON.parse(process.env.PHASE_OUTPUTS);
const pin = process.argv.find(a => /pin-[^/]+\\.yml$/.test(a));
const name = pin.split('/').pop().slice(4, -4);
const role = name.replace(/-r\\d+(-retry)?$|-retry$/, '');
const value = outputs[name] ?? outputs[role];
const text = role === 'architect' ? '# plan: ' + process.argv.at(-1) + '\\ntool_note: context' : typeof value === 'string' ? value : JSON.stringify(value);
console.log(JSON.stringify({type:'final',text}));
process.exit(outputs.exit ?? 0);
`);
  chmodSync(bin, 0o700);
  return spawnSync(process.execPath, [TOOL, '--dir', dir, '--task', 'fixture task', '--max-rework', '0', ...extra], {
    encoding: 'utf8', timeout: 60000,
    env: { ...process.env, DSH_BIN: bin, PHASE_OUTPUTS: JSON.stringify(outputs) },
  });
}
const goodOutputs = { coder: {status:'done',commits:[]}, tester: {pass:true,failures:[]}, reviewer: {verdict:'pass',blocking:[]} };
for (const [label, overrides] of [
  ['blocked coder', {coder:{status:'blocked'}}],
  ['failed tester', {tester:{pass:false,failures:['broken']}}],
  ['malformed coder', {coder:'not JSON'}],
  ['malformed tester', {tester:{pass:'true'}}],
  ['contradictory tester', {tester:{pass:true,failures:['broken']}}],
  ['contradictory reviewer', {reviewer:{verdict:'pass',blocking:['broken']}}],
  ['nonzero DSH exit despite final event', {exit:2}],
]) {
  test(`pipeline rejects ${label} even if reviewer says pass`, () => {
    const dir = makeRepo();
    try {
      const r = runFixture(dir, {...goodOutputs,...overrides});
      assert.equal(r.status, 1, r.stdout + r.stderr);
      assert.doesNotMatch(r.stdout, /Verdict PASS/);
    } finally { rmSync(dir, {recursive:true,force:true}); }
  });
}
test('rework cannot hide a newly failed tester', () => {
  const dir = makeRepo();
  try {
    const r = runFixture(dir, {...goodOutputs, reviewer:{verdict:'rework',blocking:['fix']}, 'reviewer-r1':{verdict:'pass',blocking:[]}, 'tester-r1':{pass:false,failures:['regression']}}, ['--max-rework','1']);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.doesNotMatch(r.stdout, /Verdict PASS/);
  } finally { rmSync(dir, {recursive:true,force:true}); }
});

// ---- integration: mock pipeline runs the full state machine offline ----
const makeRepo = () => {
  const dir = mkdtempSync(join(tmpdir(), "vibe-pipe-"));
  const git = (...a) => {
    const r = spawnSync("git", a, { cwd: dir, encoding: "utf8" });
    assert.equal(r.status, 0, `git ${a.join(" ")}: ${r.stderr}`);
  };
  git("init", "-q");
  git("config", "user.email", "vibe@test.local");
  git("config", "user.name", "Vibe Test");
  writeFileSync(join(dir, "fib.py"), "def fib(n):\n    return n\n");
  git("add", "-A");
  git("commit", "-qm", "initial");
  writeFileSync(join(dir, "README.md"), "# demo\n");
  git("add", "-A");
  git("commit", "-qm", "readme");
  return dir;
};

const runTool = (dir, { task = "demo task", extra = [] } = {}) =>
  spawnSync(process.execPath, [TOOL, "--dir", dir, "--mock", "--task", task, ...extra], {
    encoding: "utf8",
    timeout: 60000,
  });

test("mock pipeline: architect -> coder -> tester -> reviewer -> FINAL (pass)", () => {
  const dir = makeRepo();
  try {
    const r = runTool(dir);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /▶ architect/);
    assert.match(r.stdout, /▶ reviewer\b/);
    assert.ok(existsSync(join(dir, ".vibe-run", "PLAN.md")), "PLAN.md written");
    assert.ok(existsSync(join(dir, ".vibe-run", "CODE.json")), "CODE.json written");
    assert.ok(existsSync(join(dir, ".vibe-run", "TEST.json")), "TEST.json written");
    const review = JSON.parse(readFileSync(join(dir, ".vibe-run", "REVIEW.json"), "utf8"));
    assert.equal(review.verdict, "pass");
    assert.match(readFileSync(join(dir, ".vibe-run", "FINAL.md"), "utf8"), /verdict: pass/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("mock pipeline: reviewer rework triggers bounded coder/tester round", () => {
  const dir = makeRepo();
  try {
    // Mock reviewer returns rework on EVERY round when the task contains MOCK_REWORK,
    // so the loop must run exactly max-rework+1 review rounds then stop and report.
    const r = runTool(dir, { task: "MOCK_REWORK please" });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /REVIEW round 0: rework/);
    assert.match(r.stdout, /▶ coder-r1/);
    assert.match(r.stdout, /▶ tester-r1/);
    assert.match(r.stdout, /▶ reviewer-r1/);
    assert.doesNotMatch(r.stdout, /REVIEW round 2/);
    assert.ok(existsSync(join(dir, ".vibe-run", "CODE-r1.json")), "rework coder output written");
    assert.match(readFileSync(join(dir, ".vibe-run", "FINAL.md"), "utf8"), /verdict: rework/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("mock pipeline: max-rework 0 keeps the rework verdict and exits 1", () => {
  const dir = makeRepo();
  try {
    const r = runTool(dir, { task: "MOCK_REWORK", extra: ["--max-rework", "0"] });
    assert.equal(r.status, 1);
    assert.match(readFileSync(join(dir, ".vibe-run", "FINAL.md"), "utf8"), /verdict: rework/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('resume reuses a plan only for the same task and unchanged plan', () => {
  const dir = makeRepo();
  try {
    assert.equal(runTool(dir, {task:'TASK A'}).status, 0);
    const same = runTool(dir, {task:'TASK A'});
    assert.equal(same.status, 0, same.stderr);
    assert.match(same.stdout, /dùng lại/);
    const different = runTool(dir, {task:'TASK B'});
    assert.equal(different.status, 0, different.stderr);
    assert.match(different.stdout, /▶ architect/);
    assert.doesNotMatch(different.stdout, /dùng lại/);
    writeFileSync(join(dir,'.vibe-run','PLAN.md'), '# tampered plan\ntool_note: old');
    assert.match(runTool(dir, {task:'TASK B'}).stdout, /▶ architect/);
  } finally { rmSync(dir, {recursive:true,force:true}); }
});
test('legacy plan without task identity is not reused', () => {
  const dir = makeRepo();
  try {
    assert.equal(runTool(dir).status,0);
    rmSync(join(dir,'.vibe-run','RUN.json'), {force:true});
    const r = runTool(dir);
    assert.equal(r.status,0,r.stderr);
    assert.match(r.stdout,/▶ architect/);
  } finally { rmSync(dir, {recursive:true,force:true}); }
});

test("pipeline refuses to run outside a git repo", () => {
  const dir = mkdtempSync(join(tmpdir(), "vibe-nogit-"));
  try {
    const r = spawnSync(process.execPath, [TOOL, "--dir", dir, "--mock", "--task", "x"], { encoding: "utf8" });
    assert.equal(r.status, 1);
    assert.match(r.stderr + r.stdout, /không phải Git repo/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
