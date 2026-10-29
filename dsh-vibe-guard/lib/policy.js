/**
 * dsh-vibe-guard - policy core.
 *
 * This module is deliberately dependency-free: it imports nothing from DeepSeek Harness and
 * touches no I/O. Every decision the guard makes is a pure function of (call, state, config),
 * which is what makes the guard itself testable and auditable instead of being "trust me" logic.
 *
 * The guard enforces one rule from the book (Ch.5): "done" means the change was verified,
 * not that code was written. It does that by watching which tool calls actually changed
 * something and which actually verified something, then refusing to let a turn stop while a
 * change is still unverified.
 *
 * The second rule (Ch.1/Ch.4) is that some actions cannot be undone, so they must not be
 * attempted by an autonomous loop at all without an explicit, recoverable formulation.
 */

const DEFAULTS_VERIFY = [
  "\\b(?:node\\s+--test|vitest|jest|mocha|ava|tap|pytest|phpunit|rspec|bats)\\b",
  "\\b(?:npm|pnpm|yarn|bun)\\s+(?:run\\s+)?(?:test|tests|lint|typecheck|type-check|check|build|ci)\\b",
  "\\b(?:tsc|eslint|ruff|mypy|pyright|golangci-lint|staticcheck|shellcheck|hadolint|prettier\\s+--check)\\b",
  "\\bgo\\s+(?:test|vet|build)\\b",
  "\\bcargo\\s+(?:test|check|build|clippy)\\b",
  "\\b(?:mvn|mvnw|gradle|gradlew|make|cmake)\\s+(?:test|verify|check|build)\\b",
  "\\bdotnet\\s+(?:test|build)\\b",
  "\\bpython3?\\s+-m\\s+(?:pytest|unittest|mypy)\\b"
];

const DEFAULTS_EDIT_SHELL = [
  // Ghi vào file thật = edit. KHÔNG tính khi chỉ chuyển hướng tới /dev/* hoặc gộp fd (2>&1, &>).
  // Bug cũ: ">>?\\s*[^\\s|&>]+" khớp cả `2>/dev/null` => lệnh CHỈ ĐỌC bị tính là sửa file
  // => [verification-gate] bắn giả, agent bị steer thêm lượt vô ích.
  ">>?(?!&)\\s*(?!/dev/(?:null|stdout|stderr|tty))[^\\s|&>]+",
  "\\bsed\\s+-i\\b",
  "\\btee\\b",
  "\\bmv\\b",
  "\\bcp\\b",
  "\\b(?:npm|pnpm|yarn|bun)\\s+(?:install|i|ci|add|remove|uninstall)\\b",
  "\\bpip3?\\s+install\\b",
  "\\b(?:apt|apt-get|dnf|yum|apk|brew)\\s+(?:install|remove|upgrade)\\b",
  "\\bgit\\s+(?:add|commit|checkout|switch|restore|apply|am|merge|rebase|cherry-pick|stash\\s+(?:pop|drop))\\b",
  "\\bchmod\\b",
  "\\bchown\\b",
  "\\b(?:docker|podman)\\s+(?:run|build|rm|stop|kill|compose)\\b",
  "\\bsystemctl\\b",
  "\\btruncate\\b",
  "\\btouch\\b",
  "\\bmkdir\\b"
];

