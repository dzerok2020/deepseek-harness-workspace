---
name: morphicons
description: "Morph SVG icons into each other with spring physics; animated stateful icons."
---

# Morphicons — spring icon morphing

Morphicons interpolates one SVG icon into another with spring physics. It is a **runtime library** (zero dependencies) with bindings for React, Vue, Svelte, React Native, Astro, and plain DOM. It is the single owner of icon state transitions in this workspace.

Vietnamese triggers: `morphicons`, `icon chuyển động`, `icon mượt`, `morph icon`, `đổi icon`, `menu thành X`, `play pause icon`, `tim outline filled`.

## Install

```bash
npm install morphicons
```

React binding: `morphicons/react`. Peer React is optional for the core; the React entry needs React 18/19.

## Icons are data, not components

This is the #1 mistake. Morphicons needs an **IconNode** (Lucide's data format: `[tag, attrs]` tuples) or a path `d` string.

```tsx
import { MorphIcon } from 'morphicons/react'
import { Menu, X } from 'lucide'          // ✅ data
// import { Menu, X } from 'lucide-react' // ❌ React components — not accepted
```

For static (non-morphing) icons use `lucide-react` components. For morphing icons use `lucide` data. Do not import the same icon from both packages in one component.

Any 24×24 icon set works directly. For 20/32 grids, fit once at module scope:

```tsx
import { fitIcon } from 'morphicons'
const heroSolid = fitIcon(HeroiconData, 20)  // source viewBox 20 → 24 grid
const carbon = fitIcon(CarbonIconData, 32)   // source viewBox 32 → 24 grid
```

`fitIcon(input, viewBox, grid = 24)` re-grids centered and preserves aspect ratio (SVG `xMidYMid meet`). Fit both endpoints of a morph onto the same grid; otherwise the solver reads scale/offset as rotation.

## Three modes

### 1. Uncontrolled — change `icon`, it morphs

```tsx
const [open, setOpen] = useState(false)

<button onClick={() => setOpen(v => !v)} aria-label={open ? 'Close menu' : 'Open menu'}>
  <MorphIcon icon={open ? X : Menu} size={20} reducedMotion="user" />
</button>
```

First mount appears without animating; subsequent `icon` changes animate.

### 2. Controlled — you drive progress (drag, scroll, slider)

```tsx
<MorphIcon from={Menu} to={X} progress={progress} />  // 0..1, frozen morph, no spring
```

While `from` and `to` are set they win over `icon`. Leaving controlled mode and coming back behaves like a fresh mount.

### 3. Imperative — ref

```tsx
import type { MorphHandle } from 'morphicons/react'
const ref = useRef<MorphHandle>(null)

<MorphIcon ref={ref} icon={Menu} />
// later
ref.current?.morphTo(X)          // spring
ref.current?.set(X)              // jump
```

## Props (React)

| Prop | Type | Notes |
|---|---|---|
| `icon` | `IconInput` | uncontrolled current icon |
| `from` / `to` | `IconInput` | controlled endpoints |
| `progress` | `number` | 0..1, controlled mode |
| `spring` | `'snappy' \| 'smooth' \| 'bouncy' \| { stiffness, damping }` | default `snappy` |
| `reducedMotion` | `'never' \| 'user' \| 'always'` | use `'user'` for production |
| `size` | `number \| string` | SVG size |
| `color` | `string` | stroke/fill follows `currentColor` by default |
| `strokeWidth` | `number \| string` | stroke icons |
| `absoluteStrokeWidth` | `boolean` | like lucide-react |
| `label` | `string` | with label → `role="img"` + `<title>`; without → `aria-hidden` |

Spring presets: `smooth` ζ=1.00 (k=170, c=26), `snappy` ζ=0.73 (k=420, c=30), `bouncy` ζ=0.40 (k=300, c=14). Use `smooth` for subtle UI, `bouncy` only for playful accents.

## Recipes

### Menu ↔ close (verified)
```tsx
<MorphIcon icon={open ? X : Menu} size={20} color="currentColor" spring="snappy" reducedMotion="user" />
```
Put it inside a `<button>` with a dynamic `aria-label`; the SVG itself is decorative.

