#!/usr/bin/env node
// dsh-vibe-run.mjs — one command, four independent roles, auto model switch.
//   Architect + Reviewer  -> ChatGPT Web (provider cgw via shim :17842) — a
//     DIFFERENT brain from the one writing code, per the multi-agent video:
//     never let the same model "play football and blow the whistle".
//   Coder + Tester        -> native model with real local tools (provider or).
//
// Usage:
//   node tools/dsh-vibe-run.mjs --task "mô tả tính năng" [--dir REPO]
//        [--max-rework N] [--dry-run] [--mock]
// Phases write .vibe-run/{PLAN.md,CODE.json,TEST.json,REVIEW.json,FINAL.md}.
// Exit 0 = reviewer verdict "pass"; 1 = rework/exhausted/misconfigured.
//
// Degradation: if the ChatGPT bridge is unreachable, plan/review fall back to
// the native model and the run is labelled "degraded" (stability > purity).

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const DSH = process.env.DSH_BIN || "/home/dzerok/.local/share/mise/installs/node/26.8.2/bin/dsh";
const WORK = "/home/dzerok/Documents/deepseek-harness/default-workspace";
const CGW_CATALOG = join(WORK, "tools/vibe-cgw.yml");
const NATIVE_CATALOG = join(WORK, "tools/vibe-native.yml");
const CGW_MODEL = "chatgpt-web/gpt-6-sol";
const NATIVE_MODEL = "b-ai/qwen3.8-flash";
const SHIM_HEALTH = "http://127.0.0.1:17842/healthz";

// ---- CLI --------------------------------------------------------------
const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : dflt;
};
const bool = (name) => args.includes(`--${name}`);

const TASK = flag("task", null);
const DIR = flag("dir", WORK);
const MAX_REWORK = Number(flag("max-rework", "1"));
const DRY = bool("dry-run");
const MOCK = bool("mock");

// ---- phase runner ------------------------------------------------------
const run = { dir: DIR, out: join(DIR, ".vibe-run") };

function pinPatch(file, { provider, model, tools }) {
  const lines = [
    "- id: agent-default-model",
    "  config:",
    `    provider: ${provider}`,
    `    model: ${model}`,
  ];
  if (tools) lines.push("    sandbox: danger-full-access", "    approval: never");
  writeFileSync(file, lines.join("\n") + "\n");
}

function dshRun({ name, catalog, provider, model, tools, prompt, timeout }) {
  if (MOCK) return mockPhase(name, prompt);
  const pin = join(run.out, `pin-${name}.yml`);
  pinPatch(pin, { provider, model, tools });
  const res = spawnSync(
    DSH,
    ["--profile", "headless", "--patch", catalog, "--patch", pin, "--json", prompt],
    { cwd: run.dir, encoding: "utf8", timeout: timeout * 1000, maxBuffer: 64 * 1024 * 1024 },
  );
  if (res.error?.code === "ETIMEDOUT") return { ok: false, error: `${name}: timeout ${timeout}s` };
  if (res.status !== 0 && !res.stdout) return { ok: false, error: `${name}: exit ${res.status} ${res.stderr?.slice(0, 300)}` };
  const final = parseFinal(res.stdout || "");
  if (!final) return { ok: false, error: `${name}: no final event; exit ${res.status}; tail: ${(res.stdout || res.stderr || "").slice(-300)}` };
  return { ok: true, text: provider === "cgw" ? stripCgwAdvisory(final) : final };
}

export function parseFinal(jsonl) {
  const lines = jsonl.trim().split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const ev = JSON.parse(lines[i]);
      if (ev.type === "final" && typeof ev.text === "string") return ev.text;
    } catch {}
  }
  return null;
}

export function stripCgwAdvisory(text) {
  // The harness prepends a fixed blockquote advisory; the model may CONTINUE on
  // the advisory's last line ("> …local tools.{\"verdict\":\"pass\"}") — so cut at
  // the marker instead of dropping whole '>' lines, which would eat the answer.
  const marker = "access to local tools.";
  const at = text.indexOf(marker);
  if (at >= 0) return text.slice(at + marker.length).replace(/^[^\S\n]+/, "").trim();
  const lines = text.split("\n");
  let i = 0;
  while (i < lines.length && (lines[i].startsWith(">") || lines[i].trim() === "")) i++;
  return lines.slice(i).join("\n").trim();
}

function bridgeUp() {
  const res = spawnSync("curl", ["-s", "--max-time", "4", SHIM_HEALTH], { encoding: "utf8" });
  if (res.status !== 0 || !res.stdout) return false;
  try {
    return JSON.parse(res.stdout).status === "ok";
  } catch {
    return false;
  }
}