const DEFAULTS_IRREVERSIBLE = [
  {
    id: "rm-rf-root",
    why: "recursive force-delete of the filesystem root or the home directory",
    pattern: "\\brm\\s+(?=[^\\n]*?-[a-zA-Z]*[rR])(?=[^\\n]*?-[a-zA-Z]*[fF])[^\\n]*?\\s(?:/|~/|~|\\$HOME/|\\$HOME)(?:\\*|\\s*$)"
  },
  {
    id: "rm-rf-bare",
    why: "recursive force-delete with no explicit target",
    pattern: "\\brm\\s+(?:-[a-zA-Z]+\\s*)+$",
  },
  {
    id: "git-push-force",
    why: "force-push rewrites history other people may already have",
    pattern: "\\bgit\\s+push\\b[^\\n]*?(?:--force(?!-with-lease)|-f\\b)",
  },
  {
    id: "git-reset-hard",
    why: "hard reset discards uncommitted work with no undo",
    pattern: "\\bgit\\s+reset\\s+--hard\\b"
  },
  {
    id: "git-clean-force",
    why: "git clean deletes untracked and ignored files permanently",
    pattern: "\\bgit\\s+clean\\s+-[a-z]*[fdx][a-z]*\\b"
  },
  {
    id: "git-discard-all",
    why: "discards every local modification in the working tree",
    pattern: "\\bgit\\s+(?:checkout|restore)\\s+(?:--\\s+)?\\.(?:\\s|$)"
  },
  {
    id: "git-history-rewrite",
    why: "rewrites or mirrors published history",
    pattern: "\\bgit\\s+(?:filter-branch|filter-repo)\\b|\\bgit\\s+push\\s+--mirror\\b"
  },
  {
    id: "sql-destructive",
    why: "DROP / TRUNCATE / unfiltered DELETE removes data with no undo",
    pattern: "\\b(?:DROP\\s+(?:TABLE|DATABASE|SCHEMA|INDEX)|TRUNCATE\\s+TABLE)\\b|\\bDELETE\\s+FROM\\s+\\w+\\s*;?\\s*$"
  },
  {
    id: "chmod-777",
    why: "world-writable permissions",
    pattern: "\\bchmod\\s+(?:-R\\s+)?(?:0)?777\\b"
  },
  {
    id: "remote-pipe-shell",
    why: "executes unaudited remote code",
    pattern: "\\b(?:curl|wget)\\b[^\\n|]*\\|\\s*(?:ba|z|k)?sh\\b"
  },
  {
    id: "privilege-escalation",
    why: "sudo steps outside the sandbox boundary",
    pattern: "(?:^|[;&|]\\s*)sudo\\b"
  },
  {
    id: "publish-release",
    why: "publishing is externally visible and hard to withdraw",
    pattern: "\\b(?:npm|pnpm|yarn|cargo|twine|gem)\\s+publish\\b"
  },
  {
    id: "disk-destroy",
    why: "overwrites a filesystem or block device",
    pattern: "\\bmkfs(?:\\.\\w+)?\\b|\\bdd\\s+if="
  },
  {
    id: "container-purge",
    why: "purges containers or volumes together with their data",
    pattern: "\\b(?:docker|podman)\\s+(?:system\\s+prune|volume\\s+rm|rm\\s+-f)\\b"
  },
  {
    id: "kill-everything",
    why: "signals every process the user owns",
    pattern: "\\bkill\\s+-9\\s+-1\\b"
  },
  {
    id: "fork-bomb",
    why: "self-replicating process bomb",
    pattern: ":\\s*\\(\\s*\\)\\s*\\{\\s*:\\s*\\|\\s*:\\s*&\\s*\\}\\s*;\\s*:"
  }
];

/**
 * Completion claims: wording that asserts the work is finished or correct.
 * Deliberately conservative - it matches assertions, never questions or plans
 * (those are screened out again in detectUnverifiedClaim).
 */
export const DEFAULTS_CLAIM = Object.freeze([
  // English
  "\\b(?:all\\s+)?(?:done|finished|complete[d]?)\\b",
  "\\b(?:it|this|that|everything)\\s+(?:now\\s+)?(?:works|worked)\\b",
  "\\b(?:tests?|checks?|build|suite)\\s+(?:all\\s+)?(?:pass(?:es|ed|ing)?|are\\s+green|is\\s+green)\\b",
  "\\ball\\s+(?:\\d+\\s+)?(?:tests?|checks?)\\s+pass\\b",
  "\\bfixed\\b",
  "\\bresolved\\b",
  "\\bimplemented\\b",
  "\\bready\\s+to\\s+(?:ship|merge|use)\\b",
  "\\bverified\\b",
  // Vietnamese — no \\b around accented letters: JavaScript treats only
  // [A-Za-z0-9_] as word characters, so a boundary next to "đ"/"ã" never matches.
  "đã\\s+(?:xong|làm\\s+xong|sửa(?:\\s+xong)?|chạy\\s+(?:được|ổn))",
  "đã\\s+[^.!?\\n]{0,30}?\\s+xong",
  "hoàn\\s+thành|hoàn\\s+tất",
  "xong\\s+rồi",
  "(?:test|kiểm\\s+thử)\\s+(?:đã\\s+)?(?:pass|đạt|xanh)",
  "chạy\\s+ổn\\s+định"
]);