### Play ↔ pause
```tsx
import { Play, Pause } from 'lucide'
<MorphIcon icon={playing ? Pause : Play} label={playing ? 'Pause' : 'Play'} />
```

### Theme sun ↔ moon (outline → filled)
```tsx
import { Sun, Moon } from 'lucide'
<MorphIcon icon={dark ? Moon : Sun} />
```
When either endpoint is filled, both morph as filled shapes; the fill engine (5.4 KB gzip) loads lazily on first use.

### Like / favorite
```tsx
import { Heart } from 'lucide'
// outline vs filled heart: use two icon data variants from your pack
<MorphIcon icon={liked ? HeartFilled : Heart} spring="bouncy" />
```
Do not animate `fill` with CSS at the same time; Morphicons owns the shape.

### Arrow hover
```tsx
<MorphIcon icon={hover ? ArrowUpRight : ArrowRight} size={17} />
```

## Fill icons and preloading

Filled icons lazy-load a 5.4 KB region module on first use. To bundle it or preload:

```ts
import { setRegionLoader, preloadRegion } from 'morphicons/dom'
import * as region from 'morphicons/region'

setRegionLoader(async () => region)
preloadRegion()
```

For long lists of filled icons on low-end devices, precompute with `toRegion(icon)` from `morphicons/region` at build time.

## Other bindings

```vue
<MorphIcon :icon="open ? X : Menu" />
```
```svelte
<MorphIcon icon={open ? X : Menu} />
```
```ts
import { createMorph } from 'morphicons/dom'
const m = createMorph(pathEl, Menu)
m.morphTo(X)
```
Plain HTML: `defineMorphIcon()` from `morphicons/element`, then `<morph-icon icon="M4 6h16..." label="Menu">`.

## Integration rules

- **Morphicons is the only icon-morph owner.** Don't add a CSS `transition: transform` or a GSAP rotation to the same SVG.
- Static icons: `lucide-react`; morphing icons: `lucide` data + `MorphIcon`. Never pass a React component as `icon`.
- In a ThreeUI hero/nav, the MorphIcon is a foreground DOM element; keep it outside the canvas container.
- With React Bits buttons, pass the MorphIcon as the button's child; don't let the button component clone/animate the SVG.
- Use `reducedMotion="user"` so `prefers-reduced-motion` degrades to an instant swap.
- Size is fixed by the SVG viewBox; don't animate `width/height` (layout thrash). Animate surrounding transforms only.

## Performance / size

- React binding ~10.2 KB gzip; core ~6.7 KB; no runtime deps.
- Fill code +5.4 KB gzip, lazy on first filled icon.
- SSR renders the final SVG, so no hydration flash.
- Morphing is per-icon; dozens of simultaneous morphs are fine, but don't animate a 100-row table on scroll.

## Common errors

| Symptom | Cause | Fix |
|---|---|---|
| `icon` renders nothing | passed a React component (`lucide-react`) | import data from `lucide` or use `svgToIcon` |
| Distorted rotation | endpoints on different viewBox grids | `fitIcon(icon, 20/32)` both endpoints |
| No animation on first render | first mount is intentionally instant | change `icon` after mount, or use `from/to` |
| Fill flicker | fill engine lazy-loads | `preloadRegion()` or bundle `morphicons/region` |
| Icon not accessible | no `label` | pass `label`; otherwise it is `aria-hidden` |
| Animation ignores OS setting | `reducedMotion` default `never` | set `reducedMotion="user"` |

## Verification checklist

- [ ] Icon data imported from `lucide`/`@tabler/icons`, not `lucide-react`.
- [ ] Both endpoints on the same grid (`fitIcon` if needed).
- [ ] `reducedMotion="user"` on production icons.
- [ ] Button has `aria-label`; SVG has `label` or is decorative.
- [ ] No CSS/GSAP transform on the same SVG.
- [ ] Screenshot both states (closed/open) in a real browser.
