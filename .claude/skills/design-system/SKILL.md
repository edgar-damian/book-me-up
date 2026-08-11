---
name: design-system
description: The book-me-up visual language — colors, type scale, spacing,
  radii, and component chrome. Use when building or restyling any UI in
  client/ — new pages, components, Tailwind config, CSS, choosing a color,
  or picking a font size, radius, or spacing value. Never pick a hex code
  or px value by hand; take it from here.
---

# book-me-up design system

Adapted from Notion's design language: warm paper canvas, near-black Inter,
one structural blue, decorative accents that never paint structure.

**Every token is a real Tailwind utility.** They are defined in the `@theme`
block of `client/app/app.css` — use `bg-canvas-soft`, `text-ink-muted`,
`rounded-pill`, `text-heading-2`, `shadow-soft`. Never write a raw hex or an
arbitrary value like `bg-[#f6f5f4]`; if a value seems missing, it belongs in
`@theme` first.

Prose and rationale in [references/notion-tokens.md](references/notion-tokens.md)
— read it when you need the reasoning or a component's full chrome spec.

## Non-negotiable

- `primary` (#0075de) is the only structural accent — CTAs, links, focus.
- Page canvas `canvas-soft`, cards `surface`. Never full-page pure white.
- Sticker accents (`accent-pink`, `accent-teal`, …) are decoration only:
  illustrations, icon tiles, category dots. Never a CTA, never a status.
- Marketing CTAs `rounded-pill`; utility buttons `rounded-md`; inputs
  `rounded-xs`. Never a pill radius on a form field.
- Headlines weight 700 with negative tracking (baked into `text-heading-*`);
  body stays 400.
- Elevation = `border-hairline` first, `shadow-soft` only when a surface must
  float. No hard drop shadows.

## Two scales that will trip you up

- **Radius overrides Tailwind's defaults.** `rounded-lg` is 12px here, not 8px.
  Read the `@theme` block, not the Tailwind docs.
- **Spacing does not.** The design scale is exactly Tailwind's 4px base, so
  `p-1 p-2 p-3 p-4 p-6 p-7 p-8` give 4/8/12/16/24/28/32. No named aliases.

## Appointment status

Six statuses, each a token pair: the bare token colors the label and icon,
`-tint` fills the chip behind it. All clear WCAG AA on their tint, on
`surface`, and on `canvas-soft`.

| Status | Utility pair |
| --- | --- |
| `PENDING` | `text-status-pending` / `bg-status-pending-tint` |
| `ACCEPTED` | `text-status-accepted` / `bg-status-accepted-tint` |
| `REJECTED` | `text-status-rejected` / `bg-status-rejected-tint` |
| `CANCELLED` | `text-status-cancelled` / `bg-status-cancelled-tint` |
| `COMPLETED` | `text-status-completed` / `bg-status-completed-tint` |
| `NO_SHOW` | `text-status-no-show` / `bg-status-no-show-tint` |

Rules:

- **Never encode status by color alone.** A status chip always carries its
  text label. `accepted` green and `rejected` red are a deuteranopia confusion
  pair — the label is the accessible channel, the hue is reinforcement. A bare
  colored dot with no adjacent text is a bug.
- **Status is not an action.** These colors never fill a button. "Accept" and
  "Reject" buttons use `primary` and the standard button chrome like anything
  else; only the resulting *state* is painted with a status color.
- Chips use `text-eyebrow` + `rounded-sm` + `px-2 py-1`.
- `CANCELLED` is deliberately the neutral ink-muted grey — an expired hold
  swept by the system should read as quiet bookkeeping, not as an error.
  `REJECTED` is red because a person actively declined.

## Not yet decided

Do not invent an answer to these; ask.

- **Dark mode.** No dark palette exists. The reference documents a
  light-only system. Do not add `dark:` variants.
- **Interaction states.** The reference explicitly documents no hover states,
  and no focus/disabled/loading treatment exists yet. This is the largest gap
  between the marketing-site source and an app.