/** Wording that makes a sentence a question or a plan rather than a completed claim. */
const CLAIM_EXEMPT = Object.freeze([
  /[?？]\s*$/,
  /\b(?:should|shall|can|could|would|will|might|may|need\s+to|have\s+to|plan\s+to|going\s+to)\b/i,
  /(?:có\s+nên|sẽ|định|phải\s+làm|nên\s+làm|cần\s+làm)/i,
  /\b(?:if|unless|whether|suppose|assuming)\b/i,
  /(?:nếu|liệu|giả\s+sử)/i
]);

export const DEFAULTS = Object.freeze({
  enabled: true,
  verifyGate: true,
  irreversibleGate: true,
  claimGate: true,
  maxPerSession: 3,
  editTools: Object.freeze([
    "write", "write_file", "writefile", "edit", "edit_file", "editfile", "create_file", "createfile",
    "apply_patch", "applypatch", "multi_edit", "multiedit", "notebook_edit", "notebookedit",
    "str_replace_based_edit_tool", "strreplacebasededittool", "patch", "insert", "insert_content", "modify_file"
  ]),
  shellTools: Object.freeze([
    "ops_bash", "bash", "sh", "shell", "pwsh", "powershell", "cmd", "run_shell", "runshell",
    "run_shell_command", "runshellcommand", "execute_command", "executecommand", "terminal", "run_command", "runcommand"
  ]),
  verifyPatterns: Object.freeze(DEFAULTS_VERIFY),
  editShellPatterns: Object.freeze(DEFAULTS_EDIT_SHELL),
  irreversible: Object.freeze(DEFAULTS_IRREVERSIBLE),
  allowPatterns: Object.freeze([]),
  gateMessage: null
});

/** Fold case and separator variance so the guard is never defeated by "Read_File" vs "readFile". */
export function normalizeName(value) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function compileOne(value) {
  if (value instanceof RegExp) return value;
  return new RegExp(String(value), "i");
}

function compileList(values) {
  return (Array.isArray(values) ? values : []).map(compileOne);
}

/** Turn a plain (YAML/JSON derived) config object into a compiled, decision-ready config. */
export function compileConfig(raw) {
  const merged = { ...DEFAULTS, ...(raw ?? {}) };
  const rules = Array.isArray(merged.irreversible) ? merged.irreversible : DEFAULTS_IRREVERSIBLE;
  return {
    enabled: merged.enabled !== false,
    verifyGate: merged.verifyGate !== false,
    irreversibleGate: merged.irreversibleGate !== false,
    claimGate: merged.claimGate !== false,
    claimMessage: typeof merged.claimMessage === "string" && merged.claimMessage.length > 0 ? merged.claimMessage : null,
    maxPerSession: Number.isFinite(merged.maxPerSession) && merged.maxPerSession >= 0
      ? Math.floor(merged.maxPerSession)
      : DEFAULTS.maxPerSession,
    editTools: (merged.editTools ?? DEFAULTS.editTools).map(normalizeName),
    shellTools: (merged.shellTools ?? DEFAULTS.shellTools).map(normalizeName),
    gateMessage: typeof merged.gateMessage === "string" && merged.gateMessage.length > 0 ? merged.gateMessage : null,
    re: {
      verify: compileList(merged.verifyPatterns ?? DEFAULTS.verifyPatterns),
      claim: compileList(merged.claimPatterns ?? DEFAULTS_CLAIM),
      editShell: compileList(merged.editShellPatterns ?? DEFAULTS.editShellPatterns),
      irreversible: rules.map((rule) => ({
        id: String(rule.id ?? "unnamed"),
        why: String(rule.why ?? ""),
        git: rules === DEFAULTS_IRREVERSIBLE && String(rule.id).startsWith("git-"),
        re: compileOne(rule.pattern ?? rule.re)
      })),
      allow: compileList(merged.allowPatterns ?? DEFAULTS.allowPatterns)
    }
  };
}

