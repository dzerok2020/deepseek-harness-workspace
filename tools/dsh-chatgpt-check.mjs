#!/usr/bin/env node
// dsh-chatgpt-check.mjs — staged end-to-end verification of the DSH -> shim ->
// codex-chatgpt-web path. Starts its own shim in-process, so it needs no service
// running beyond the bridge itself.
//
//   node tools/dsh-chatgpt-check.mjs [--bridge URL] [--timeout MS] [--text-only]
//
// Prints ĐẠT / LỖI per stage and exits non-zero if any stage fails. Every check
// hits the real bridge and the real ChatGPT Web turn path; nothing is simulated.

import http from "node:http";
import { once } from "node:events";
import { createServer, DEFAULT_MODELS, resolveWorkspaceCwd } from "./dsh-chatgpt-shim.mjs";

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1];
};
const BRIDGE = (flag("bridge", process.env.CGW_BRIDGE_URL || "http://127.0.0.1:17841")).replace(/\/+$/, "");
const TIMEOUT = Number(flag("timeout", 240000));
const TEXT_ONLY = argv.includes("--text-only");
const CWD = process.env.CGW_CWD || process.env.DSH_WORKSPACE || process.cwd();
const MODEL = flag("model", DEFAULT_MODELS[0]);

const results = [];
const record = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "ĐẠT" : "LỖI"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

async function getJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  return { status: res.status, body: await res.json().catch(() => null) };
}

/** Walk an SSE stream and pull out the completed response object. */
async function runTurn(base, body) {
  const res = await fetch(`${base}/v1/responses`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!res.ok) return { status: res.status, error: (await res.text()).slice(0, 400) };
  const raw = await res.text();
  let completed = null;
  let failure = null;
  for (const line of raw.split("\n")) {
    if (!line.startsWith("data: ")) continue;
    const payload = line.slice(6);
    if (payload === "[DONE]") continue;
    try {
      const ev = JSON.parse(payload);
      if (ev.type === "response.completed") completed = ev.response;
      if (ev.type === "response.failed") failure = ev.response?.error?.message ?? "response.failed";
    } catch {}
  }
  return { status: res.status, completed, failure, raw };
}

const outputText = (response) =>
  (response?.output ?? [])
    .flatMap((item) => (item.type === "message" ? item.content ?? [] : []))
    .map((c) => c.text ?? "")
    .join("");

const userTurn = (text, tools) => ({
  model: MODEL,
  stream: true,
  store: false,
  ...(tools ? { tools, tool_choice: "auto", parallel_tool_calls: false } : {}),
  input: [{ type: "message", role: "user", content: [{ type: "input_text", text }] }],
});

const main = async () => {
  console.log(`bridge ${BRIDGE}\ncwd    ${CWD}\nmodel  ${MODEL}\n`);

  // 1. Bridge reachable and accepting turns.
  try {
    const { status, body } = await getJson(`${BRIDGE}/healthz`);
    const ok = status === 200 && body?.status === "ok" && body?.accepting_turns === true;
    record("bridge /healthz reachable and accepting turns", ok, `HTTP ${status} mode=${body?.mode} v${body?.version} accepting_turns=${body?.accepting_turns}`);
  } catch (err) {
    record("bridge /healthz reachable and accepting turns", false, String(err.message ?? err));
    console.log("\nBridge is not running. Start it first (see dsh-with-chatgpt/SKILL.md).");
    process.exit(1);
  }

  // 2. The shim serves the catalog without touching the bridge.
  const cwd = resolveWorkspaceCwd(null, [CWD], CWD);
  const shim = createServer({ bridgeUrl: BRIDGE, cwd, models: [...DEFAULT_MODELS] });
  shim.listen(0, "127.0.0.1");
  await once(shim, "listening");
  const base = `http://127.0.0.1:${shim.address().port}`;
  try {
    const { status, body } = await getJson(`${base}/v1/models`);
    const ok = status === 200 && body?.data?.length > 0;
    record("shim serves the model catalog", ok, `HTTP ${status} models=${body?.data?.length}`);
    if (!body?.data?.some((m) => m.id === MODEL)) record(`declared model ${MODEL} is published by the shim`, false, "not in catalog");

    // 3. Plain text turn end to end.
    const text = await runTurn(base, userTurn("Reply with exactly DSH-CHATGPT-OK and nothing else."));
    const answer = outputText(text.completed).trim();
    record(
      "text turn through shim -> bridge -> ChatGPT Web",
      text.status === 200 && !text.failure && /DSH-CHATGPT-OK/.test(answer),
      text.failure ? `failed: ${text.failure}` : `HTTP ${text.status} reply=${JSON.stringify(answer.slice(0, 80))} tokens=${text.completed?.usage?.total_tokens ?? "?"}`,
    );

    // 4. Tool-bearing turn — the reason this adapter exists.
    if (TEXT_ONLY) {
      record("tool-bearing turn", true, "skipped by --text-only");
    } else {
      const tool = {
        type: "function",
        name: "dsh_read_file",
        description: "Read a UTF-8 text file from the DSH workspace.",
        parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"], additionalProperties: false },
      };
      const tooled = await runTurn(base, userTurn('Call the tool dsh_read_file exactly once with path "NOTES.md". Do not answer in prose; emit the tool call.', [tool]));
      const calls = (tooled.completed?.output ?? []).filter((i) => i.type === "function_call");
      record(
        "tool-bearing turn returns a real function_call",
        tooled.status === 200 && !tooled.failure && calls.length === 1 && calls[0].name === "dsh_read_file",
        tooled.failure
          ? `failed: ${tooled.failure}`
          : `HTTP ${tooled.status} calls=${JSON.stringify(calls.map((c) => ({ name: c.name, arguments: c.arguments })))}`,
      );
    }
  } finally {
    shim.close();
  }
};

await main();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} stage(s) passed`);
process.exit(failed.length ? 1 : 0);