function sh(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: run.dir, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  return r.status === 0 ? r.stdout : "";
}

function readIf(path, cap = 8000) {
  const p = join(run.dir, path);
  if (!existsSync(p)) return "";
  const t = readFileSync(p, "utf8");
  return `## ${path}\n\n${t.slice(0, cap)}${t.length > cap ? "\n\n[...cắt bớt...]" : ""}`;
}

// ---- canned outputs for --mock (state-machine tests) ------------------
function mockPhase(name, prompt) {
  const role = name.replace(/(-r\d+)?(-retry)?$/, "");
  if (role === "architect") return { ok: true, text: "# PLAN\n\n- thêm hàm fib trong fib.py\n- test pytest\ntool_note: prompt had " + (prompt.includes("git") ? "context" : "none") };
  if (role === "coder") return { ok: true, text: '{"status":"done","commits":["mock1"],"notes":"mock implement"}' };
  if (role === "tester") return { ok: true, text: '{"pass":true,"summary":"mock: all tests green"}' };
  if (role === "reviewer") {
    const wantRework = prompt.includes("MOCK_REWORK");
    return wantRework
      ? { ok: true, text: '{"verdict":"rework","blocking":["thiếu test edge case"],"nits":[]}' }
      : { ok: true, text: '{"verdict":"pass","blocking":[],"nits":["ok"]}' };
  }
  return { ok: false, error: `mock: unknown phase ${name}` };
}

// ---- main chain ---------------------------------------------------------
const main = () => {
  if (!TASK && !DRY) fail('cần --task "mô tả việc" (hoặc --dry-run xem kế hoạch)');
  if (!existsSync(join(run.dir, ".git"))) fail("thư mục không phải Git repo — chạy Bước 1 (four-phase-env-setup) trước");

  const cgw = bridgeUp() || MOCK;
  const planBrain = cgw ? { catalog: CGW_CATALOG, provider: "cgw", model: CGW_MODEL } : { catalog: NATIVE_CATALOG, provider: "or", model: NATIVE_MODEL };
  const codeBrain = { catalog: NATIVE_CATALOG, provider: "or", model: NATIVE_MODEL };

  console.log(`\nDSH-VIBE-RUN  dir=${run.dir}  não-1=${planBrain.model}  não-2=${codeBrain.model}  degraded=${!cgw}\n`);

  if (DRY) {
    console.log("Chuỗi dự kiến: Architect(plan) → Coder(implement) → Tester(verify) → Reviewer(gate) → [rework ≤ " + MAX_REWORK + "] → FINAL.md");
    console.log("Mock/bridge: " + (cgw ? "cgw ChatGPT Web" : "FALLBACK native (bridge DOWN)") + " / " + codeBrain.model);
    return;
  }

  mkdirSync(run.out, { recursive: true });
  mkdirSync(join(run.out, "patches"), { recursive: true });

  // 1. ARCHITECT — ChatGPT Web plans from inline repo context (browser-only: no tools).
  // Resume: a non-empty PLAN.md from a previous run is reused (ChatGPT turns are slow).
  const baseCommit = sh("git", ["rev-parse", "HEAD"]).trim();
  const planPath = join(run.out, "PLAN.md");
  if (existsSync(planPath) && readFileSync(planPath, "utf8").replace(/\\/g, "").includes("tool_note")) {
    console.log(`↻ dùng lại ${planPath} (resume)`);
  } else {
    const tree = sh("git", ["ls-files"]).split("\n").slice(0, 300).join("\n");
    const archPrompt = [
      "Bạn là KIẾN TRÚC SƯ phần mềm (Architect). Không viết code — chỉ lập kế hoạch.",
      "Nhiệm vụ của người dùng:\n" + TASK,
      "\nCây repo hiện tại:\n" + tree,
      readIf("AGENTS.md"),
      readIf("docs/product-plan.md"),
      readIf("docs/tech-plan.md"),
      "\nTrả về KẾ HOẠCH markdown: các bước nhỏ, file sẽ sửa/tạo, tiêu chí nghiệm thu kiểm chứng được (lệnh chạy + kết quả mong đợi). Cuối kế hoạch thêm dòng 'tool_note: <một câu>' để pipeline xác minh bạn đã nhận đủ ngữ cảnh.",
    ].join("\n\n");
    step("architect", planBrain, archPrompt, 300, (t) => {
      writeFileSync(planPath, t);
      if (!/tool\\?_note/.test(t)) fail("architect output lacks tool_note — abort (context may be too large)");
    });
  }

  // 2. CODER — native model, real tools, must commit per AGENTS.md.
  step("coder", codeBrain, codePrompt(), 1200);

  // 3. TESTER — native model, verify only (no production edits).
  step("tester", codeBrain, testPrompt(), 900);

  // 4. REVIEWER loop — ChatGPT Web reviews the actual diff, different brain.
  let verdict = null;
  for (let round = 0; round <= MAX_REWORK; round++) {
    const tag = "reviewer" + (round ? `-r${round}` : "");
    let reviewText = step(tag, planBrain, reviewPrompt(round, baseCommit), 420);
    if (!parseJsonLoose(reviewText)) {
      console.log("  ⚠ reviewer output unparseable — retrying once");
      reviewText = step(tag + "-retry", planBrain, reviewPrompt(round, baseCommit), 420);
    }
    writeFileSync(join(run.out, "REVIEW-raw.txt"), reviewText);
    verdict = parseJsonLoose(reviewText);
    if (!verdict || (verdict.verdict !== "pass" && verdict.verdict !== "rework")) {
      // Gate itself failed — do NOT burn a coder round on nothing.
      verdict = reviewText.trim()
        ? { verdict: "rework", blocking: ["reviewer trả kết quả không parse được"], raw: reviewText.slice(0, 500) }
        : { verdict: "review-unavailable", blocking: ["reviewer (ChatGPT Web) trả về rỗng 2 lần — cầu/bridge có thể đang nghẽn; chạy lại pipeline"] };
      writeFileSync(join(run.out, "REVIEW.json"), JSON.stringify(verdict, null, 2));
      console.log(`\nREVIEW round ${round}: ${verdict.verdict}`);
      break;
    }
    writeFileSync(join(run.out, "REVIEW.json"), JSON.stringify(verdict, null, 2));
    console.log(`\nREVIEW round ${round}: ${verdict.verdict}${verdict.blocking?.length ? " — " + verdict.blocking.join("; ") : ""}`);
    if (verdict.verdict === "pass") break;
    if (round === MAX_REWORK) break;
    step(`coder-r${round + 1}`, codeBrain, reworkPrompt(verdict), 1200);
    step(`tester-r${round + 1}`, codeBrain, testPrompt(), 900);
  }

  finalReport(baseCommit, verdict, planBrain, codeBrain);
  process.exit(verdict.verdict === "pass" ? 0 : 1);
};