/** Extract the shell command string out of arbitrary tool arguments, defensively. */
export function extractCommand(args) {
  if (typeof args === "string") return args;
  if (args === null || typeof args !== "object") return "";
  for (const key of ["command", "cmd", "script", "shell", "input", "code"]) {
    const value = args[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return "";
}

function firstLine(text) {
  const line = String(text ?? "").split("\n").find((entry) => entry.trim().length > 0) ?? "";
  return line.trim().slice(0, 200);
}

function describeTarget(args) {
  if (args === null || typeof args !== "object") return "";
  for (const key of ["file_path", "path", "filePath", "filename", "target", "notebook_path"]) {
    if (typeof args[key] === "string") return args[key];
  }
  return "";
}

/** Extract literal executable positions, not shell expansion or a shell sandbox. */
function executableCommands(command, depth = 0, offset = 0) {
  const commands = [];
  let words = [];
  const finish = () => {
    let start = 0;
    while (start < words.length) {
      const value = words[start].value;
      const executableName = value.slice(value.lastIndexOf("/") + 1);
      if (/^(?:[A-Za-z_][A-Za-z0-9_]*=|if$|then$|elif$|else$|do$|!$|\{$)/.test(value)) {
        start += 1;
        continue;
      }
      if (!/^(?:env|command|exec|npx|time)$/.test(executableName)) break;
      const wrapper = executableName;
      start += 1;
      while (words[start]?.value.startsWith("-")) {
        const option = words[start++].value;
        if (option === "--") break;
        if (/^(?:--help|--version)$/.test(option) ||
            (wrapper === "command" && /^(?:-v|-V)$/.test(option)) ||
            (wrapper === "npx" && /^(?:-c|--call)$/.test(option))) {
          // Reporting a command or passing shell text is not literal verification evidence.
          start = words.length;
          break;
        }
        if ((wrapper === "env" && /^(?:-u|--unset|-C|--chdir)$/.test(option)) ||
            (wrapper === "exec" && option === "-a") ||
            (wrapper === "npx" && /^(?:-p|--package)$/.test(option))) start += 1;
      }
    }
    if (start < words.length && !/\s/.test(words[start].value)) {
      const executable = words.slice(start);
      const name = executable[0].value.split("/").pop();
      if (/^(?:sh|bash|dash|zsh)$/.test(name) && depth < 3) {
        for (let i = 1; executable[i]?.value.startsWith("-"); i += 1) {
          if (/^-[^-]*c/.test(executable[i].value) && executable[i + 1]) {
            const body = executable[i + 1];
            commands.push(...executableCommands(body.value, depth + 1, body.at));
            break;
          }
        }
      } else commands.push(executable);
    }
    words = [];
  };
  // A comment starts a token; # inside an unquoted word is just part of that word.
  const tokens = /#[^\n]*|(?:[^\s;&|()<>'"\\]|\\[\s\S]|"(?:\\[\s\S]|[^"\\])*"|'[^']*')+|&&|\|\||[;&|\n()]/g;
  for (const match of command.matchAll(tokens)) {
    const raw = match[0];
    if (raw.startsWith("#")) continue;
    if (/^(?:&&|\|\||[;&|\n()])$/.test(raw)) { finish(); continue; }
    const value = raw.replace(/\\[\s\S]|"(?:\\[\s\S]|[^"\\])*"|'[^']*'/g, (part) =>
      part[0] === "\\" ? part.slice(1) : part[0] === "'" ? part.slice(1, -1) :
        part.slice(1, -1).replace(/\\([$`"\\\n])/g, "$1"));
    words.push({ value, at: offset + match.index });
  }
  finish();
  return commands;
}

/** Git's global options precede the subcommand and must not hide its destructive form. */
function gitCommand(words) {
  if (words[0]?.value.split("/").pop() !== "git") return null;
  let start = 1;
  while (words[start]?.value.startsWith("-")) {
    const option = words[start++].value;
    if (option === "--") break;
    if (/^(?:-C|-c|--git-dir|--work-tree|--namespace|--config-env|--super-prefix)$/.test(option)) start += 1;
  }
  return ["git", ...words.slice(start).map((word) => word.value)].join(" ");
}

/**
 * Classify one tool call as an edit (the world changed), a verification (the change was
 * checked), or neither. Nothing here trusts the model's prose: only the tool name and the
 * structured arguments are inspected.
 */
export function classifyCall(call, cfg) {
  const name = normalizeName(call?.name ?? call?.toolName);
  const args = call?.arguments ?? call?.args ?? {};
  if (cfg.editTools.includes(name)) return { kind: "edit", via: "tool", detail: describeTarget(args) };
  if (cfg.shellTools.includes(name)) {
    // Opaque scripts cannot supply verification evidence without inspecting their contents.
    if (typeof args.script_path === "string" && args.script_path.trim()) {
      return { kind: "edit", via: "shell", detail: args.script_path, mayEditOnFailure: true };
    }
    const command = extractCommand(args);
    if (command.length === 0) return { kind: "neutral", via: "none", detail: "" };
    // The last matching action determines whether the invocation ends with a check or a write.
    // A failed shell may still have performed an earlier write; only a literal `false &&`
    // prefix proves the write could not have been reached.
    const lastMatchAt = (rules) => Math.max(-1, ...rules.flatMap((re) =>
      [...command.matchAll(new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`))]
        .map((match) => match.index)));
    const lastVerifyAt = Math.max(-1, ...executableCommands(command).filter((words) => {
      const executable = words.map((word) => word.value).join(" ");
      const basename = [words[0].value.split("/").pop(), ...words.slice(1).map((word) => word.value)].join(" ");
      return cfg.re.verify.some((re) => [executable, basename].some((value) =>
        new RegExp(re.source, re.flags).exec(value)?.index === 0));
    }).map((words) => words[0].at));
    const lastEditAt = lastMatchAt(cfg.re.editShell);
    const mayEditOnFailure = lastEditAt >= 0 && !/^\s*false\s*&&/.test(command);
    if (lastEditAt >= 0 && lastEditAt >= lastVerifyAt) return { kind: "edit", via: "shell", detail: firstLine(command), mayEditOnFailure };
    if (lastVerifyAt >= 0) return { kind: "verify", via: "shell", detail: firstLine(command), mayEditOnFailure };
    return { kind: "neutral", via: "shell", detail: firstLine(command) };
  }
  return { kind: "neutral", via: "none", detail: "" };
}

