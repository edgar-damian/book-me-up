# Motion

The goal is a page that feels alive when you scroll it and never feels like it is
performing. Two failure modes, equally bad:

- **Boring** — a static HTML document. Nothing acknowledges the cursor, sections just
  appear.
- **Vibecoded** — everything slides, bounces, staggers and parallaxes. Movement for its
  own sake, and the page feels slow because it *is* slow.

The gap between them is narrower than it looks, and it is mostly about restraint in
duration and distance rather than about which effects you pick.

---

## Two tiers

| | Tier 1 — Ambient | Tier 2 — Expressive |
| --- | --- | --- |
| **What** | Hover transitions, fade-and-rise reveals, disclosure | Parallax, staged reveals, animated hero, scroll-linked widgets |
| **When** | **Default.** Almost everywhere | **Only when explicitly asked for** |
| **Budget** | Unlimited — it is ambient | One per page, and it counts as that section's One Move |
| **Cost** | CSS + `IntersectionObserver`, no dependencies | Hand-written, and worth re-checking on a mid-range phone |

**Do not add tier 2 on your own initiative.** If a page seems like it wants an animated
hero, propose it — do not ship it. Tier 1 is what makes a page feel finished; tier 2 is
what makes a specific page memorable, and it is a deliberate choice each time.

---

## Tokens

| Token | Value | Tailwind class | Use |
| --- | --- | --- | --- |
| `--duration-fast` | 120ms | `duration-120` | Hover, color, small state flips |
| `--duration-base` | 200ms | `duration-200` | The default for almost everything |
| `--duration-slow` | 320ms | `duration-320` | Sheets, drawers, disclosure |
| `--duration-deliberate` | 520ms | `duration-520` | Scroll reveals. The slowest allowed |
| `--ease-standard` | `cubic-bezier(0.2, 0, 0, 1)` | `ease-standard` | Default, calm |
| `--ease-entrance` | `cubic-bezier(0.16, 1, 0.3, 1)` | `ease-entrance` | Things arriving |
| `--ease-exit` | `cubic-bezier(0.4, 0, 1, 1)` | `ease-exit` | Things leaving |
| `--reveal-distance` | 16px | — | Travel for a scroll reveal |

> **`duration-base` is not a class.** Tailwind has an `--ease-*` namespace but no
> `--duration-*` one, so `ease-standard` compiles and `duration-base` silently does
> nothing. Use the bare numerics above — they match the token values exactly. The CSS
> variables remain for hand-written CSS and inline styles.

**Nothing exceeds 520ms.** If an animation needs longer, it is doing too much.

**No bouncy or elastic easings.** No overshoot, no spring, no `cubic-bezier` with a
negative control point. That is the single fastest way to make this product read as
amateur. The easings above are calm on purpose.

---

## Tier 1 patterns

### Hover

Hover is **a subtle darkening**, nothing else. No lift, no shadow bloom, no border color
change, no scale.

```
transition-colors duration-120 ease-standard
hover:bg-hover-wash
```

On a `primary` fill, hover moves to `primary-hover` and press to `primary-active` rather
than layering a wash.

Hover styles must never be the only way to discover an affordance — phones do not hover,
and this is a mobile-first product.

### Press

`active:bg-press-wash`, or `active:scale-[0.98]` on marketing CTAs only. Keep it at
`duration-120`; a press that lags feels broken.

### Focus

Handled globally in `app.css` via `:focus-visible`. Do not animate it — a focus ring that
fades in is harder to track. If a component restyles the ring, the replacement still
clears 3:1.

### Scroll reveal

The workhorse. Content fades in and rises **16px** as it enters the viewport.

```css
.reveal {
  opacity: 0;
  transform: translateY(var(--reveal-distance));
  transition:
    opacity var(--duration-deliberate) var(--ease-entrance),
    transform var(--duration-deliberate) var(--ease-entrance);
}
.reveal.is-visible {
  opacity: 1;
  transform: none;
}
```

Add `is-visible` with an `IntersectionObserver` at roughly `threshold: 0.15`, and
**unobserve after the first trigger** — content that re-animates every time you scroll
past is the most common way this reads as gimmicky.

Rules that keep it tasteful:

- **16px of travel, not 40.** Long travel is what makes a page feel like it is assembling
  itself.
- **Reveal groups, not elements.** A card grid fades in as one unit. Animating every card
  individually is the vibecoded look.
- **Stagger sparingly** — at most 3–4 items, ~60ms apart. Never stagger a 12-item list.
- **Never reveal above the fold.** The first screen is already visible when the page
  loads; animating it delays the content the user came for.

> **The unanimated state must be the visible state.** Write the reveal so that if JS never
> runs, or `prefers-reduced-motion` is set, the content is simply *there*. Never ship a
> pattern where `opacity: 0` is the default and only JS can undo it — that is a blank page
> for anyone the observer fails on.

A safe way to guarantee that: add the `reveal` class from JS on mount rather than in the
markup, so no-JS renders plain visible content.

### Disclosure

Accordions, dropdowns, expanding rows: `duration-320` with `ease-standard`. Animate
`grid-template-rows` or `max-height` plus opacity. Content inside should not itself
animate — the container moving is enough.

### Loading

**Spinners**, not skeletons. A spinner on `primary` or `ink-muted`, continuous rotation at
roughly 700ms. Skeleton screens imply a data-dense product, and this one is deliberately
not that.

Delay the spinner ~150ms before showing it — most transitions finish faster than that, and
a spinner that flashes on every action makes the app feel slower than one that stays quiet.

---

## Tier 2 patterns

Reach for these **only when asked**. Each one is that section's One Move.

- **Animated hero** — a headline and its supporting widget arriving in sequence on load.
  Total sequence under 1s.
- **Parallax** — background moving slower than foreground. Keep the differential under
  ~15%; anything more induces motion discomfort and looks dated.
- **Staged reveal** — a section that assembles in a specific order to explain something
  (for example, a booking filling a slot). Justified only when the sequence *is* the
  explanation.
- **Scroll-linked widget** — a product surface that moves or changes as you scroll past
  it. The most expensive to get right; verify on a real mid-range phone.

All four remain CSS + `IntersectionObserver`. If a request genuinely needs frame-accurate
scroll linking, stop and propose adding the `motion` library rather than hand-rolling a
scroll listener — an unthrottled `scroll` handler is a guaranteed jank source.

---

## Reduced motion

`app.css` enforces `prefers-reduced-motion: reduce` globally, collapsing all animation and
transition durations to near-zero.

That global rule is a safety net, **not permission to stop thinking about it.** It only
works because tier-1 patterns are written so the end state is the visible state. Any
pattern where motion is the only path to the final state will break under it — verify by
toggling reduced motion in the OS or emulating it in devtools.

Parallax and scroll-linked effects should be skipped entirely under reduced motion, not
merely sped up. Check `window.matchMedia('(prefers-reduced-motion: reduce)')` before
attaching the listener.

---

## Performance

- **Animate `transform` and `opacity` only.** Animating `height`, `top`, `margin` or
  `box-shadow` forces layout or paint on every frame and will drop frames on a phone.
- No `will-change` unless a specific measured problem calls for it — it costs memory and
  usually makes things worse when applied speculatively.
- One `IntersectionObserver` for many elements, not one per element.
- Test on a mid-range Android, not a desktop. This is a mobile-first product and desktop
  Chrome will hide problems the target device will not.
