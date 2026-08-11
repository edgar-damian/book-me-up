# Components

Chrome and state specs. Class strings are the intended composition, not a copy-paste
component library — there is no component layer yet.

**Every interactive component must define all six states**: default, hover, active,
focus-visible, disabled, loading. A component shipped with only a default state is
incomplete. Focus comes free from the global `:focus-visible` rule in `app.css`; the other
five are yours.

Minimum touch target is **44×44px** (`min-h-11`). Preserve vertical padding on mobile even
when labels shrink.

---

## Buttons

Shape depends on context, and the contrast is intentional:

- **Marketing CTA** → `rounded-pill`
- **In-app button** → `rounded-md`
- **Form field** → `rounded-xs` (never a pill)

### Variants

| Variant | Fill | Text | Border | Use |
| --- | --- | --- | --- | --- |
| **Primary** | `bg-primary` | `text-on-primary` | none | The one action per view |
| **Secondary** | `bg-surface` | `text-ink` | `border-border-input` | Paired beside primary |
| **Utility** | `bg-surface` | `text-ink` | `border-border-input` | Nav, toolbars, dense rows |
| **Ghost** | transparent | `text-ink` | none | Tertiary, icon rows, cancel |
| **Destructive** | `bg-danger` | `text-on-danger` | none | Cancel booking, delete |
| **Icon-only** | per variant | — | per variant | Square, `aria-label` required |

Only **one primary per view**. If two things look equally important, one of them is
secondary.

`border-border-input` on secondary and utility is not a style choice — an interactive
boundary needs 3:1, and `hairline` does not clear it.

### Anatomy

```
Primary CTA (marketing)
  inline-flex items-center justify-center gap-2
  min-h-11 px-6 py-3 rounded-pill
  bg-primary text-on-primary text-button
  transition-colors duration-120 ease-standard
  hover:bg-primary-hover active:bg-primary-active
  disabled:opacity-50 disabled:pointer-events-none

Primary (in-app)          same, but rounded-md px-4
Utility                   min-h-11 px-4 py-2 rounded-md bg-surface text-ink
                          border border-border-input hover:bg-hover-wash
Ghost                     min-h-11 px-3 rounded-md text-ink hover:bg-hover-wash
Destructive               as primary, bg-danger / hover:bg-danger-hover
                          / active:bg-danger-active / text-on-danger
Icon-only                 size-11 rounded-md grid place-items-center
```

### States

| State | Treatment |
| --- | --- |
| Hover | Fills move to their `-hover` token. Bordered and ghost variants take `bg-hover-wash` |
| Active | `-active` token, or `bg-press-wash`. Marketing CTAs may add `active:scale-[0.98]` |
| Focus | Global `:focus-visible` ring. Never remove it |
| Disabled | `opacity-50` + `pointer-events-none`. Prefer keeping a button enabled and showing validation on submit — a disabled button that never explains itself is a dead end |
| Loading | Spinner replaces the label, **button keeps its width** so the layout does not jump. Set `aria-busy` and keep it non-interactive |

### Destructive confirmation

A destructive action that cannot be undone gets a confirmation step, and the confirm
button carries the specific verb — "Cancel booking", not "OK". Never make destructive the
default focus.

---

## Navigation

**Top bar** — `bg-surface`, `border-b border-hairline`, `text-body-sm`, `px-4 md:px-6`,
`min-h-14`. Wordmark left, links center, "Log in" text link plus a utility-button CTA
right. Sticky is fine; add `shadow-soft` only once scrolled.

**Mobile drawer** — below `md`, links collapse to a hamburger. The drawer slides from the
right at `duration-320 ease-standard`, over a `bg-ink/40` scrim. Requirements:

- Trap focus while open; return focus to the trigger on close
- Close on `Escape` and on scrim tap
- Lock body scroll while open
- Full-height `bg-surface`, links at `text-title` with `min-h-11` rows

---

## Cards

| Kind | Chrome |
| --- | --- |
| Default | `bg-surface rounded-lg p-6 border border-hairline` |
| Floating | Same, `shadow-soft`, no border |
| Interactive | Default + `hover:bg-hover-wash transition-colors duration-120` |

Flat with a hairline is the default. Reach for `shadow-soft` only when a surface genuinely
floats above the page.

An interactive card must contain exactly one link or have the whole card be one target —
nested independent links inside a clickable card break keyboard navigation.

---

## Inputs and forms

```
Label      block text-body-sm text-ink-secondary mb-1
Field      w-full min-h-11 px-3 py-2 rounded-xs bg-surface text-ink text-body-sm
           border border-border-input
           placeholder:text-ink-muted
Help       text-caption text-ink-muted mt-1
Error      text-caption text-danger-text mt-1
```

Rules:

- **`rounded-xs`, never a pill.** Square-ish corners distinguish a field from a button.
- **Placeholders use `ink-muted`, not `ink-faint`.** A placeholder is information the user
  must read; `ink-faint` is scoped to decorative and disabled text.