/** Return the rule that makes this call non-revertible, or null. */
export function findIrreversible(call, cfg) {
  if (!cfg.enabled || !cfg.irreversibleGate) return null;
  const name = normalizeName(call?.name ?? call?.toolName);
  if (!cfg.shellTools.includes(name)) return null;
  const args = call?.arguments ?? call?.args ?? {};
  if (typeof args.script_path === "string" && args.script_path.trim()) {
    return { id: "opaque-script", why: "script_path contents are not inspected; use an explicit auditable command", command: args.script_path };
  }
  const command = extractCommand(args);
  if (command.length === 0) return null;
  if (cfg.re.allow.some((re) => re.test(command))) return null;
  const gitCommands = executableCommands(command).map(gitCommand).filter((value) => value !== null);
  for (const rule of cfg.re.irreversible) {
    const candidates = rule.git ? gitCommands : [command];
    if (candidates.some((candidate) => rule.git ? rule.re.exec(candidate)?.index === 0 : rule.re.test(candidate))) {
      return { id: rule.id, why: rule.why, command: firstLine(command) };
    }
  }
  return null;
}

export function createState() {
  return {
    seq: 0,
    edits: 0,
    verifies: 0,
    lastEditAt: 0,
    lastEditDetail: "",
    lastVerifyAt: 0,
    lastVerifyOk: null,
    lastVerifyDetail: "",
    lastForcedForEditAt: -1,
    sessionForced: 0,
    denials: [],
    claimsBlocked: 0,
    lastClaimAt: -1,
    lastClaimForEditAt: -1,
    lastClaimPhrase: ""
  };
}

/**
 * Record the outcome of a tool call. A failed standalone write is not a change, but a shell
 * invocation can write before returning failure. A failed check is never passing evidence.
 */
