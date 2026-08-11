# Foundations — color, type, space, shape, depth

Everything here is defined in `client/app/app.css`. Change a value there and here in the
same commit, or this document starts lying.

Every contrast figure below was computed against WCAG 2.1, not estimated. If you replace
a color, re-run the numbers — do not eyeball it.

---

## How theming works

Three layers, and mixing them up breaks dark mode:

1. **Static scales** live in the plain `@theme` block — type, radius, motion, easing.
   Identical in both themes, safe to inline.
2. **Semantic colors** live in `:root` / `.dark` as ordinary CSS variables, so they can
   swap at runtime.
3. **`@theme inline`** re-exports layer 2 as Tailwind utilities. `inline` is load-bearing:
   it makes `bg-canvas` emit `var(--canvas)` rather than baking in a hex.

> **Adding a semantic color to the plain `@theme` block permanently breaks dark mode for
> that token.** It will look correct in light mode and silently never swap.

Dark mode fires on the OS preference **or** an explicit `.dark` class, and `.light` on the
root forces light. The `@custom-variant dark` definition and the token blocks use the same
three conditions, so `dark:` utilities and automatic swapping can never disagree.

---

## Color

### Surface

| Utility | Light | Dark | Use |
| --- | --- | --- | --- |
| `canvas` | `#ffffff` | `#0d1117` | Pure ground, rarely the page |
| `canvas-soft` | `#f5f7fa` | `#0d1117` | **The page ground.** Never full-page pure white |
| `surface` | `#ffffff` | `#161b22` | Cards, sheets, fields |
| `surface-sunken` | `#eef1f6` | `#10151b` | Wells, table headers, inset areas |

The light canvas carries a whisper of the brand hue rather than being neutral grey — it
keeps the page from reading clinical without going warm and papery.

In dark mode `canvas` and `canvas-soft` are deliberately the same value. Figure/ground in
dark mode comes from `surface` stepping *up* off the ground, not from the ground stepping
down.

### Lines — two tokens, not interchangeable

| Utility | Light | Dark | Contrast | Use |
| --- | --- | --- | --- | --- |
| `hairline` | `#e3e7ec` | `#2a323c` | 1.24:1 | Decorative only — card edges, dividers |
| `border-input` | `#767f8d` | `#6a7684` | 4.05:1 / 3.74:1 | **Every interactive boundary** |

`hairline` is far below 3:1 *by design* — it is a visual seam, not information.
`border-input` clears the 3:1 that WCAG 1.4.11 requires for identifying a UI component.
A text field, checkbox, or select bordered in `hairline` fails that criterion.

### Ink

| Utility | Light | on white | Dark | on canvas | Use |
| --- | --- | --- | --- | --- | --- |
| `ink` | `#0b0f14` | 19.22:1 | `#f2f5f8` | 17.30:1 | Headings, primary text |
| `ink-secondary` | `#2b3440` | 12.59:1 | `#c3ccd6` | 11.65:1 | Body copy |
| `ink-muted` | `#545f6d` | 6.49:1 | `#98a4b3` | 7.48:1 | Supporting copy, **placeholders** |
| `ink-faint` | `#6e7783` | 4.54:1 | `#7d8998` | 5.32:1 | Decorative / disabled only |

`ink` is a near-black with a cool cast rather than pure `#000` — true black on a lit
screen reads harsh at paragraph length.

**`ink-faint` never carries essential information.** It clears 4.5:1 on white but lands at
4.23:1 on `canvas-soft`, so it is scoped to decorative and disabled text where WCAG does
not require the full ratio. Placeholder text — which users must read — uses `ink-muted`.

### Primary — split into fill and text

This is the most important thing to get right, and the single-token version of this
palette was silently failing it.

| Utility | Light | Dark | Use |
| --- | --- | --- | --- |
| `primary` | `#0b69f5` | `#0b69f5` | **Fills.** Buttons, active indicators |
| `primary-hover` | `#0a5ad0` | `#2f7ffa` | Fill hover |
| `primary-active` | `#094cb0` | `#5aa0ff` | Fill pressed |
| `primary-text` | `#0a5ad0` | `#5aa0ff` | **Links and body-size blue text** |
| `primary-wash` | `#e8f0fe` | `#16243a` | Selected rows, subtle fills |
| `on-primary` | `#ffffff` | `#ffffff` | Text on a primary fill |

