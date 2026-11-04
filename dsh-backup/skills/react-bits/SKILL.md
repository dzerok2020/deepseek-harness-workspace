---
name: react-bits
description: "Add React Bits animated components: text effects, marquee, particles, magnetic buttons."
---

# React Bits — copy-in animated components

React Bits is an open-source collection of **source components** you install into your repo (not an npm component package). 217 free components across 5 categories, each in 4 variants: JS/TS × CSS/Tailwind.

Vietnamese triggers: `react-bits`, `React Bits`, `hiệu ứng chữ`, `chữ động`, `background động`, `nền động`, `micro-interaction`, `nút magnetic`, `marquee`, `particle text`.

## What you get

| Category | Count | Examples |
|---|---|---|
| Text Animations | 33 | SplitText, BlurText, GradientText, DecryptedText, ScrollFloat, CountUp |
| Animations | 38 | AnimatedContent, FadeContent, Magnet, ClickSpark, StarBorder |
| Components | 48 | AnimatedList, CardSwap, Carousel, Dock, GlareHover, Stepper |
| Micro | 35 | Toggle, LikeButton, Loader, CopyButton, ThemeSwitch |
| Backgrounds | 63 | Aurora, Particles, Beams, Threads, Waves, Hyperspeed, GridMotion |

Full searchable list with descriptions + CLI ids: `references/catalog.md`.

## Install — choose one path

### A. Tailwind + shadcn project (preferred)

```bash
npx shadcn@latest add https://reactbits.dev/r/SplitText-TS-TW
```

- `SplitText` = component id (PascalCase, from the catalog).
- `TS` / `JS` = TypeScript or JavaScript.
- `TW` / `CSS` = Tailwind or plain CSS variant.
- The registry item writes the component file and prints any npm dependencies to install.

### B. jsrepo

```bash
npx jsrepo@latest add https://reactbits.dev/r/SplitText-TS-CSS
```

### C. Manual registry install (Vite, non-Tailwind, or CLI trouble)

The registry endpoint returns JSON with `files[].content`, `files[].path`, and `dependencies`:

```bash
curl -sL https://reactbits.dev/r/SplitText-TS-CSS.json -o /tmp/splittext.json
node -e "
const fs=require('fs'); const j=require('/tmp/splittext.json');
for (const f of j.files) { fs.mkdirSync(require('path').dirname('src/'+f.path),{recursive:true}); fs.writeFileSync('src/'+f.path, f.content); }
console.log('deps:', (j.dependencies||[]).join(' '));
"
npm install gsap@^3.13.0 @gsap/react@^2.1.2
```

Replace `SplitText-TS-CSS` with the target id. Keep the registry's file path relative to your components root (`src/` in a Vite app).

## Choose the variant correctly

| Project | Use | Why |
|---|---|---|
| React + TypeScript + Tailwind | `-TS-TW` | typed, classes match the project |
| React + TypeScript, no Tailwind | `-TS-CSS` | component carries its own CSS/inline styles |
| JavaScript + Tailwind | `-JS-TW` | no TS setup |
| JavaScript, no Tailwind | `-JS-CSS` | simplest drop-in |

Do **not** install a `TW` variant into a project without Tailwind configured; the classes will silently do nothing. Do **not** mix `CSS` and `TW` copies of the same component.

## Dependencies

React Bits components are source, so dependencies are per component. Always read the registry `dependencies` or the component's import block.

Common:
- GSAP-based text/scroll components: `gsap` + `@gsap/react` (SplitText uses `gsap/SplitText` and `ScrollTrigger`).
- Motion-based components: `motion` (Framer Motion).
- WebGL backgrounds: `three`, `ogl`, or `@react-three/fiber` — these are heavy; lazy-load them.
- Icons: `lucide-react`.

Install only what the chosen component needs. A text component should not pull `three`.

## Usage pattern

```tsx
import SplitText from './components/SplitText'

<SplitText
  text="Build worlds, not pages."
  tag="h1"
  splitType="chars"
  from={{ opacity: 0, y: 40 }}
  to={{ opacity: 1, y: 0 }}
  duration={0.8}
  ease="power3.out"
  trigger="load"
/>
```

Most components accept `className`; style the wrapper, not the component's internal nodes. If a component hardcodes colors, override via the props it exposes (e.g. `colors`, `color`, `gradientFrom/To`) before reaching for `!important`.

## Integration and conflict rules

| Need | Use | Don't also use |
|---|---|---|
| Headline reveal | one React Bits text component **or** a GSAP SplitText timeline | both on the same heading |
| Full-screen atmosphere | one React Bits background **or** one ThreeUI shader background | two canvases / two animated backgrounds |
| Icon state change | `morphicons` | React Bits icon animation + Morphicons on the same icon |
| Scroll choreography | `gsap-scrolltrigger` around sections | a React Bits scroll component plus a second ScrollTrigger on the same section |
| Design direction | one lead (`impeccable` / `design-taste-frontend`) | a second design lead |

- React Bits is a **leaf component library**, not the design lead. Decide hierarchy/typography first.
- A React Bits component may internally use GSAP; that is fine. Don't create a second tween targeting the same element.
- Backgrounds count as ambient motion. Pair with at most one entrance animation and one micro-interaction layer.
- If the component sets `'use client'`, it is harmless in Vite; keep it for Next.js App Router.
- For React 19 + Next 15, check the component's peer imports; most are plain React and work.

## Performance

- Lazy-load heavy backgrounds:
  ```tsx
  const Aurora = lazy(() => import('./components/Aurora'))
  ```
- Avoid mounting a particle/WebGL background on mobile if it covers the whole page; provide a CSS gradient fallback.
- Cap particle counts and DPR; test at 390×844.
- Honor `prefers-reduced-motion`: most components expose `disableAnimation` or respect it; if not, gate the component with a `useReducedMotion` hook.
- Don't stack `backdrop-filter` layers over a canvas; it is expensive on low-end GPUs.

## License — read before shipping

React Bits is **MIT + Commons Clause**. You may use components in commercial apps/websites/products. You may **not** sell, sublicense, or redistribute the components themselves (alone, in a bundle, or ported), and you may not resell the tools' exports as asset packs. Keep the copyright notice. React Bits Pro is a separate paid product; do not assume Pro blocks are in the free registry.

## Common errors

| Symptom | Cause | Fix |
|---|---|---|
| `404` from registry | wrong id/case or wrong variant suffix | copy the exact CLI id from `references/catalog.md` |
| Styles missing | installed `TW` without Tailwind, or forgot the component's CSS file | use `CSS` variant or configure Tailwind |
| `gsap/SplitText is not exported` | old gsap (<3.13) | `npm install gsap@^3.13.0` |
| Text invisible | `from` opacity 0 and trigger never fires (SSR/no IntersectionObserver) | set `trigger="load"` or ensure the section is in view |
| Huge bundle | imported a `three`/`ogl` background eagerly | `React.lazy` + dynamic import |
| Duplicate animation | React Bits text + GSAP SplitText on same node | remove one |

## Verification checklist

- [ ] Correct variant for the project (TS/JS, CSS/TW).
- [ ] All registry `dependencies` installed.
- [ ] Component imported from the written path; no duplicate copy.
- [ ] Desktop + mobile screenshots; text visible after animation, no layout shift.
- [ ] `prefers-reduced-motion` checked.
- [ ] No second animation owner on the same element.
- [ ] License notice retained.

## References

- `references/catalog.md` — 217 free components with descriptions, URLs, CLI ids, grouped by category.
