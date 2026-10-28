# ThreeUI 1.2.0 compatibility verification

A self-contained, intentionally small compatibility test bench, not a production design system. Changes belong only to this directory. No global skill, installed dependency source, unrelated workspace file, or DSH server is modified. No downgrade or warning filter is used. No commit is made; the lead reviews and commits.

## Reproduce

Node used: 26.8.2. Dependencies are pinned and the npm lockfile resolves registry tarballs, not the original `/tmp/3d-test` dependency tree.

```sh
cd tools/threeui-compat
npm ci --ignore-scripts
npm test
npm run preview
```

In another terminal:

```sh
python3 -m venv .venv
.venv/bin/pip install -r requirements-test.txt
.venv/bin/python -m playwright install chromium
.venv/bin/python tests/browser.py
```

On the original verification host the existing Python environment was used instead:

```sh
/home/dzerok/venvs/agentskills/bin/python tests/browser.py
```

The preview is only this demo at `http://127.0.0.1:5207`, not a replacement DSH server. Stop it after testing. Browser tests use the scene's authored `?q=low&post=0&shadow=0&dpr=1` quality controls to bound software WebGL work. Default high-quality rendering timed out during a screenshot after the shader repair; do not claim high-quality performance is verified.

## Specimens and scope

- **Shader:** `EmeraldHorizonBackground`, imported from the supported `@designcodeio/threeui/components/EmeraldHorizonBackground` export. Real fragment shader, bundled `three128`, no required external asset request observed.
- **Scene:** `TempleNightScene`, copied with its renderer from the installed 1.2.0 package under MIT. This is the narrow host-API adaptation, not a replacement scene. It builds procedural textures locally.
- **Interaction:** `GradientPillButton`, supported component subpath; left as the real upstream iframe implementation, including observed limitations.
- **External probe:** `NebulaBackground`, supported subpath; exercises a second iframe implementation. Its motion is measured separately.
- The public package stylesheet is imported once. Only one specimen mounts at a time; lazy imports keep inactive components unmounted.

Design read: an editorial, dark-green technical lab with serif display typography, not a new landing-page product. Motion plan: native shader drift; scene atmosphere/sway; upstream iframe interaction where available; button hover/focus/active feedback. Deliberately no additional entrance/scroll animation or GSAP dependency: those would contaminate the lifecycle measurements and are outside the compatibility contract. Reduced motion uses a live media-query listener and never mounts a canvas or iframe; the static fallback retains the layout and controls.

## Root causes and repair

`npm test` builds the unmodified supported scene subpath through a separate baseline entry, then the repaired project. The baseline succeeds **with warnings**, so an exit code of zero alone is not an acceptance test:

```text
[IMPORT_IS_UNDEFINED] Import `LinearEncoding` will always be undefined
[IMPORT_IS_UNDEFINED] Import `sRGBEncoding` will always be undefined
```

The vendored renderer migrates `renderer.outputEncoding` to `outputColorSpace`, choosing `LinearSRGBColorSpace` for the postprocessing path and `SRGBColorSpace` otherwise; procedural textures migrate `encoding` to `colorSpace` using `SRGBColorSpace`.

A real-browser run then exposed another incompatibility not detectable by the bundler:

```text
THREE.WebGLProgram: Shader Error ... VALIDATE_STATUS false
ERROR: ... 'vUv' : undeclared identifier
```

The foliage `MeshBasicMaterial.onBeforeCompile` expected a legacy UV varying that the current host shader no longer declares. The repair declares and assigns `vTempleUv` explicitly in both shader stages. It preserves the original UV values, edge fade and sway math. The pre-fix browser error strings are retained in the evidence directory.

The final build retains Vite's real >500 kB chunk advisory. It is not suppressed or confused with a compatibility failure. Large native scene/legacy Three.js chunks remain a deployment concern.

## Evidence and interpretation