Why two: white on `primary` is 4.82:1 — a button is fine. But `primary` *as text* on
`canvas-soft` is only 4.25:1, which fails. `primary-text` is the same blue walked darker
until it clears 4.5:1 on both white (6.20:1) and `canvas-soft` (5.78:1).

**Rule: if blue is the background, use `primary`. If blue is the letterform, use
`primary-text`.**

The fill stays identical in dark mode — it still carries white at 4.82:1 and reads vividly
against `#0d1117`. Only the text blue lightens.

### Inverted band

| Utility | Light | Dark | Contrast |
| --- | --- | --- | --- |
| `deep` | `#0a3a8f` | `#08234f` | white on it, 10.42:1 |
| `on-deep` | `#ffffff` | `#ffffff` | — |

A deep **true blue**, deliberately not an indigo that verges on purple. This is the
"inverted band" move from One Move Per Section — one dark island in a light page, used
once or twice, never as a repeated rhythm.

### Danger

| Utility | Light | Dark | Use |
| --- | --- | --- | --- |
| `danger` | `#c02626` | `#c02626` | Destructive fills. White on it, 5.92:1 |
| `danger-hover` | `#a4232b` | `#a4232b` | Fill hover |
| `danger-active` | `#8f1e24` | `#8f1e24` | Fill pressed |
| `danger-text` | `#b3242b` | `#ff8a88` | Destructive links and inline errors |
| `on-danger` | `#ffffff` | `#ffffff` | Text on a danger fill |

Same fill/text split as `primary`, for the same reason.

**`danger` is not `status-rejected`.** A status describes something that already happened
and is painted on a chip; danger asks the user to do something irreversible and is painted
on a button. Keeping them separate is what lets "status colors never fill a button" stay
true. Form validation errors use `danger-text`.

### Interaction

| Utility | Light | Dark |
| --- | --- | --- |
| `hover-wash` | `rgba(11,15,20,0.045)` | `rgba(242,245,248,0.06)` |
| `press-wash` | `rgba(11,15,20,0.09)` | `rgba(242,245,248,0.11)` |
| `focus-ring` | `#0b69f5` | `#5aa0ff` |

Hover is **a subtle darkening**, applied as a wash over the existing surface — not a color
swap, not a lift, not a border change. In dark mode the wash lightens instead, which is
the same gesture inverted.

The focus ring clears 3:1 on every ground it can appear on (4.49:1 light, 6.51:1 dark).

### Accents — decoration with no meaning

| Utility | Light | Tint (light) | Dark | Tint (dark) |
| --- | --- | --- | --- | --- |
| `accent-indigo` | `#3d5a99` | `#e9edf7` | `#93a9dd` | `#1b2437` |
| `accent-magenta` | `#a8306b` | `#fbe9f1` | `#e78ab5` | `#331c29` |
| `accent-amber` | `#b4530a` | `#fbeee1` | `#e5a05f` | `#33220f` |
| `accent-jade` | `#2f7d6f` | `#e6f4f0` | `#6cc4b2` | `#12291f` |

These exist for **visual rhythm only** — alternating icon tiles, illustration blocks,
section color fields. An accent never tells the user anything.

This is stricter than it looks, and the reason is concrete: appointment status already
owns amber, green, red, grey, teal and violet. If an accent did semantic work it would
collide with a status hue almost immediately, and a user would reasonably read a colored
tile as a state. **Verticals are distinguished by icon, never by accent color.**

### Calendar

| Utility | Light | Dark | Contrast |
| --- | --- | --- | --- |
| `day-unavailable` | `#7e8896` | `#6a7684` | 3.35:1 / 3.74:1 |

A past or fully-booked day is shaded but must stay **readable** — the number is still
information. This clears 3:1 on purpose. Do not fade it further and never render it as a
low-opacity wash.

---

## Type

Two families, and the split is strict.

| Token | Family |
| --- | --- |
| `--font-sans` | Inter — every UI surface |
| `--font-display` | Bricolage Grotesque — display sizes only |

Bricolage Grotesque is variable across weight 200–800, width 75–100%, **and optical size
12–96**. The optical-size axis is why it holds together at both 40px and 64px; `app.css`
sets `font-optical-sizing: auto` on `.font-display` so the browser drives it.