export function noteCall(state, verdict, ok) {
  state.seq += 1;
  if (!ok && !verdict?.mayEditOnFailure) return state;
  if (verdict?.kind === "edit" || (!ok && verdict?.mayEditOnFailure)) {
    state.edits += 1;
    state.lastEditAt = state.seq;
    state.lastEditDetail = verdict.detail ?? "";
  } else if (verdict?.kind === "verify") {
    state.verifies += 1;
    state.lastVerifyAt = state.seq;
    state.lastVerifyOk = true;
    state.lastVerifyDetail = verdict.detail ?? "";
  }
  return state;
}

/** Record an attempted-but-failed verification: evidence that was checked and did not pass. */
export function noteFailedVerify(state, verdict) {
  state.seq += 1;
  state.lastVerifyAt = state.seq;
  state.lastVerifyOk = false;
  state.lastVerifyDetail = verdict?.detail ?? "";
  return state;
}

export function noteDenial(state, info) {
  state.denials.unshift({ id: info?.id ?? "unknown", command: info?.command ?? "", at: state.seq });
  if (state.denials.length > 20) state.denials.length = 20;
  return state;
}

/** Remember that we already forced continuation for the current edit batch. */
export function noteForced(state) {
  state.sessionForced += 1;
  state.lastForcedForEditAt = state.lastEditAt;
  return state;
}

/**
 * The decision: may this turn stop? Returns null when it may, or a description of the debt
 * when a change is still unverified.
 *
 * A failed verification does NOT clear the debt (Ch.5: "done" means the tests pass), and one
 * edit batch is only worth one interruption so the agent is never trapped in a loop.
 */
export function shouldForceVerify(state, cfg) {
  if (!state || !cfg.enabled || !cfg.verifyGate) return null;
  if (state.edits === 0) return null;
  if (state.lastVerifyAt > state.lastEditAt && state.lastVerifyOk === true) return null;
  if (state.lastForcedForEditAt === state.lastEditAt) return null;
  if (state.sessionForced >= cfg.maxPerSession) return null;
  return {
    reason: state.lastVerifyAt > state.lastEditAt ? "last-verification-failed" : "no-verification-recorded",
    edits: state.edits,
    verifies: state.verifies,
    lastVerifyOk: state.lastVerifyOk,
    lastEditDetail: state.lastEditDetail,
    lastVerifyDetail: state.lastVerifyDetail,
    sessionForced: state.sessionForced,
    maxPerSession: cfg.maxPerSession
  };
}

export function buildGateMessage(info, cfg) {
  if (cfg?.gateMessage) return cfg.gateMessage;
  const why = info.reason === "last-verification-failed"
    ? `the only check recorded for this batch FAILED (${info.lastVerifyDetail || "command unknown"})`
    : "no check was recorded for this batch";
  const target = info.lastEditDetail ? ` Most recent change: ${info.lastEditDetail}.` : "";
  return [
    "[verification-gate] You are about to stop after changing files, but " + why + "." + target,
    `Changes recorded in this turn: ${info.edits}. Passing checks recorded: ${info.lastVerifyOk === true ? 1 : 0}.`,
    "Before stopping: run the narrowest command that would fail if your change is wrong (the project's own test / lint / typecheck / build for those files), then report the exact command and its result.",
    "If the change genuinely cannot be verified here, say so explicitly, name the file(s), and explain why - do not claim completion without that statement.",
    "Nếu thay đổi này thực sự không thể kiểm chứng ở đây, hãy nói rõ điều đó và nêu lý do; đừng tuyên bố hoàn thành khi chưa nêu."
  ].join("\n");
}

export function irreversibleDenial(info) {
  return [
    `[dsh-vibe-guard] Blocked before execution: \`${info.command}\` is not recoverable (${info.id} - ${info.why}).`,
    "Nothing was executed. Reformulate so the operation is reversible or two-phase:",
    "1) make it recoverable (drop the force flag, target only the files you created, take a backup or checkpoint first); or",
    "2) do the read-only pre-check, explain the risk to the user, and let the user run or explicitly confirm the destructive step."
  ].join("\n");
}

/* ------------------------------------------------------------------------- *
 * G1 — claim gate: catch "done / fixed / đã xong" wording when the batch has
 * no passing verification recorded yet.
 * ------------------------------------------------------------------------- */

