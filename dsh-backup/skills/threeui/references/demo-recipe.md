# Verified recipe — ThreeUI + Morphicons + React Bits hero

This is the exact combination built and screenshot-verified on 2026-10-28. It is the reference implementation for the skill, not a template to paste blindly.

## Stack that was tested

- Vite 7.3.7 + `@vitejs/plugin-react` 5.1.1, React 19.2
- `@designcodeio/threeui` 1.2.0 (community)
- `morphicons` 2.0.2 + `lucide` (icon data) + `lucide-react` (static icons)
- React Bits `SplitText-TS-CSS` (source copied from the registry), `gsap` 3.13 + `@gsap/react` 2.1.2
- One full-screen shader canvas, one text reveal, one morphing icon, CSS-only foreground

## Files

```text
index.html                  Google Fonts: Instrument Serif + Manrope
src/main.tsx                import '@designcodeio/threeui/style.css' once
src/App.tsx                 shader stage + nav + drawer + hero + specimen
src/SplitText.tsx           React Bits SplitText (TS, CSS variant)
src/styles.css              layer stack, veil, glass, motion
vite.config.ts              react plugin, host 127.0.0.1
```

## Layer stack (the part that makes it look intentional)

```tsx
<div className="shell">
  <div className="stage" aria-hidden="true">
    {reduced ? <div className="static-sky" /> : (
      <EmeraldHorizonBackground speed={0.55} waveScale={1.15} glow={1.35} hue={-14} vignette={0.85} />
    )}
    <div className="grain" />
    <div className="vignette" />
  </div>
  <header className="nav">…</header>
  <main className="hero">…</main>
</div>
```

```css
.stage { position: fixed; inset: 0; z-index: -2; background: #04100c; }
.stage > .threeui-background { width: 100%; height: 100%; }
.shell { position: relative; min-height: 100svh; isolation: isolate; }
.nav { position: relative; z-index: 50; }          /* keeps close button above the drawer */
.hero { position: relative; z-index: 1; }
.grain { position: absolute; inset: 0; opacity: .16; mix-blend-mode: overlay; }
.vignette { position: absolute; inset: 0; background: linear-gradient(180deg, rgba(2,8,5,.72), transparent 26%, transparent 58%, rgba(2,8,5,.86)); }
```

The veil is not decoration: it is what keeps body text readable over a bright shader. Tune the gradient, not the text color.

## Imports that matter

```tsx
// ✅ subpath: avoids pulling the whole catalog and the old-host-three warnings
import { EmeraldHorizonBackground } from '@designcodeio/threeui/components/EmeraldHorizonBackground'

// ✅ icon DATA for morphing
import { MorphIcon } from 'morphicons/react'
import { Menu, X, ArrowUpRight, ArrowRight } from 'lucide'

// ✅ static icons as React components
import { Sparkles, Layers, MousePointer2 } from 'lucide-react'

// ✅ exactly once, at the app root
import '@designcodeio/threeui/style.css'
```

## Stateful nav icon

```tsx
const [open, setOpen] = useState(false)

<button
  className="menu-btn"
  onClick={() => setOpen(v => !v)}
  aria-expanded={open}
  aria-label={open ? 'Close menu' : 'Open menu'}
>
  <MorphIcon icon={open ? X : Menu} size={20} color="currentColor" spring="snappy" reducedMotion="user" />
</button>
```

The icon is inside the button; the SVG is decorative. The button carries the accessible name.

## Reduced motion

```tsx
function useReducedMotion() {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const on = () => setReduced(mq.matches)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return reduced
}
```

Render a static CSS sky instead of the shader when reduced. Do not merely pause the RAF loop; a paused shader still costs a canvas and may show a frozen frame.

## Bugs found and fixed in the real build

1. **Blank drawer when closed.** The drawer used only `opacity: 0`, so its links remained visible and clickable through the page. Fix: `pointer-events: none` + transparent background when closed; `.is-open` restores `pointer-events: auto`.
2. **Nav close button hidden under the drawer.** Fix: `.nav { position: relative; z-index: 50; }` while the drawer is `z-index: 40`.
3. **`Element type is invalid … got: array`.** Cause: a `lucide-react` component was passed to `MorphIcon` as `icon`, or an array was rendered directly. Fix: import morph icon **data** from `lucide`, and static icons from `lucide-react`.
4. **Vite warnings `"sRGBEncoding" is not exported` / `"LinearEncoding" is not exported`.** Came from the package barrel pulling `Gallery`, `TempleNightScene`, `SkeuomorphicToggleCollection`, which import host `three`. Fix: subpath import; the warnings disappeared. Those three components still need `three@0.149` if used.
5. **Mobile gap before the specimen card.** The single-column grid was `align-items: center`, so the card floated to the middle of the free space. Fix: at `max-width: 900px`, `align-items: start; gap: 44px`.

## Verification evidence (from the actual run)

- `npm run build` → `✓ built in 6.13s`; output `dist/assets/index-*.js 892.13 kB │ gzip: 261.46 kB`.
- Playwright desktop 1440×900, mobile 390×844 DPR 2 (full page).
- Console errors: `[]`.
- Drawer closed: `pointer-events: none`, transparent; open: `pointer-events: auto`, `rgba(2,9,6,0.82)`; close button re-closes it.
- Mobile horizontal overflow: `scrollWidth 390 === innerWidth 390`.
- Visual checks: shader horizon visible at the bottom, headline has staggered char entrance, menu icon morphs Menu→X, CTA arrow morphs ArrowRight→ArrowUpRight on hover.

## When to simplify

This page uses three motion layers: shader ambience, SplitText entrance, and icon morph. That is the ceiling for a hero. Remove one if the copy is long, if the page has a second canvas, or if the target is a low-end phone.
