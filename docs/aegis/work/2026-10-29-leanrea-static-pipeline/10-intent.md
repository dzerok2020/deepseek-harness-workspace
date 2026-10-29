# LeanRea controlled static pipeline

## Approved intent and baseline

User approved the download + static-analysis proposal on 2026-10-29: public repositories, homepages/artifacts and local software; no target execution, dependency installation, dynamic analysis or changes to DSH core/profile/model. Keep global use across workspaces. Parent authority is the direct implementation request; goal `goal-97c50bfc-810b-49d0-82a5-b4a888a1d7f2`.

Baseline: branch master at `a6525af`; clean worktree; `node --test tools/leanrea-install.test.mjs` reports 4 pass, 0 fail. Required reads: AGENTS instructions, `docs/vibe-native-playbook.md`, `docs/vibe-rails.md`, `.dsh/skills/leanrea/SKILL.md`, `tools/leanrea-install.test.mjs`, `docs/leanrea-install-notes.md`. Hindsight search capability is unavailable; no historical memory claim is used.

## Change necessity and impact

The current owner is a text-only native LeanRea skill. Add one Python-stdlib helper and a direct usage reference to that same owner; synchronize resources to the global skill, without introducing a plugin, daemon or competing router. Architecture review is required for the new download/untrusted-input boundary and will be an independent read-only review before delivery.

Code/interfaces: new CLI plus versioned JSON and Markdown reports; the skill is the caller, and installation tests must verify bundled-resource synchronization. Data: per-run private analysis artifacts only, no migration/cache/credential store. Release: project and global resource copies stay identical; no build/restart expected. Rollback is reverting only this task's commit and restoring matching global resources, never deleting user analysis runs automatically.

## Contract and seams

- Entry point: `python3 <skill>/scripts/static_pipeline.py TARGET [--download] [--output-root DIR]`.
- Accept public HTTPS URLs, GitHub repo roots, regular local files and local directory trees. URL acquisition requires the explicit CLI flag; agent announces bounded acquisition/report writes when using the approved pipeline. A homepage yields links for the user/agent to select, not an automatic second download.
- Create a fresh 0700 run directory, write only there, and leave originals untouched. Reports distinguish seen, inferred and unknown; store source, SHA-256, sizes, coverage/skips and limitations. Target text is untrusted evidence, never instructions.
- Only public HTTPS/443, certificate verification, public-IP validation and connection pinning; revalidate redirects, no ambient proxies/cookies/auth, no private/local endpoints. Bound time, bytes, file count, text samples and report size.
- Inspect ZIP/TAR/ASAR virtually, without unpacking to disk. Validate entry paths/types and budgets before reading selected text. Never run target/install/build scripts, attach processes or install tools. This helper is not a VM or an OS sandbox.
- Initial capabilities: source/package inventory, Electron IPC/static clues, binary magic and bounded strings. APK/native full decompilation and dynamic behavior remain unverified/out of scope.
- Verification seams: CLI input/status/reports, observable network and filesystem effects, global native-skill loading. Test safe local/archive/ASAR handling, rejection/limits/no-execution, public URL policy/redirects, and one small real public repo acquisition.

## Implementation and observed verification — 2026-10-30

Implemented in the existing skill owner: `scripts/static_pipeline.py`, `scripts/public_https.py`, `references/static-pipeline.md`, adapter pointer, installation and Python acceptance suites. Project/global copies are synchronized. No extra plugin/service/dependency/core/profile/model/memory change. GitHub snapshots are source ZIPs; homepage links are not followed automatically.

Observed: `python3 tools/leanrea-pipeline.test.py` → Ran 22 tests / OK / exit 0; `python3 tools/leanrea-network.test.py` → Ran 25 tests / OK / exit 0; `node --test tools/leanrea-install.test.mjs` → tests 5 / pass 5 / fail 0 / exit 0. Narrow tests were red before fixing their findings. Unsupported PAX, nonzero TAR directory sizes and compressed-stream concatenation fail closed; decompression and raw headers are bounded before tarfile parsing. Nofollow tree traversal, private output permissions, zero-network without authorization, redacted error reports and explicit partial coverage are covered.

Real global CLI from cwd `/tmp` acquired pinned public `electron/electron-quick-start` ref `91a1d64abdeb31e7506d19434c46a3a541ffd3cb`, redirected to official `electron/minimal-repro`: 11170 bytes, SHA-256 `300a60d5a7c5af5163d0406d9a3dd02430f72a5054d39b7d444b62da1e3e7f79`, 16 entries / 13 inventoried files / 19820 member bytes. [Observed report](</home/dzerok/.local/share/leanrea/analyses/run-90nn0kei/report.md>) is explicitly partial because package-lock URL clues exceed the cap 12. Verified run 0700 and artifact/reports 0600. No target/dependency/build/lifecycle execution.

Independent Spec review completed; the wider Standards reviewer returned confirmed findings then stopped before its final audit report. An independent focused TAR recheck completed and reproduced parser-layout bypasses; both were then reproduced by new red tests and fixed through conservative rejection. Do not call this a complete security audit. Residuals: no OS sandbox, native/APK decompiler or dynamic verification; first public IP only/no network retries; best-effort secret masking; local inputs may still contain sensitive data. Parser/runtime vulnerabilities remain possible despite bounded input.

## Delivery and stop

Deliver runnable global resources, tests, short Vietnamese usage/limits, independent review, full affected regressions and one logical commit without push. Stop as complete only with real evidence; preserve uncovered formats and parser-isolation risk explicitly. No unlimited crawling, automatic cleanup, GUI/server or toolchain installation.