- `evidence/npm-ci.txt`: clean registry installation and locked reinstall, zero audited vulnerabilities at verification time.
- `evidence/baseline-build.txt`: exact original build warnings.
- `evidence/fixed-build.txt` and `evidence/build-test.txt`: repaired build and automated warning assertions.
- `evidence/pre-uv-fix-runtime.json`: distinct shader compilation and WebGL errors before the second repair.
- `evidence/browser-report.json`: desktop/mobile motion deltas, requests, failed requests, HTTP statuses, JS/WebGL errors, observer and RAF counts, reduced motion.
- `evidence/*-shader.png`, `*-scene.png`, `*-interaction.png`, `*-nebula.png`, `*-reduced-motion.png`: full-page desktop/mobile screenshots.
- `evidence/*-a.png` and `*-b.png`: two time-separated cropped frames; numeric pixel differences establish actual visual motion instead of merely counting RAF callbacks.

Native specimens each undergo four mount/unmount cycles per viewport. Pending RAF count, connected ResizeObserver/IntersectionObserver count and mounted canvas count must all return to zero. Iframe removal is checked separately, once per iframe specimen rather than across repeated cycles. The `gl` counter is cumulative parent-document contexts created, not live contexts or GPU memory; it excludes iframe contexts. Reduced-motion assertions cover the selected shader fallback, not every specimen's internal runtime. These checks demonstrate bounded visible scheduling/DOM cleanup, **not** a GPU VRAM/heap leak proof or exhaustive event-listener accounting. Device profiles are Chromium at 1440×1100 and 390×844, DPR 1; this is not real phone hardware or Safari/Firefox coverage.

`GradientPillButton` was transiently observed with an empty iframe body and zero buttons on the first run and a separate diagnosis, despite a Tailwind request and upstream source containing a button. In the final run the real button appeared on both viewports and Playwright successfully hovered/clicked it. Its resting frames are identical (pixel delta zero), as expected for a hover-only specimen; no application action callback is asserted. This variation is an observed iframe/CDN initialization reliability limitation, not a deterministic library-wide failure. The demo does not substitute a different library. `NebulaBackground` is evaluated separately and shows nonzero frame deltas. Tailwind CDN production-use warnings are reported, not hidden. Native host and bundled `three128` also trigger `THREE.WARNING: Multiple instances of Three.js being imported.`; screenshot readback emits GPU-stall performance advisories on desktop. These warnings remain visible; no runtime warning-free claim is made. Final external resource responses include Tailwind, Iconify, GSAP, Google Fonts and CDN Three.js, so iframe specimens are not offline-self-contained even though the project and native specimens are reproducibly installable.

Screenshots are real browser captures; the executing model lacked image input and could not visually inspect them. The lead/human must check aesthetics and the scene's intended appearance. Pixel motion and JS/WebGL checks do not establish artistic fidelity.

## License and provenance

`src/vendor/PROVENANCE.json` records package version, original package paths, SHA-256 hashes and every intended source change. `src/vendor/LICENSE.threeui` retains the complete MIT license and copyright. `src/vendor/ASSET-LICENSES.upstream.md` retains the package asset notices. Only the procedural temple module and its React wrapper are copied; no sample photograph/font asset is extracted. Installed packages remain unedited.

## Suggested ThreeUI skill guidance

1. Prefer documented `/components/Name` exports, never private renderer paths or unsupported named imports.
2. Pin a tested ThreeUI + host Three.js combination. A successful bundle does not mean API compatibility: inspect warnings and run real WebGL.
3. Host-dependent scenes can retain legacy color APIs and injected-shader assumptions even when most components use bundled Three.js aliases.
4. If adapting licensed source, copy only the necessary component dependency closure; preserve MIT/provenance and patch the actual API/GLSL cause. Never edit `node_modules`, downgrade to hide the symptom or suppress warnings.
5. Audit iframe srcDoc, CDN/font/image/network behavior and rendered DOM, not just top-level canvas counts. A component catalog entry is not a reliability guarantee.
6. Check visual motion using multiple frames, live reduced-motion fallback and repeated lifecycle cleanup. Disclose software-rendering quality limits and unverified interaction paths.
7. Do not promise a warning-free build when only compatibility warnings were repaired; retain and report bundle-size advisories.