/** True when the current turn has at least one change and no passing check after it. */
function unverifiedChange(state) {
  if (!state || typeof state !== "object") return false;
  if (!(state.edits > 0)) return false;
  return !(state.lastVerifyAt > state.lastEditAt && state.lastVerifyOk === true);
}

/** Plan / question wording is not a completion claim. */
function exemptSentence(sentence) {
  for (const re of CLAIM_EXEMPT) {
    if (re.test(sentence)) return true;
  }
  return false;
}

/**
 * Split assistant text into sentence-ish units; regexes are evaluated per unit so
 * a plan sentence elsewhere in the message does not hide a real claim.
 */
function sentencesOf(text) {
  return String(text)
    .split(/(?<=[.!?。！？\n])\s+|(?<=\.\.\.)\s+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/**
 * Return null when the message may pass, or { phrase, matched, reason } when an
 * unsupported completion claim was found.
 */
export function detectUnverifiedClaim(text, state, cfg) {
  if (typeof text !== "string" || text.length === 0) return null;
  if (!cfg || cfg.enabled === false || cfg.claimGate === false) return null;
  if (!unverifiedChange(state)) return null;
  const patterns = Array.isArray(cfg.re?.claim) ? cfg.re.claim : [];
  if (patterns.length === 0) return null;

  for (const sentence of sentencesOf(text)) {
    if (exemptSentence(sentence)) continue;
    for (const re of patterns) {
      if (!re.test(sentence)) continue;
      return {
        phrase: sentence,
        matched: re.source,
        reason: state.lastVerifyAt > state.lastEditAt && state.lastVerifyOk === false
          ? "last-verification-failed"
          : "no-verification"
      };
    }
  }
  return null;
}

export function noteClaimBlocked(state, info) {
  if (!state || typeof state !== "object") return state;
  state.claimsBlocked += 1;
  state.lastClaimAt = state.seq;
  state.lastClaimPhrase = info?.phrase ?? "";
  return state;
}

export function buildClaimGateMessage(info, cfg) {
  if (cfg?.claimMessage) return cfg.claimMessage;
  const why = info?.reason === "last-verification-failed"
    ? `the only check recorded for this turn FAILED (${info?.lastVerifyDetail || "command unknown"})`
    : "no check was run after the last change in this turn";
  const quoted = info?.phrase ? ` You wrote: "${info.phrase.trim()}"` : "";
  return [
    `[claim-gate] Your last message claims completion, but ${why}.${quoted}`,
    "That claim is not supported by evidence yet. Before saying it is done:",
    "1) run the narrowest command that would fail if your change is wrong (tests / lint / typecheck / build for the files you touched);",
    "2) report the exact command and its result in your next message;",
    "3) if the change genuinely cannot be verified here, say so explicitly, name the file(s), and explain why.",
    "Nếu thay đổi thực sự không thể kiểm chứng ở đây, hãy nói rõ điều đó, nêu tên file và lý do; đừng tuyên bố hoàn thành khi chưa có bằng chứng."
  ].join("\n");
}

/** Compact, always-complete view of guard state, used by the model-facing guard_status tool. */
export function summarize(state, cfg) {
  const s = state ?? createState();
  const pending = s.edits > 0 && !(s.lastVerifyAt > s.lastEditAt && s.lastVerifyOk === true);
  return {
    enabled: cfg.enabled,
    verifyGate: cfg.verifyGate,
    irreversibleGate: cfg.irreversibleGate,
    claimGate: cfg.claimGate,
    claimsBlocked: s.claimsBlocked,
    lastClaim: s.lastClaimPhrase,
    edits: s.edits,
    verificationsPassed: s.verifies,
    lastVerificationPassed: s.lastVerifyOk === true,
    lastVerification: s.lastVerifyDetail,
    lastChange: s.lastEditDetail,
    pendingVerification: pending,
    forcedThisSession: s.sessionForced,
    maxPerSession: cfg.maxPerSession,
    blockedActions: s.denials.length,
    lastBlocked: s.denials[0] ?? null,
    nextStep: pending
      ? "Run a passing check for the last change (test/lint/typecheck/build) and report the command and result before finishing."
      : "No unverified change is pending."
  };
}
