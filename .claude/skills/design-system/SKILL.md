---
name: design-system
description: The book-me-up visual language — colors, type, motion, spacing, radii,
  interaction states, and component chrome. Use when building or restyling any UI in
  client/ — new pages, components, Tailwind config, CSS, choosing a color, or picking a
  font size, radius, duration, or spacing value. Never pick a hex code or px value by
  hand; take it from here.
---

# book-me-up design system

Booking software for people who work a chair. Barbers first — but nails, tattoo and
lashes have to feel equally at home, so **nothing in this system is barbershop-themed**.
No barber poles, no straight razors, no checkerboard, no vintage script. That imagery
would tell half the market this product is not for them.

The people using it are shop owners and workers running a business from a phone between
clients. The promise is that it just works, and the design has to look like that promise:
fast to read, obviously simple, quietly well-made.

**Composed, not corporate. Modern, not trendy.** The bar is Squire and Fresha — plain
surfaces that move well. The thing to design against is a landing page that throws a
dashboard of numbers at you before it has said what it does.

**Every token is a real Tailwind utility**, defined in `client/app/app.css` — use
`bg-canvas-soft`, `text-ink-muted`, `rounded-pill`, `text-heading-2`, `shadow-soft`.
Never write a raw hex or an arbitrary value like `bg-[#f5f7fa]`; if a value seems
missing, it belongs in `app.css` first.

## One Move Per Section

The governing rule, and the one that keeps "expressive" from becoming noise.

Every section gets **exactly one** expressive gesture, drawn from this vocabulary:

| Move | What it is |
| --- | --- |
| **Oversized display line** | The headline itself is the moment |
| **Motion reveal** | Content arrives as you scroll to it |
| **Accent block** | A tinted color field or icon tile |
| **Floating widget** | A product surface lifted off the canvas |
| **Inverted band** | `bg-deep` against the light page |

Two rules govern it:

1. **One per section.** A section with a huge headline *and* a parallax *and* a color
   block is a bug — the moves cancel each other out and the result reads busy.
2. **Ration across the page.** Using the inverted band in every section is also a bug.
   Each move should appear once or twice per page, not throughout.

Unity comes from the vocabulary being small and shared. Expression comes from every
section having *something*. Do not invent a seventh move without asking.

## Non-negotiable

- **Mobile is the design target, not a breakpoint.** Design the 375px view first and let
  it grow. Most of this product is used on a phone.
- **`primary` fills, `primary-text` writes.** `bg-primary` for buttons; `text-primary-text`
  for links and any body-size blue text. The fill blue does not clear 4.5:1 on
  `canvas-soft` — that is exactly why there are two tokens.
- **`hairline` is decorative; `border-input` is interactive.** Card edges and dividers get
  `hairline`. Anything a user can click or type into gets `border-input`, which clears the
  3:1 that WCAG 1.4.11 requires. A text field bordered in `hairline` is an accessibility
  bug, not a style choice.
- **Accents are semantically empty.** `accent-indigo`, `accent-magenta`, `accent-amber`,
  `accent-jade` carry rhythm only. They never encode meaning, never fill a CTA, never
  indicate state. If a user has to tell A from B, that is an icon or a label.
- **The display face is rationed.** `font-display` (Bricolage Grotesque) is for
  `text-display-1`, `text-display-2` and `text-heading-1` only. Everything from
  `text-heading-2` down is Inter. A page set entirely in the display face looks cheap.
- **Icons are rounded**, and the set covers every vertical — roughly half barbering, half
  nails, tattoo, lashes and similar.
- Marketing CTAs `rounded-pill`; utility buttons `rounded-md`; inputs `rounded-xs`. Never
  a pill radius on a form field.
- **Elevation is `border-hairline` first**, `shadow-soft` only when a surface must float.
  In dark mode depth comes from the surface stepping *lighter* (`surface`,
  `surface-sunken`), not from a bigger shadow — shadows barely read on a dark ground.
- **Never remove `:focus-visible`.** A global focus ring is defined in `app.css`. If a
  component restyles it, the replacement must also clear 3:1.
- Body copy stays weight 400. Weight 700 belongs to headings.