const codePrompt = () => [
  "Bạn là LẬP TRÌNH VIÊN (Coder) trong pipeline 4 vai trò. Làm đúng kế hoạch dưới đây, sửa file trong repo hiện tại, tuân thủ AGENTS.md.",
  "Yêu cầu: từng lát nhỏ; chạy test thật trước khi commit; commit message rõ ràng. KHÔNG tự tung kết quả — vibe-guard sẽ chặn.",
  "\nKẾ HOẠCH (.vibe-run/PLAN.md):\n" + readFileSync(join(run.out, "PLAN.md"), "utf8"),
  "\nTrả lời bằng JSON duy nhất: {\"status\":\"done|blocked\",\"commits\":[\"...\"],\"notes\":\"...\"}",
].join("\n\n");

const testPrompt = () => [
  "Bạn là KIỂM THỬ VIÊN (Tester) độc lập. Chạy TOÀN BỘ test suite + build của repo; nếu thiếu test cho hành vi trong .vibe-run/PLAN.md thì BỔ SUNG test (chỉ file test, không sửa code production).",
  "Mọi file test bạn bổ sung/sửa PHẢI được commit ngay (`git add <file test> && git commit -m \"test: ...\"`) — không để thay đổi dở dang trong working tree, vì Reviewer chỉ soi được diff đã commit.",
  "Báo cáo trung thực: không được 'đoán' kết quả.",
  "\nTrả lời bằng JSON duy nhất: {\"pass\":true|false,\"summary\":\"...\",\"failures\":[\"...\"]}",
].join("\n\n");

