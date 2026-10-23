Billion-context 0.1.204 — isolated tier-recovery candidate

STATUS: workspace candidate only. Installed runtime is NOT modified.

Root cause reproduced offline: two active summaries can exceed the 60,000-character source cap together, leaving tier recovery with zero model calls despite compressible summaries.

Change: preserve fitting-span preference; when none fits, split the first eligible pair using the existing splitter. Bound each source chunk by character/token budgets and reserve all calls before dispatch. Apply only one joined result, after every chunk succeeds. Cancellation, failed summaries, excessive joined length and apply refusal do not silently truncate source content.

Owner and exact SHA256 are pinned in generate.mjs. A different installed bundle is rejected. This is not a portable upstream source patch.

Reproduce original failure (expected nonzero exit):
  node --test --test-name-pattern='full preflight recovers' patches/billion-context-tier-recovery/recovery.test.mjs

Generate a fresh workspace-only candidate (output must not already exist):
  node patches/billion-context-tier-recovery/generate.mjs patches/billion-context-tier-recovery/candidate-check.js

Verify candidate:
  CANDIDATE=patches/billion-context-tier-recovery/candidate-check.js node --test patches/billion-context-tier-recovery/recovery.test.mjs patches/billion-context-tier-recovery/guards.test.mjs patches/billion-context-tier-recovery/review.test.mjs
  node --test test/

The fixture executes extracted installed preflight/splitter code in a VM. Model calls, core processing, token counting and applyRanges are mocked. It does NOT establish real-kernel protected-range safety, summary semantic fidelity, production recovery, or end-to-end resumption of an interrupted task. No paid model request is made.

Before live use: separately authorize installed-runtime changes, back up the exact owner, validate against real kernel/protected ranges and a controlled session, then test restart/resumption. Remove this version-specific workaround when upstream provides equivalent verified recovery. Do not auto-apply after an upgrade.

Only generator, harness, tests and this text are maintained deliverables. Full generated bundles and historical red/green logs are local scratch artifacts, not the source of truth.
