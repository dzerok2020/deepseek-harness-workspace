---
name: threeui
description: "Build premium 3D/WebGL interfaces with ThreeUI's ready-made React components (shader backgrounds, full-page Three.js scenes, shader buttons, text effects). Use when a page needs depth, atmosphere, a living hero, or a 3D world; when the user says 3D web, WebGL, shader, threeui, three.js hero, landing page 3D, nền 3D, hiệu ứng 3D, web 3d đẹp; or when choosing between a ThreeUI component and a custom three.js scene. Includes a 43-component catalog, install rules, asset handling, performance guards, reduced-motion fallback, and integration with gsap-*, react-bits, morphicons. Not a general design lead: pair it with exactly one design lead from vibe-code."
---

# ThreeUI — 3D interface components

ThreeUI is a **catalog of finished React components** (community source under MIT; check the package's `ASSET-LICENSES.md` separately for fonts, media and third-party/CDN assets) built on Three.js: shader backgrounds, full-page 3D scenes, shader buttons, text animations, and UI specimens. It is not a design system and not a 3D engine. It gives you a finished atmospheric layer quickly; the page's hierarchy, typography, and brand still come from the design lead.

Vietnamese triggers: `web 3d`, `giao diện 3d`, `nền 3d`, `shader`, `threeui`, `three.js`, `landing page 3d`, `hiệu ứng chiều sâu`.

## When to use / not use

Use it when:
- A hero needs a living background: emerald horizon, liquid metal, particles, CRT, constellation, element fields.
- You want a full-page Three.js scene without writing the renderer (landscape, temple, bookshelf, country towers).
- You need one polished shader button, text vortex, or specimen panel.
- The user explicitly asks for ThreeUI or a Three.js look.

Do not use it when:
- The task is a data-dense dashboard with no atmospheric layer — use the design lead + `ui-styling`.
- You need a custom 3D product configurator, GLTF model, camera path, physics, or precise interaction with a 3D object. Use raw `three` / React Three Fiber; ThreeUI's scenes are authored, not a scene-graph API.
- The page already has a full-screen animated background from React Bits. **One ambient full-screen layer per page.**

## Install (verified)

```bash
npm install @designcodeio/threeui three
```

Peer requirements: React/ReactDOM `>=18 <20`, three `>=0.149 <1`. ThreeUI bundles its own aliases `three128` (r128) and `three165` (r165) for most components, so the host `three` version only matters for the three components that import the host package (see pitfalls).

Import the shared stylesheet **once** at the app root:

```tsx
import '@designcodeio/threeui/style.css'
```

Import components from a **component subpath**, not the package barrel:

```tsx
import { EmeraldHorizonBackground } from '@designcodeio/threeui/components/EmeraldHorizonBackground'
```

Use only subpaths exported by the installed package; check its `exports` map before choosing a component. Avoid the barrel (`from '@designcodeio/threeui'`): it pulls unrelated components into the build graph and can surface legacy Three.js API warnings. Prefer subpaths and `React.lazy` for below-the-fold scenes. Lazy loading alone does not prevent mounting or animation: gate mounting on viewport visibility separately.

## Quick start — living hero

```tsx
import '@designcodeio/threeui/style.css'
import { EmeraldHorizonBackground } from '@designcodeio/threeui/components/EmeraldHorizonBackground'

export function Hero() {
  return (
    <section className="hero">
      <div className="stage" aria-hidden="true">
        <EmeraldHorizonBackground speed={0.55} waveScale={1.15} glow={1.35} hue={-14} vignette={0.85} />
      </div>
      <div className="hero-copy">
        <h1>Build worlds, not pages.</h1>
        <p>...</p>
      </div>
    </section>
  )
}
```

```css
.hero { position: relative; min-height: 100svh; isolation: isolate; }
.stage { position: absolute; inset: 0; z-index: -1; }
.stage > .threeui-background { width: 100%; height: 100%; }
.hero-copy { position: relative; z-index: 1; }
```

The component's root gets class `threeui-background`; its CSS sets `height: 100%`, so **the parent must have a real height** (`100svh`, absolute inset, grid row). A zero-height parent is the #1 cause of a blank canvas.

## Selection workflow

1. Read `references/catalog.md`. Pick by **job**, not by category name:
   - ambient background → Backgrounds / CSS / selected Three.js fields
   - complete hero/page → Hero / Landing Pages
   - scroll world → Three.js (Landscape, Temple Night, Sylva Living World, Country Towers)
   - one accent → Buttons / Text Animation / UI Elements
2. Open the component's `.d.ts` in `node_modules/@designcodeio/threeui/lib-dist/package-components/<Name>.d.ts` and confirm props. Do not guess props from the label.
3. Check whether it is a **collection** with variants (`variants` in the catalog). Pass `variant="..."` only if the type declares it.
4. Check whether it needs public assets (full-page components — see below).
5. Add a reduced-motion branch and a static fallback before shipping.
6. Verify with a real browser screenshot; a WebGL canvas can be blank while the DOM looks fine.

## Composition recipes

### A. Atmospheric landing hero (recommended default)
- One background component (`EmeraldHorizonBackground`, `LiquidFormBackground`, `ConstellationField`, `LaserCollection`, …).
- One text reveal: React Bits `SplitText`/`BlurText` **or** a GSAP timeline — never both on the same heading.
- One Morphicons state icon in the nav/CTA (menu→X, arrow→diagonal).
- CSS-only glass/specimen panel for foreground depth; do not nest a second WebGL canvas inside it.
- Keep the shader behind a dark veil (`linear-gradient`) so body text keeps WCAG contrast.

### B. Full-page 3D world
- Use `LandscapeScene`, `TempleNightScene`, `SylvaLivingWorldScene`, `JapaneseTowerLandscape`, or `BookshelfScene`.
- These are complete documents/scenes; treat them as a **page section**, not a card background.
- Use GSAP `ScrollTrigger` for the surrounding page, not to animate the scene's internals.
- Copy the assets (below), then verify at desktop + mobile widths.

### C. Product / SaaS panel
- `LiquidMetalButton`, `RectangleButtons`, `CircleButtons`, or `ShaderButtons` for one primary action.
- `DiagnosticsPanel`, `PerformanceGauges`, `EngravedCertificate`, `BrandOrbs` for a specimen/floating panel.
- Pair with `impeccable` for the product shell; ThreeUI supplies the accent, not the layout.

### D. Text as a 3D object
- `TypographyVortexCanvas`, `SemanticBloom`, `TextPathStudies`, `GalleryHeading`, `TextAnimationCollection`.
- These are **already choreographed**. Do not wrap them in another split-text or scramble animation.

## Integration rules (conflict prevention)

| Need | Use | Do not also use |
|---|---|---|
| Full-screen atmosphere | one ThreeUI background / one React Bits background | a second canvas, `tsparticles`, video background |
| Headline reveal | React Bits `SplitText` **or** GSAP SplitText timeline | both on the same text node |
| Icon state change | `morphicons` `MorphIcon` with icon **data** | `lucide-react` component passed as `icon` |
| Scroll choreography | `gsap-scrolltrigger` | CSS scroll timelines on the same sections |
| Design direction | one lead: `impeccable` / `design-taste-frontend` | a second design lead |
| Logo intro | `pixel2motion` standalone HTML | rebuilding the same logo animation in ThreeUI |

- ThreeUI is an **asset/library skill**, not a design lead. Load the design lead first, then ThreeUI for the atmosphere.
- GSAP remains the owner of timeline choreography. A ThreeUI component's internal animation is self-contained; don't try to scrub it with ScrollTrigger.
- If both React Bits and ThreeUI offer a background, choose by motion character: React Bits for light DOM/CSS/particle backgrounds, ThreeUI for heavier shader/3D worlds. One per page.
- Morphicons is the only icon-morph owner. For static icons use `lucide-react`; for morphing icons import data from `lucide` (not `lucide-react`) and pass it to `MorphIcon`.

## Performance guards

- **One WebGL canvas above the fold.** Each canvas is a renderer + RAF loop. Multiple canvases cause GPU stalls and battery drain.
- Lazy-load below-the-fold scenes:
  ```tsx
  const LandscapeScene = lazy(() =>
    import('@designcodeio/threeui/components/LandscapeScene').then(m => ({ default: m.LandscapeScene }))
  )
  ```
- Mount only when visible: use an `IntersectionObserver` boundary, unless inspection and a runtime test prove the selected component pauses offscreen. Do not assume iframe animations stop when their host leaves the viewport.
- Cap DPR (components already clamp to 2); don't set a higher `devicePixelRatio` globally.
- Respect `prefers-reduced-motion`: replace the shader with a static CSS gradient, not just a paused canvas.
  ```tsx
  const reduced = useReducedMotion()
  {reduced ? <div className="static-sky" /> : <EmeraldHorizonBackground />}
  ```
- Test on a mid-range phone profile (390×844, DPR 2) and check for long tasks / dropped frames.

## Accessibility

- The stage is decorative: `aria-hidden="true"` on the canvas container.
- Never put essential text inside the canvas; keep all copy in DOM.
- Keep a dark veil between shader and text; verify contrast after the veil.
- Provide a reduced-motion static state and a `noscript`/no-WebGL fallback (CSS gradient + copy).
- If a WebGL context is lost, the page must still read; don't block render on `onContextLost`.

## Full-page components and assets

These render a complete HTML document in an iframe and expect files at root-relative URLs:
`KageLandingPage`, `MengToSketchbookLandingPage`, `LandscapeScene`, `JapaneseTowerLandscape`, `SparkBadge`.

Copy from the package into the app's public directory:

```bash
cp -R node_modules/@designcodeio/threeui/lib-dist/assets/landing-pages public/
cp node_modules/@designcodeio/threeui/lib-dist/assets/landscape.html public/
cp node_modules/@designcodeio/threeui/lib-dist/assets/japanese-tower.html public/
cp node_modules/@designcodeio/threeui/lib-dist/assets/spark-badge.html public/
```

Or pass `sourceUrl` / `assetBaseUrl` where the component's props allow it. If the page is blank inside the frame, check the Network tab for 404s under `/landing-pages/...` first.

## Host `three` pitfalls

Only three community components import the **host** `three` package: `Gallery`, `TempleNightScene`, `SkeuomorphicToggleCollection`. With `three@0.165` (tested) Vite warns:

```
"sRGBEncoding" is not exported by "node_modules/three/build/three.module.js"
"LinearEncoding" is not exported by "node_modules/three/build/three.module.js"
```

Reproduce against the selected component, not just the barrel. Prefer a compatible exported subpath. If the chosen source itself needs a fix, use a package-manager patch committed with the app or a source-vendored copy with upstream version, provenance and MIT notice. Never manually edit `node_modules`, suppress warnings, or blanket-downgrade/override Three.js.

For modern Three.js, migrate `renderer.outputEncoding = THREE.sRGBEncoding` to `renderer.outputColorSpace = THREE.SRGBColorSpace` only after checking the renderer's actual Three.js version. Color textures may need `texture.colorSpace = THREE.SRGBColorSpace`; normal/roughness/metalness data must not be labeled sRGB. An iframe's legacy Three.js is a separate runtime: do not mass-replace its APIs using the host version.

Subpath exports do not imply native React rendering. Many components embed sandboxed `iframe srcDoc` with independent Three.js/GSAP/Tailwind/Iconify CDN scripts. Inspect the selected source and record external URLs, asset/license requirements, CSP needs and offline behavior. Host GSAP, theme props and reduced-motion CSS cannot automatically control opaque iframe internals. For offline delivery or precise scene control, choose a proven local component or a licensed source-vendored adaptation. Do not infer compatibility of every component from a single passing example.

## Pro / paid components

The npm package is the **Community** edition. Pro source is not on npm; it is downloaded with `npx @designcodeio/threeui-cli add <component>` after OAuth and entitlement checks. Do not promise Pro components from the public package, and do not copy Pro source into a repo without a license.

## Verification checklist

- [ ] `@designcodeio/threeui/style.css` imported exactly once.
- [ ] Component imported from a subpath, not the barrel.
- [ ] Parent of `.threeui-background` has non-zero height.
- [ ] One WebGL canvas per view; below-fold scenes lazy/observer-gated.
- [ ] Reduced-motion branch renders a static fallback.
- [ ] Desktop (1440×900) + mobile (390×844) screenshots inspected; canvas is not blank.
- [ ] Build and console have no missing-export, 404 asset, or WebGL context errors, including iframe logs and failed external requests.
- [ ] Compare multiple rendered frames: verify actual motion, not merely a nonblank screenshot; exercise the chosen interaction.
- [ ] Test initial reduced motion and live preference changes; animated canvases/iframes must unmount and the static state remain readable.
- [ ] Repeated mount/unmount and visibility changes do not accumulate canvases, listeners, RAF loops or WebGL contexts; distinguish observations from unmeasured internals.
- [ ] External CDN/assets and offline/CSP limitations recorded for the selected components; no package-wide compatibility claim.
- [ ] Text contrast checked over the shader veil.
- [ ] Bundle impact measured (`vite build` output), heavy scenes split.

## References

- `references/catalog.md` — 43 parent components / 104 entries, grouped by category, with import names and variants.
- `references/catalog.json` — machine-readable catalog for search/filtering.
- `references/demo-recipe.md` — the verified ThreeUI + Morphicons + React Bits hero used to validate this skill.