const reviewPrompt = (round, base) => {
  const range = `${base || "HEAD~1"}..HEAD`;
  const diff = sh("git", ["diff", "--stat", range]);
  const full = sh("git", ["diff", "-U3", range]);
  const commits = sh("git", ["log", "--oneline", range]);
  const test = readIf(".vibe-run/TEST.json", 4000);
  return [
    "Bạn là THẨM ĐỊNH VIÊN ĐỘC LẬP (Reviewer) — không phải người viết code này. Soi lỗi logic, vi phạm quy chuẩn, rủi ro.",
    "NHIỆM VỤ GỐC CỦA PIPELINE:\n" + TASK,
    round ? "Đây là vòng REWORK — kiểm tra các lỗi blocking đã được sửa chưa." : "",
    "\nCOMMITS MỚI (so với gốc pipeline):\n" + (commits || "(pipeline này chưa tạo commit mới — code có thể đã đúng sẵn; hãy kiểm chứng bằng TEST.json)"),
    "\nDIFF STAT:\n" + diff,
    "\n" + (full.slice(0, 60000) || "(empty diff)"),
    "\n" + test,
    "\nKẾ HOẠCH:\n" + readIf(".vibe-run/PLAN.md", 6000),
    "\nTrả lời bằng JSON duy nhất: {\"verdict\":\"pass|rework\",\"blocking\":[\"...\"],\"nits\":[\"...\"]}. pass chỉ khi không lỗi nghiêm trọng.",
  ].filter(Boolean).join("\n\n");
};

const reworkPrompt = (v) => [
  "Bạn là Coder. Reviewer độc lập trả kết quả REWORK. Sửa các lỗi blocking sau, chạy lại test, commit.",
  "\nLỖI BLOCKING:\n" + (v.blocking || []).map((b, i) => `${i + 1}. ${b}`).join("\n"),
  "\nTrả lời JSON: {\"status\":\"done\",\"commits\":[...],\"notes\":\"...\"}",
].join("\n\n");

function step(name, brain, prompt, timeout, after) {
  console.log(`▶ ${name}  (${brain.model})`);
  const r = dshRun({ name, ...brain, tools: brain.provider === "or", prompt, timeout });
  if (!r.ok) fail(`${name} thất bại: ${r.error}`);
  const t = r.text.trim();
  if (name === "tester" || /^tester-/.test(name)) {
    writeFileSync(join(run.out, "TEST.json"), JSON.stringify(parseJsonLoose(t) || { raw: t }, null, 2));
  }
  if (name === "coder" || /^coder-/.test(name)) {
    writeFileSync(join(run.out, `CODE${name === "coder" ? "" : name.slice(5)}.json`), JSON.stringify(parseJsonLoose(t) || { raw: t }, null, 2));
  }
  if (after) after(t);
  else console.log(`  ${t.slice(0, 120).replace(/\n/g, " ")}…`);
  return t;
}

export function parseJsonLoose(text) {
  // ChatGPT's browser-only output markdown-escapes punctuation ("blocking":[ →
  // "blocking":[) — unescape before parse.
  const clean = text.replace(/\\([[\]{}_*`#|<>=+.-])/g, "$1");
  const s = clean.indexOf("{");
  const e = clean.lastIndexOf("}");
  if (s >= 0 && e > s) {
    try {
      return JSON.parse(clean.slice(s, e + 1));
    } catch {}
  }
  try {
    return JSON.parse(clean);
  } catch {
    return null;
  }
}

function fail(msg) {
  console.error(`\n✖ ${msg}`);
  process.exit(1);
}

function finalReport(baseCommit, verdict, planBrain, codeBrain) {
  const log = sh("git", ["log", "--oneline", `${baseCommit}..HEAD`]) || "(không có commit mới)";
  const lines = [
    "# KẾT QUẢ PIPELINE VIBE (dsh-vibe-run)",
    `- Task: ${TASK}`,
    `- Architect/Reviewer: ${planBrain.model}${planBrain.provider === "cgw" ? " (ChatGPT Web)" : " (degraded — bridge DOWN)"}`,
    `- Coder/Tester: ${codeBrain.model}`,
    `- Reviewer verdict: ${verdict.verdict}`,
    verdict.blocking?.length ? `- Blocking: ${verdict.blocking.join("; ")}` : "- Blocking: không",
    `\n## Commits\n${log}`,
    "\n## Bước tiếp (cho người)",
    "- Mở .vibe-run/REVIEW.json + PLAN.md, chạy thử app thật, xác nhận nghiệm thu (Bước 5).",
    verdict.verdict === "pass" ? "- Verdict PASS — còn nghiệm thu cuối thuộc về bạn." : "- Verdict REWORK — xem blocking, quyết định tiếp.",
  ];
  writeFileSync(join(run.out, "FINAL.md"), lines.join("\n") + "\n");
  console.log("\n" + lines.join("\n"));
  console.log(`\n✓ Xong — xem ${join(run.out, "FINAL.md")}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