- **A placeholder is never a label.** It disappears on input. Always render a real
  `<label>`.
- Error state: `border-danger-text` plus the message below. **Never color alone** — the
  text message is the accessible channel. Wire `aria-invalid` and `aria-describedby`.
- Validate on blur and on submit, not on every keystroke.
- Field errors appear beneath the field. Form-level errors appear above the submit button,
  not as a toast.

---

## Chips and badges

| Kind | Chrome |
| --- | --- |
| Status chip | `text-eyebrow rounded-sm px-2 py-1` + the status token pair |
| Category chip | `text-eyebrow rounded-pill px-2 py-1 bg-surface border border-hairline` |
| Count badge | `text-eyebrow rounded-pill px-2 min-w-5 bg-primary text-on-primary` |

Status chips always carry their text label — see the status rules in `SKILL.md`. A bare
colored dot is a bug.

---

## Icon tiles

The main home for accent color. A rounded square holding a vertical's icon:

```
size-12 rounded-lg grid place-items-center
bg-accent-jade-tint text-accent-jade
```

Rotate accents across a set of tiles for rhythm. **The accent never identifies the
vertical** — the icon does. Icons are rounded, and the set spans barbering, nails, tattoo,
lashes and similar.

---

## Empty states

```
Container   grid place-items-center text-center gap-3 py-12 px-6
            bg-canvas-soft rounded-xl
Icon tile   size-12 rounded-lg bg-accent-*-tint text-accent-*
Title       text-heading-3 text-ink
Body        text-body-sm text-ink-muted max-w-sm
Action      primary in-app button
```

Always offer the next action. "No appointments yet" is a dead end; "No appointments yet —
share your booking link" is not. Never use an empty state to apologize.

---

## Toasts

`bg-surface rounded-lg shadow-elevated px-4 py-3 text-body-sm border border-hairline`.

- Bottom center on mobile, bottom right on desktop
- Enter at `duration-200 ease-entrance`, exit at `duration-200 ease-exit`
- Auto-dismiss success after ~4s; **errors stay until dismissed**
- One at a time; a new toast replaces the current one
- Never carry the only copy of important information — a toast can be missed

---

## Sheets and modals

**On mobile, a bottom sheet replaces a centered modal.** A centered dialog on a phone
fights the keyboard and the thumb.

```
Sheet (< md)    fixed inset-x-0 bottom-0 rounded-t-2xl bg-surface p-6
                shadow-elevated, slides up, duration-320 ease-standard
Modal (>= md)   centered, max-w-lg rounded-xl bg-surface p-6 shadow-elevated
                fades + rises 8px, duration-200 ease-entrance
Scrim           bg-ink/40, fades at duration-200
```

Both: trap focus, close on `Escape` and scrim click, lock body scroll, return focus to the
trigger. Sheets get a grab handle and should be swipe-dismissible.

---

## Spinner

A circular track with a `primary` arc, rotating continuously at ~700ms linear.
`size-4` inline in buttons, `size-8` for a view.

**Delay ~150ms before showing.** Most transitions finish faster, and a spinner that flashes
on every interaction makes the product feel slower than one that stays quiet.

Give it `role="status"` and an accessible label. Skeletons are not used in this system —
see `motion.md`.

---

## Date picker

The client-facing calendar for choosing a day. Requirements come straight from the owner:
**simple, and the whole month fits on one phone screen.**

```
Container    bg-surface rounded-xl p-4 border border-hairline
Header       month + year at text-heading-3, prev/next as size-11 ghost icon buttons
Weekday row  text-eyebrow text-ink-muted, 7 columns
Grid         grid-cols-7 gap-1
Day cell     size-11 rounded-sm grid place-items-center text-body-sm
```

Seven 44px columns plus gaps fit inside a 375px viewport with standard gutters. Do not add
a second month, a week strip, or a year selector — the constraint is one screen.

### Day states

| State | Treatment |
| --- | --- |
| Available | `text-ink`, `hover:bg-hover-wash` |
| Today | `text-ink` + a `bg-primary` dot beneath the number, or `ring-1 ring-primary` |
| Selected | `bg-primary text-on-primary` |
| Past / fully booked | `text-day-unavailable`, no hover, `aria-disabled`, not focusable |
| Outside month | Render blank, not a greyed number |

**The unavailable day number stays readable.** `day-unavailable` clears 3:1 deliberately —
enough that the day obviously cannot be picked, never so faint the number disappears. Do
not substitute a low-opacity wash, and do not hide the number.

Because unavailability is conveyed by shade alone, it must also be conveyed
programmatically: set `aria-disabled` and give the cell an accessible name that says why
("March 4, unavailable").

### Keyboard

Arrow keys move by day, `PageUp`/`PageDown` by month, `Home`/`End` to week bounds, `Enter`
selects. One roving tabindex for the grid, not 31 tab stops.

> **The day/schedule view is deliberately not specified here** — the owner is designing it
> personally. Do not invent one.
