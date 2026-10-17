// Tests for tools/dsh-vibe-run.mjs — the 4-role one-command pipeline.
// Run: node --test test/dsh-vibe-run.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseFinal, stripCgwAdvisory } from "../tools/dsh-vibe-run.mjs";

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