## Three things that will trip you up

- **Radius overrides Tailwind's defaults.** `rounded-lg` is 12px here, not 8px. Read the
  `@theme` block, not the Tailwind docs.
- **Spacing does not.** The scale is exactly Tailwind's 4px base, so `p-1 p-2 p-3 p-4 p-6
  p-7 p-8` give 4/8/12/16/24/28/32. No named aliases. Section rhythm is the pattern
  `py-16 md:py-24 lg:py-32`, not a token.
- **`duration-base` is not a class.** Tailwind has an `--ease-*` namespace but no
  `--duration-*` one, so `ease-standard` works and `duration-base` silently does nothing.
  Use the bare numerics, which match the tokens exactly: `duration-120`, `duration-200`,
  `duration-320`, `duration-520`.

## Motion, in one paragraph

Tier 1 — hover transitions, fade-and-rise reveals on scroll — is the **default**, and
belongs almost everywhere. Enough that the page is not a static document, never enough
that it announces itself. Tier 2 — parallax, staged reveals, animated hero — is
**opt-in only; use it when asked, not by default**. All motion must survive
`prefers-reduced-motion`, which `app.css` enforces globally. Full patterns in
[references/motion.md](references/motion.md).

## Appointment status

Six statuses, each a token pair: the bare token colors the label and icon, `-tint` fills
the chip behind it. Every pair clears WCAG AA on its tint, on `surface`, and on
`canvas-soft`, **in both themes**.

| Status | Utility pair |
| --- | --- |
| `PENDING` | `text-status-pending` / `bg-status-pending-tint` |
| `ACCEPTED` | `text-status-accepted` / `bg-status-accepted-tint` |
| `REJECTED` | `text-status-rejected` / `bg-status-rejected-tint` |
| `CANCELLED` | `text-status-cancelled` / `bg-status-cancelled-tint` |
| `COMPLETED` | `text-status-completed` / `bg-status-completed-tint` |
| `NO_SHOW` | `text-status-no-show` / `bg-status-no-show-tint` |

- **Never encode status by color alone.** A status chip always carries its text label.
  `accepted` green and `rejected` red are a deuteranopia confusion pair — the label is
  the accessible channel, the hue is reinforcement. A bare colored dot is a bug.
- **Status is not an action.** These colors never fill a button. "Accept" and "Reject"
  use `primary` and standard button chrome; only the resulting *state* is painted with a
  status color.
- Chips use `text-eyebrow` + `rounded-sm` + `px-2 py-1`.
- `CANCELLED` is deliberately neutral grey — an expired hold swept by the system is quiet
  bookkeeping, not an error. `REJECTED` is red because a person actively declined.

## References

- [references/foundations.md](references/foundations.md) — color (both themes), type
  scale, spacing, radius, elevation, and the accessibility floors every value was
  validated against.
- [references/motion.md](references/motion.md) — the two tiers, duration and easing
  tokens, the reveal pattern, and reduced-motion.
- [references/components.md](references/components.md) — chrome and full state specs for
  buttons, inputs, cards, nav, sheets, toasts, empty states, and the date picker.

## Voice

Plain and short. Say what the thing does, not how it will transform their business. "Book
in 30 seconds" over "Streamline your client acquisition funnel." Address the owner
directly as *you*. Numbers only when they are real — the anti-reference throws invented
statistics at the user, and this product does not have data yet.

## Not yet decided

Do not invent an answer to these; ask.

- **The day/schedule calendar.** Deliberately unspecified — the owner is designing it
  personally. The date *picker* is specified in `references/components.md`; the day view
  is not.
- **A dark-mode toggle.** Dark mode currently follows the OS. The token layer already
  supports an explicit `.dark` or `.light` class on `<html>`, but nothing sets one yet —
  wiring a toggle needs a theme-init script in `root.tsx`.
- **A motion library.** Tier 1 is CSS plus `IntersectionObserver`, no dependencies. If a
  tier-2 page ever needs real scroll-linked choreography, that is the moment to discuss
  adding `motion` — not before.
- **Illustration.** No illustration style exists. Accent blocks and icon tiles are
  standing in.