`font-display` applies to `text-display-1`, `text-display-2`, `text-heading-1` — nothing
else. From `text-heading-2` down, everything is Inter.

### Scale

Mobile-first and fluid. Sizes `clamp()` and **tracking is expressed in `em`** so it scales
with the size instead of staying glued to the desktop value. A flat 64px headline at
−2.125px tracking collapses at 375px; that was a real defect in the previous scale.

| Token | Mobile → Desktop | Tracking | Weight | Use |
| --- | --- | --- | --- | --- |
| `text-display-1` | 40 → 64px | −0.033em | 700 | Hero headline |
| `text-display-2` | 34 → 54px | −0.031em | 700 | Large section headlines |
| `text-heading-1` | 28 → 40px | −0.025em | 700 | Section headlines |
| `text-heading-2` | 22 → 26px | −0.024em | 700 | Sub-sections |
| `text-heading-3` | 20 → 22px | −0.011em | 700 | Card titles |
| `text-title` | 20px | −0.006em | 600 | Feature titles, callouts |
| `text-body-md` | 16px | 0 | 400 | Default body |
| `text-body-sm` | 15px | 0 | 400 | Dense body, rows, nav |
| `text-button` | 16px | 0 | 500 | Button labels |
| `text-caption` | 14px | 0 | 400 | Captions, footnotes |
| `text-eyebrow` | 12px | +0.01em | 600 | Pills, small labels |

Lining numerals are on globally (`lnum`) — prices and times must not hop the baseline.

The expressive lever is the contrast between a heavy 700 heading and a calm 400 body.
There is no decorative typography beyond that.

---

## Spacing

The scale is exactly Tailwind's 4px base, so no aliases exist and none should be added:
`p-1 p-2 p-3 p-4 p-6 p-7 p-8` → 4/8/12/16/24/28/32.

**Section rhythm is a pattern, not a token:**

```
py-16 md:py-24 lg:py-32     /* 64 → 96 → 128px */
```

Card interiors land at `p-6` (24px). Mobile gutters are `px-4`, widening to `px-6` at `md`.

Whitespace is the primary grouping device — sections separate by vertical gap, not by
rules.

---

## Shape

| Token | Value | Use |
| --- | --- | --- |
| `rounded-xs` | 4px | Form fields, inline chips |
| `rounded-sm` | 5px | Menu items, list rows, status chips |
| `rounded-md` | 8px | Utility and nav buttons |
| `rounded-lg` | 12px | Feature cards, content tiles |
| `rounded-xl` | 16px | Large containers, image wells |
| `rounded-2xl` | 24px | Bottom sheets, full-bleed mobile panels |
| `rounded-pill` | 9999px | Marketing CTAs, badges, circular icon buttons |

**This overrides Tailwind's defaults.** `rounded-lg` is 12px here, not 8px. Read this
table, not the Tailwind docs.

The contrast between pill marketing CTAs and 8px utility buttons is intentional — it is
how a page signals "this is the one action" versus "this is a control."

---

## Depth

| Level | Treatment | Use |
| --- | --- | --- |
| 0 — Flat | `border-hairline`, no shadow | **The default.** Most cards |
| 1 — Soft | `shadow-soft` | Cards that float, sticky bars |
| 2 — Elevated | `shadow-elevated` | Modals, sheets, popovers |

Light-mode shadows are built from many near-transparent layers so surfaces feel lifted off
the page rather than dropped onto it. No hard casts.

**Dark mode inverts the mechanism.** Shadows barely register on a dark ground, so depth
comes from the surface stepping lighter — `canvas` → `surface` → a raised surface. The
dark shadow tokens still exist and are stronger than their light counterparts, but they
separate a floating element from what is behind it rather than creating the depth
themselves. Reaching for a bigger shadow in dark mode is the wrong instinct; reach for a
lighter surface.

---

## Accessibility floors

Non-negotiable, and already satisfied by every token above:

- Body and UI text: **4.5:1**
- Large text (≥24px, or ≥19px bold): **3:1**
- Interactive component boundaries and focus indicators: **3:1** (WCAG 1.4.11)
- Disabled and decorative text: exempt, but this system still holds it above 3:1
- Touch targets: **44×44px minimum**, preserved by keeping vertical padding on mobile even
  as labels shrink
- Status is never encoded by color alone — the text label is the accessible channel
