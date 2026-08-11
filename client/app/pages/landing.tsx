import {
  Children,
  cloneElement,
  isValidElement,
  useEffect,
  useRef,
  useState,
} from "react";

/* ===========================================================================
   book-me-up — landing page
   ===========================================================================

   HOW THIS FILE IS ORGANISED

   Everything below the SHARED KIT is a self-contained section. Each one is
   fenced by a banner comment, owns its own content array, exports its own
   component, and reads nothing from its neighbours.

     - To DELETE a section  → remove its banner-to-banner block, then remove
                              its line from <LandingPage> at the bottom.
     - To REORDER           → move its line in <LandingPage>. Nothing else.
     - To DUPLICATE         → copy the block, rename the component and its
                              content const, add a line to <LandingPage>.
     - To EDIT content      → the const at the top of each block is the whole
                              editable surface. Add an array entry, get a card.

   The SHARED KIT (container, buttons, reveal, icons) is the only thing
   sections depend on. Leave it in place even if you delete every section.

   DESIGN SYSTEM — see .claude/skills/design-system/
   Every value here is a token utility from client/app/app.css. No raw hex, no
   arbitrary values. Two things that bite: `rounded-lg` is 12px here (not
   Tailwind's 8px), and `duration-base` is not a class (use `duration-200`).

   ONE MOVE PER SECTION — each section gets exactly one expressive gesture:
     Hero .............. floating widget
     Verticals ......... accent block
     Feature rows ...... motion reveal
     Capabilities ...... oversized display line
     Pricing ........... floating widget
     CTA band .......... inverted band
   Header and footer are chrome and get none. Don't stack two moves in one
   section — that's the thing that makes a page read busy.

   MOTION — Tier 1 only. Hover transitions plus fade-rise-and-settle scroll
   reveals, driven by one shared IntersectionObserver. No dependencies. If JS
   never runs, or the visitor prefers reduced motion, everything renders
   plainly visible: the unanimated state IS the visible state.

   To retune how strong the scrolling feels, edit the REVEAL block in the
   shared kit. It is the single dial — no section hardcodes a distance,
   duration or delay of its own.
   =========================================================================== */

/* ###########################################################################
   SHARED KIT — used by every section. Not a section itself.
   ########################################################################### */

/** Page gutter and max width. Mobile gutters are px-4, widening at md. */
function Container({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`mx-auto w-full max-w-6xl px-4 md:px-6 ${className}`}>
      {children}
    </div>
  );
}

/* --- scroll reveal -------------------------------------------------------
   One IntersectionObserver shared by every <Reveal> on the page, rather than
   one per element. Targets unobserve themselves after the first trigger —
   content that re-animates every time you scroll past is the single most
   common way this reads as gimmicky.

   >>> STRENGTH DIAL <<<
   Everything about how hard the reveal hits lives in REVEAL below. Turn the
   numbers down to calm it, up to push it. Two of them are not negotiable and
   are marked as such: 520ms is the system's hard ceiling on any animation,
   and the easings are calm on purpose — a spring or an overshoot is the
   fastest way to make this product read as amateur.                        */

const REVEAL = {
  /** Multiplier on --reveal-distance (16px, set in app.css). 1 = the system
      default of 16px. 1.75 ≈ 28px: clearly felt, still short of the "page is
      assembling itself" look that long travel produces. Past ~2.5 it starts
      reading as a slideshow. */
  travel: 1.75,

  /** Starting scale. Keep it close to 1 — at this distance it reads as the
      content settling into place rather than as a zoom. 1 disables it. */
  //scale: 0.985,
  scale: 0.9,

  /** ms between staggered siblings. */
  stagger: 70,

  /** Hard cap on how many siblings stagger. Everything past this shares the
      last delay, so a 12-item grid never turns into a 12-step cascade. */
  staggerCap: 4,

  /** How far into the viewport an element must travel before it fires. The
      negative bottom margin is what makes the motion *visible* — with a 0
      margin things finish animating while still near the fold and you barely
      catch them. More negative = later = more of the motion is on screen. */
  rootMargin: "0px 0px -12% 0px",
} as const;

type RevealFrom = "below" | "left" | "right";

/** Offset is derived from the --reveal-distance token rather than hardcoded,
    so retuning the token in app.css still moves this. */
function offsetFor(from: RevealFrom) {
  const d = `calc(var(--reveal-distance) * ${REVEAL.travel})`;
  if (from === "left") return `translate3d(calc(${d} * -1), 0, 0)`;
  if (from === "right") return `translate3d(${d}, 0, 0)`;
  return `translate3d(0, ${d}, 0)`;
}

let sharedObserver: IntersectionObserver | null = null;
const revealCallbacks = new WeakMap<Element, () => void>();

function observeOnce(el: Element, onVisible: () => void) {
  if (!sharedObserver) {
    sharedObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          revealCallbacks.get(entry.target)?.();
          revealCallbacks.delete(entry.target);
          sharedObserver?.unobserve(entry.target);
        }
      },
      // threshold 0 rather than a fraction: a section taller than the viewport
      // can never satisfy "15% of me is visible", and would sit invisible
      // forever. The rootMargin above does the "wait until it's properly on
      // screen" job instead, and does it for tall elements too.
      { threshold: 0, rootMargin: REVEAL.rootMargin },
    );
  }
  revealCallbacks.set(el, onVisible);
  sharedObserver.observe(el);
  return () => {
    revealCallbacks.delete(el);
    sharedObserver?.unobserve(el);
  };
}

/**
 * Fades, rises (or slides) and settles as it enters the viewport.
 *
 * Reveal GROUPS, not elements — wrap a whole card grid, not each card.
 * Animating twelve cards individually is the vibecoded look. `stagger` walks
 * the group's direct children instead, capped at REVEAL.staggerCap steps.
 *
 * Renders visible and untouched until the effect runs, so no-JS and
 * reduced-motion visitors get plain content rather than a blank page.
 *
 * @param from     Direction the content travels in from. Horizontal is what
 *                 the alternating feature rows use.
 * @param stagger  Stagger the direct children instead of moving the container.
 * @param delay    ms held before this group starts.
 */
function Reveal({
  children,
  delay = 0,
  from = "below",
  stagger = false,
  className = "",
}: {
  children: React.ReactNode;
  delay?: number;
  from?: RevealFrom;
  stagger?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [armed, setArmed] = useState(false);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    // Never reveal above the fold. Anything already on screen at load stays
    // put — animating content the visitor is already looking at just delays
    // the thing they came for, and arming it here would flash.
    if (el.getBoundingClientRect().top < window.innerHeight) return;
    setArmed(true);
    return observeOnce(el, () => setShown(true));
  }, []);

  // Empty until armed, which is what keeps the no-JS and reduced-motion state
  // identical to the finished state.
  const revealStyle = (extraDelay: number): React.CSSProperties =>
    armed
      ? {
          transition:
            "opacity var(--duration-deliberate) var(--ease-entrance), " +
            "transform var(--duration-deliberate) var(--ease-entrance)",
          transitionDelay: `${delay + extraDelay}ms`,
          opacity: shown ? 1 : 0,
          transform: shown
            ? "none"
            : `${offsetFor(from)} scale(${REVEAL.scale})`,
        }
      : {};

  const body = stagger
    ? Children.map(children, (child, index) => {
        if (!isValidElement(child)) return child;
        const step =
          Math.min(index, REVEAL.staggerCap - 1) * REVEAL.stagger;
        const props = child.props as { style?: React.CSSProperties };
        return cloneElement(child as React.ReactElement<{ style?: React.CSSProperties }>, {
          style: { ...props.style, ...revealStyle(step) },
        });
      })
    : children;

  return (
    <div
      ref={ref}
      className={className}
      // When staggering, the container holds still and the children move.
      style={stagger ? undefined : revealStyle(0)}
    >
      {body}
    </div>
  );
}

/* --- buttons -------------------------------------------------------------
   Marketing CTAs are rounded-pill; nav and utility buttons are rounded-md.
   That contrast is how the page signals "this is the one action" versus
   "this is a control." Only one primary per view.                          */

type CtaVariant = "primary" | "secondary" | "on-deep";

const CTA_BASE =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-pill px-6 py-3 " +
  "text-button transition duration-120 ease-standard active:scale-[0.98]";

const CTA_VARIANTS: Record<CtaVariant, string> = {
  primary:
    "bg-primary text-on-primary hover:bg-primary-hover active:bg-primary-active",
  secondary:
    "border border-border-input bg-surface text-ink hover:bg-hover-wash active:bg-press-wash",
  // On the inverted band the fill flips to white and the label goes deep blue
  // — white sits on `deep` at 10.42:1 in both themes, which a primary-on-deep
  // pairing would not clear.
  "on-deep": "bg-on-deep text-deep hover:opacity-90",
};

function Cta({
  href,
  variant = "primary",
  className = "",
  children,
}: {
  href: string;
  variant?: CtaVariant;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <a href={href} className={`${CTA_BASE} ${CTA_VARIANTS[variant]} ${className}`}>
      {children}
    </a>
  );
}

/* --- icons ---------------------------------------------------------------
   Rounded, stroke-based, currentColor. The vertical set is deliberately half
   barbering and half everything else — nails, tattoo, lashes, locs, piercing
   — because imagery that reads "barbershop" tells half the market this
   product isn't for them. No poles, no straight razors, no checkerboard.    */

function Glyph({
  children,
  className = "size-6",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

type GlyphProps = { className?: string };

const IconScissors = (p: GlyphProps) => (
  <Glyph {...p}>
    <circle cx="6" cy="18" r="2.6" />
    <circle cx="18" cy="18" r="2.6" />
    <path d="M7.9 16.1 19.5 4.5M16.1 16.1 4.5 4.5" />
  </Glyph>
);

const IconWaves = (p: GlyphProps) => (
  <Glyph {...p}>
    <path d="M3 7c1.5-2 3-2 4.5 0s3 2 4.5 0 3-2 4.5 0 3 2 4.5 0" />
    <path d="M3 12c1.5-2 3-2 4.5 0s3 2 4.5 0 3-2 4.5 0 3 2 4.5 0" />
    <path d="M3 17c1.5-2 3-2 4.5 0s3 2 4.5 0 3-2 4.5 0 3 2 4.5 0" />
  </Glyph>
);

const IconPolish = (p: GlyphProps) => (
  <Glyph {...p}>
    <path d="M10 2.5h4v3h-4z" />
    <path d="M9 8.6a2.2 2.2 0 0 1 1.3-2l.2-1.1h3l.2 1.1a2.2 2.2 0 0 1 1.3 2V19.5a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2Z" />
    <path d="M9 12.5h6" />
  </Glyph>
);

const IconTattoo = (p: GlyphProps) => (
  <Glyph {...p}>
    <path d="m15.5 3.5 5 5" />
    <path d="M18 6 8.5 15.5a3 3 0 0 0-.8 1.4L6.5 21l4.1-1.2a3 3 0 0 0 1.4-.8L21.5 9.5" />
    <path d="M4 21h3" />
  </Glyph>
);

const IconLash = (p: GlyphProps) => (
  <Glyph {...p}>
    <path d="M2.5 13.5s3.6-5.5 9.5-5.5 9.5 5.5 9.5 5.5-3.6 5.5-9.5 5.5S2.5 13.5 2.5 13.5Z" />
    <circle cx="12" cy="13.5" r="2.4" />
    <path d="M6.2 7.6 5 5.4M12 6.4V3.9M17.8 7.6 19 5.4" />
  </Glyph>
);

const IconPiercing = (p: GlyphProps) => (
  <Glyph {...p}>
    <circle cx="12" cy="13" r="7" />
    <circle cx="12" cy="6" r="1.8" />
  </Glyph>
);

const IconCalendar = (p: GlyphProps) => (
  <Glyph {...p}>
    <rect x="3" y="5" width="18" height="16" rx="2.5" />
    <path d="M3 10h18M8 3v4M16 3v4" />
  </Glyph>
);

const IconMenuList = (p: GlyphProps) => (
  <Glyph {...p}>
    <path d="M9 7h11M9 12h11M9 17h11" />
    <path d="M4.5 7h.01M4.5 12h.01M4.5 17h.01" />
  </Glyph>
);

const IconLink = (p: GlyphProps) => (
  <Glyph {...p}>
    <path d="M10.5 13.5a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.7 1.7" />
    <path d="M13.5 10.5a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.7-1.7" />
  </Glyph>
);

const IconNote = (p: GlyphProps) => (
  <Glyph {...p}>
    <path d="M5 4.5A1.5 1.5 0 0 1 6.5 3h11A1.5 1.5 0 0 1 19 4.5v15L15.5 17 12 19.5 8.5 17 5 19.5Z" />
    <path d="M9 8h6M9 12h4" />
  </Glyph>
);

const IconCalendarOff = (p: GlyphProps) => (
  <Glyph {...p}>
    <rect x="3" y="5" width="18" height="16" rx="2.5" />
    <path d="M3 10h18M8 3v4M16 3v4" />
    <path d="m9.5 14.5 5 4M14.5 14.5l-5 4" />
  </Glyph>
);

const IconClock = (p: GlyphProps) => (
  <Glyph {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5.2l3.2 2" />
  </Glyph>
);

const IconStorefront = (p: GlyphProps) => (
  <Glyph {...p}>
    <path d="M3.5 9.5h17V20a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1Z" />
    <path d="M3 9.5 4.6 4a1 1 0 0 1 1-.7h12.8a1 1 0 0 1 1 .7L21 9.5" />
    <path d="M9.5 21v-6h5v6" />
  </Glyph>
);

const IconCheck = (p: GlyphProps) => (
  <Glyph {...p}>
    <path d="m4.5 12.5 5 5 10-11" />
  </Glyph>
);

/** Wordmark lockup. Used by the header and the footer. */
function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <span
        className="grid size-7 shrink-0 place-items-center rounded-md bg-primary text-on-primary"
        aria-hidden="true"
      >
        <IconScissors className="size-4" />
      </span>
      <span className="font-display text-title font-bold tracking-tight text-ink">
        book-me-up
      </span>
    </span>
  );
}

/* ###########################################################################
   SECTION 01 — SITE HEADER
   Sticky top bar with a mobile drawer. Chrome, so it gets no expressive move.
   ########################################################################### */

const NAV_LINKS = [
  { label: "Features", href: "#features" },
  { label: "Who it's for", href: "#verticals" },
  { label: "Pricing", href: "#pricing" },
];

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // The bar only earns a shadow once the page has moved under it. Flip-guarded
  // so this sets state twice per page, not once per scroll event.
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Drawer: trap focus, close on Escape, lock body scroll, return focus to the
  // trigger on close.
  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (!panel) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const focusables = () =>
      Array.from(
        panel.querySelectorAll<HTMLElement>("a[href], button:not([disabled])"),
      );
    focusables()[0]?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      triggerRef.current?.focus();
    };
  }, [open]);

  return (
    <header
      className={`sticky top-0 z-50 border-b border-hairline bg-surface transition-shadow duration-200 ease-standard ${
        scrolled ? "shadow-soft" : ""
      }`}
    >
      <Container>
        <div className="flex min-h-14 items-center justify-between gap-4">
          <a href="#top" className="rounded-md">
            <Wordmark />
            <span className="sr-only">book-me-up home</span>
          </a>

          <nav aria-label="Primary" className="hidden md:block">
            <ul className="flex items-center gap-1">
              {NAV_LINKS.map((link) => (
                <li key={link.href}>
                  <a
                    href={link.href}
                    className="inline-flex min-h-11 items-center rounded-md px-3 text-body-sm text-ink-secondary transition-colors duration-120 ease-standard hover:bg-hover-wash hover:text-ink"
                  >
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          <div className="hidden items-center gap-2 md:flex">
            <a
              href="#login"
              className="inline-flex min-h-11 items-center rounded-md px-3 text-body-sm text-primary-text transition-colors duration-120 ease-standard hover:bg-hover-wash"
            >
              Log in
            </a>
            <a
              href="#get-started"
              className="inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-4 text-button text-on-primary transition-colors duration-120 ease-standard hover:bg-primary-hover active:bg-primary-active"
            >
              Get started
            </a>
          </div>

          <button
            ref={triggerRef}
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Open menu"
            aria-expanded={open}
            className="grid size-11 place-items-center rounded-md text-ink transition-colors duration-120 ease-standard hover:bg-hover-wash active:bg-press-wash md:hidden"
          >
            <Glyph>
              <path d="M4 7h16M4 12h16M4 17h16" />
            </Glyph>
          </button>
        </div>
      </Container>

      {/* Mobile drawer. Stays mounted so it can transition; `inert` keeps it out
          of the tab order and off the accessibility tree while closed. */}
      <div
        className={`fixed inset-0 z-50 bg-ink/40 transition-opacity duration-320 ease-standard md:hidden ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        onClick={() => setOpen(false)}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        inert={!open}
        role="dialog"
        aria-modal="true"
        aria-label="Menu"
        className={`fixed inset-y-0 right-0 z-50 flex w-80 max-w-full flex-col bg-surface p-4 transition-transform duration-320 ease-standard md:hidden ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between">
          <Wordmark />
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close menu"
            className="grid size-11 place-items-center rounded-md text-ink transition-colors duration-120 ease-standard hover:bg-hover-wash active:bg-press-wash"
          >
            <Glyph>
              <path d="M6 6l12 12M18 6 6 18" />
            </Glyph>
          </button>
        </div>

        <nav aria-label="Mobile" className="mt-6 flex-1">
          <ul className="flex flex-col gap-1">
            {NAV_LINKS.map((link) => (
              <li key={link.href}>
                <a
                  href={link.href}
                  onClick={() => setOpen(false)}
                  className="flex min-h-11 items-center rounded-sm px-3 text-title text-ink transition-colors duration-120 ease-standard hover:bg-hover-wash"
                >
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="flex flex-col gap-2">
          <Cta href="#get-started">Get started</Cta>
          <Cta href="#login" variant="secondary">
            Log in
          </Cta>
        </div>
      </div>
    </header>
  );
}

/* ###########################################################################
   SECTION 02 — HERO
   ONE MOVE: floating widget. The schedule card is lifted off the canvas with
   shadow-soft; nothing else in this section is doing anything expressive.
   Deliberately not wrapped in <Reveal> — never animate above the fold.
   ########################################################################### */

const HERO = {
  eyebrow: "Booking for people who work a chair",
  headline: "Take bookings without taking calls.",
  body: "Share one link. Your calendar fills itself, reminders go out on their own, and nobody double-books your chair. Set it up between clients.",
  primaryCta: { label: "Get started", href: "#get-started" },
  secondaryCta: { label: "See how it works", href: "#features" },
  footnote: "Works from your phone. Your clients never install anything.",
};

/** Sample day inside the floating widget. Status chips always carry a text
    label — colour alone is never the channel, and accepted-green next to
    rejected-red is a deuteranopia confusion pair. */
const HERO_WIDGET_DAY = [
  {
    time: "9:00 AM",
    service: "Skin fade",
    price: "$35",
    status: "Accepted",
    chip: "text-status-accepted bg-status-accepted-tint",
  },
  {
    time: "10:30 AM",
    service: "Beard trim + line up",
    price: "$25",
    status: "Pending",
    chip: "text-status-pending bg-status-pending-tint",
  },
  {
    time: "12:00 PM",
    service: "Full set, gel",
    price: "$60",
    status: "Accepted",
    chip: "text-status-accepted bg-status-accepted-tint",
  },
];

export function Hero() {
  return (
    <section id="top" className="py-16 md:py-24 lg:py-32">
      <Container>
        <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
          <div>
            <p className="text-eyebrow uppercase text-ink-muted">
              {HERO.eyebrow}
            </p>
            <h1 className="mt-3 font-display text-display-1 text-ink">
              {HERO.headline}
            </h1>
            <p className="mt-6 max-w-xl text-body-md text-ink-secondary">
              {HERO.body}
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Cta href={HERO.primaryCta.href}>{HERO.primaryCta.label}</Cta>
              <Cta href={HERO.secondaryCta.href} variant="secondary">
                {HERO.secondaryCta.label}
              </Cta>
            </div>
            <p className="mt-6 text-caption text-ink-muted">{HERO.footnote}</p>
          </div>

          {/* THE MOVE — a product surface floating off the page. */}
          <div className="rounded-xl bg-surface p-6 shadow-soft">
            <div className="flex items-baseline justify-between">
              <p className="text-heading-3 text-ink">Tuesday</p>
              <p className="text-caption text-ink-muted">March 4</p>
            </div>

            <ul className="mt-4 flex flex-col gap-2">
              {HERO_WIDGET_DAY.map((slot) => (
                <li
                  key={slot.time}
                  className="rounded-lg border border-hairline p-3"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-body-sm text-ink-muted">
                      {slot.time}
                    </span>
                    <span
                      className={`rounded-sm px-2 py-1 text-eyebrow ${slot.chip}`}
                    >
                      {slot.status}
                    </span>
                  </div>
                  <div className="mt-1 flex items-baseline justify-between gap-3">
                    <span className="text-title text-ink">{slot.service}</span>
                    <span className="text-body-sm text-ink-secondary">
                      {slot.price}
                    </span>
                  </div>
                </li>
              ))}
            </ul>

            <p className="mt-4 text-caption text-ink-muted">
              Buffers are already blocked out. Nobody can book into them.
            </p>
          </div>
        </div>
      </Container>
    </section>
  );
}

/* ###########################################################################
   SECTION 03 — VERTICALS
   ONE MOVE: accent block. The tinted icon tiles are the gesture.

   The accents are SEMANTICALLY EMPTY — they carry rhythm, nothing else. The
   icon identifies the vertical, never the colour. Rotate the accent by index
   and it stays honest.
   ########################################################################### */

const VERTICALS_HEADING = "Barbers first. Everyone who works a chair, next.";
const VERTICALS_BODY =
  "If you book time and people sit down, this fits. Nothing here assumes a barbershop.";

const VERTICALS = [
  { label: "Barbering", Icon: IconScissors },
  { label: "Hair & color", Icon: IconWaves },
  { label: "Nails", Icon: IconPolish },
  { label: "Tattoo", Icon: IconTattoo },
  { label: "Lashes & brows", Icon: IconLash },
  { label: "Piercing", Icon: IconPiercing },
];

const ACCENT_TILES = [
  "bg-accent-indigo-tint text-accent-indigo",
  "bg-accent-magenta-tint text-accent-magenta",
  "bg-accent-amber-tint text-accent-amber",
  "bg-accent-jade-tint text-accent-jade",
];

export function Verticals() {
  return (
    <section id="verticals" className="py-16 md:py-24 lg:py-32">
      <Container>
        <div className="max-w-2xl">
          <h2 className="text-heading-2 text-ink">{VERTICALS_HEADING}</h2>
          <p className="mt-3 text-body-md text-ink-muted">{VERTICALS_BODY}</p>
        </div>

        <Reveal
          stagger
          className="mt-10 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6"
        >
          {VERTICALS.map(({ label, Icon }, index) => (
            <div
              key={label}
              className="flex flex-col items-start gap-3 rounded-lg border border-hairline bg-surface p-6"
            >
              <span
                className={`grid size-12 place-items-center rounded-lg ${
                  ACCENT_TILES[index % ACCENT_TILES.length]
                }`}
              >
                <Icon />
              </span>
              <span className="text-body-sm text-ink">{label}</span>
            </div>
          ))}
        </Reveal>
      </Container>
    </section>
  );
}

/* ###########################################################################
   SECTION 04 — FEATURE ROWS
   ONE MOVE: motion reveal. Rows arrive in sequence as you scroll, alternating
   sides on desktop. No shadows in here — the media wells sit flat inside
   `surface-sunken` so this section doesn't also claim the floating-widget
   move that the hero and pricing already use.

   To ADD a row: append to FEATURE_ROWS and write a small vignette component.
   Rows alternate automatically by index.
   ########################################################################### */

const FEATURES_HEADING = "Everything a chair needs, nothing it doesn't.";

/** Small token-built product vignettes. They stand in for screenshots — no
    illustration style exists yet, and grey placeholder boxes read as unfinished. */

function VignetteSchedule() {
  return (
    <div className="flex flex-col gap-2">
      <div className="rounded-lg border border-hairline bg-surface p-3">
        <div className="flex items-center justify-between">
          <span className="text-body-sm text-ink">Skin fade</span>
          <span className="text-caption text-ink-muted">9:00 – 9:30</span>
        </div>
      </div>
      <div className="rounded-lg border border-dashed border-hairline bg-surface-sunken p-3">
        <span className="text-caption text-ink-muted">
          10 min buffer · not bookable
        </span>
      </div>
      <div className="rounded-lg border border-hairline bg-surface p-3">
        <div className="flex items-center justify-between">
          <span className="text-body-sm text-ink">Beard trim</span>
          <span className="text-caption text-ink-muted">9:40 – 10:00</span>
        </div>
      </div>
    </div>
  );
}

function VignetteServices() {
  const services = [
    { name: "Skin fade", meta: "30 min", price: "$35" },
    { name: "Beard trim + line up", meta: "20 min", price: "$25" },
    { name: "Full set, gel", meta: "60 min", price: "$60" },
  ];
  return (
    <ul className="flex flex-col gap-2">
      {services.map((service) => (
        <li
          key={service.name}
          className="flex items-baseline justify-between gap-3 rounded-lg border border-hairline bg-surface p-3"
        >
          <span className="text-body-sm text-ink">{service.name}</span>
          <span className="flex shrink-0 items-baseline gap-3">
            <span className="text-caption text-ink-muted">{service.meta}</span>
            <span className="text-body-sm text-ink-secondary">
              {service.price}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function VignetteLink() {
  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-lg border border-hairline bg-surface p-3">
        <p className="text-eyebrow uppercase text-ink-muted">
          Your booking link
        </p>
        <p className="mt-1 truncate text-body-sm text-primary-text">
          book-me-up.app/marcus
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {["Instagram bio", "Text it", "QR on the mirror"].map((place) => (
          <span
            key={place}
            className="rounded-pill border border-hairline bg-surface px-2 py-1 text-eyebrow text-ink-secondary"
          >
            {place}
          </span>
        ))}
      </div>
    </div>
  );
}

function VignetteClient() {
  return (
    <div className="rounded-lg border border-hairline bg-surface p-3">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-body-sm text-ink">Marcus D.</span>
        <span className="text-caption text-ink-muted">(555) 014-2288</span>
      </div>
      <p className="mt-2 text-body-sm text-ink-secondary">
        Prefers a 2 on the sides. Reacts to the blue clipper spray — use the
        other one.
      </p>
      <p className="mt-3 text-eyebrow uppercase text-ink-muted">
        Private to you
      </p>
    </div>
  );
}

const FEATURE_ROWS = [
  {
    Icon: IconCalendar,
    title: "A calendar that stays honest",
    body: "Set your hours per shop and your buffer per service. Bookings collide against the buffer, not just the appointment, so back-to-back never means back-to-back.",
    points: [
      "Different hours at every shop you work",
      "Time off blocks you everywhere at once",
      "Pending holds still occupy the slot",
    ],
    Vignette: VignetteSchedule,
  },
  {
    Icon: IconMenuList,
    title: "Your menu travels with you",
    body: "Services, prices and durations belong to you, not to the shop. Work two chairs and the list is identical at both — change it once.",
    points: [
      "One service list across every shop",
      "Prices are captured at booking time",
      "Editing a service never rewrites a past quote",
    ],
    Vignette: VignetteServices,
  },
  {
    Icon: IconLink,
    title: "One link, everywhere you already are",
    body: "Put it in your Instagram bio, text it, tape a QR to the mirror. Clients pick a time from what you're actually free for. No app, no account.",
    points: [
      "Guests can book without signing up",
      "Only real openings are ever shown",
      "Confirmations and reminders send themselves",
    ],
    Vignette: VignetteLink,
  },
  {
    Icon: IconNote,
    title: "Remember every head in your chair",
    body: "Keep notes on what you did last time and what to avoid. They stay yours — clients never see a word of it.",
    points: [
      "Notes are private to you, always",
      "History follows the client, not the shop",
      "Repeat clients rebook in a couple of taps",
    ],
    Vignette: VignetteClient,
  },
];

export function FeatureRows() {
  return (
    <section id="features" className="py-16 md:py-24 lg:py-32">
      <Container>
        <h2 className="max-w-2xl font-display text-heading-1 text-ink">
          {FEATURES_HEADING}
        </h2>

        <div className="mt-12 flex flex-col gap-16 md:gap-24">
          {FEATURE_ROWS.map(({ Icon, title, body, points, Vignette }, index) => (
            // THE MOVE — each row is its own reveal group, so the section
            // assembles as you scroll instead of arriving all at once. Rows
            // travel in from the side their copy sits on, which alternates
            // with the layout and reads as deliberate rather than as noise.
            <Reveal
              key={title}
              from={index % 2 === 1 ? "right" : "left"}
              className="grid items-center gap-8 md:grid-cols-2 md:gap-12"
            >
              <div className={index % 2 === 1 ? "md:order-2" : undefined}>
                <span className="grid size-11 place-items-center rounded-lg border border-hairline bg-surface text-ink-secondary">
                  <Icon />
                </span>
                <h3 className="mt-4 text-heading-2 text-ink">{title}</h3>
                <p className="mt-3 text-body-md text-ink-secondary">{body}</p>
                <ul className="mt-4 flex flex-col gap-2">
                  {points.map((point) => (
                    <li key={point} className="flex gap-3 text-body-sm text-ink-muted">
                      <IconCheck className="mt-0.5 size-4 shrink-0 text-primary-text" />
                      <span>{point}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="rounded-xl border border-hairline bg-surface-sunken p-6">
                <Vignette />
              </div>
            </Reveal>
          ))}
        </div>
      </Container>
    </section>
  );
}

/* ###########################################################################
   SECTION 05 — CAPABILITIES
   ONE MOVE: oversized display line. The headline runs at display-2 and the
   cards stay plain — flat, hairline-bordered, monochrome icons. Do not add
   accent tiles here; the verticals strip already owns that gesture.
   ########################################################################### */

const CAPABILITIES_HEADING = "The parts nobody thinks about until they bite.";

const CAPABILITIES = [
  {
    Icon: IconCalendarOff,
    title: "Time off that actually blocks",
    body: "Take Tuesday off and you're gone from every shop you work, not just the one you remembered to update.",
  },
  {
    Icon: IconClock,
    title: "Holds that expire on their own",
    body: "Unconfirmed bookings hold the slot for a day, then release themselves. You never have to chase someone who went quiet.",
  },
  {
    Icon: IconStorefront,
    title: "Two shops, one you",
    body: "Different hours and different chairs per shop, one set of services and one set of rules. Even across time zones.",
  },
];

export function Capabilities() {
  return (
    <section className="py-16 md:py-24 lg:py-32">
      <Container>
        {/* THE MOVE — the headline itself is the gesture. */}
        <h2 className="max-w-3xl font-display text-display-2 text-ink">
          {CAPABILITIES_HEADING}
        </h2>

        <Reveal stagger className="mt-12 grid gap-4 md:grid-cols-3">
          {CAPABILITIES.map(({ Icon, title, body }) => (
            <div
              key={title}
              className="rounded-lg border border-hairline bg-surface p-6"
            >
              <span className="text-ink-secondary">
                <Icon />
              </span>
              <h3 className="mt-4 text-heading-3 text-ink">{title}</h3>
              <p className="mt-2 text-body-sm text-ink-muted">{body}</p>
            </div>
          ))}
        </Reveal>
      </Container>
    </section>
  );
}

/* ###########################################################################
   SECTION 06 — PRICING
   ONE MOVE: floating widget. The recommended plan lifts off the row with
   shadow-soft and drops its border; the others stay flat with a hairline.

   >>> PRICES ARE NOT SET. <<<
   Every `price` below is a placeholder em-dash. The design system's voice rule
   is "numbers only when they are real," so nothing here invents a figure.
   Replace the three `price` strings and delete PRICING_NOTE when you have
   real numbers. Until then this section renders visibly unfinished on purpose.
   ########################################################################### */

const PRICING_HEADING = "One plan per chair. No percentage of your day.";
const PRICING_NOTE =
  "Pricing isn't set yet — these are placeholders while we work it out.";

const PRICING_PLANS = [
  {
    name: "Solo",
    price: "$—", // TODO: real price
    cadence: "per month",
    blurb: "One chair, one calendar.",
    features: [
      "Your booking link",
      "Unlimited services",
      "Automatic reminders",
      "Client notes",
    ],
    cta: { label: "Get started", href: "#get-started" },
    recommended: false,
  },
  {
    name: "Shop",
    price: "$—", // TODO: real price
    cadence: "per chair, per month",
    blurb: "A few chairs under one roof.",
    features: [
      "Everything in Solo",
      "Multiple workers and chairs",
      "Owner view across the shop",
      "Cancellation and no-show rules",
    ],
    cta: { label: "Get started", href: "#get-started" },
    recommended: true,
  },
  {
    name: "Multi-shop",
    price: "$—", // TODO: real price
    cadence: "per chair, per month",
    blurb: "More than one address.",
    features: [
      "Everything in Shop",
      "Per-location hours and time zones",
      "Workers who float between shops",
      "Priority support",
    ],
    cta: { label: "Talk to us", href: "#contact" },
    recommended: false,
  },
];

export function Pricing() {
  return (
    <section id="pricing" className="py-16 md:py-24 lg:py-32">
      <Container>
        <div className="max-w-2xl">
          <h2 className="font-display text-heading-1 text-ink">
            {PRICING_HEADING}
          </h2>
          <p className="mt-3 text-body-md text-ink-muted">{PRICING_NOTE}</p>
        </div>

        <Reveal stagger className="mt-12 grid items-start gap-4 md:grid-cols-3">
          {PRICING_PLANS.map((plan) => (
            <div
              key={plan.name}
              // THE MOVE — one card floats, the rest sit flat.
              className={`flex flex-col rounded-xl bg-surface p-6 ${
                plan.recommended
                  ? "shadow-soft md:-my-4 md:py-10"
                  : "border border-hairline"
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-heading-3 text-ink">{plan.name}</h3>
                {plan.recommended && (
                  <span className="rounded-pill bg-primary px-2 py-1 text-eyebrow text-on-primary">
                    Recommended
                  </span>
                )}
              </div>

              <p className="mt-1 text-body-sm text-ink-muted">{plan.blurb}</p>

              <p className="mt-6 font-display text-heading-1 text-ink">
                {plan.price}
              </p>
              <p className="text-caption text-ink-muted">{plan.cadence}</p>

              <ul className="mt-6 flex flex-1 flex-col gap-2">
                {plan.features.map((feature) => (
                  <li
                    key={feature}
                    className="flex gap-3 text-body-sm text-ink-secondary"
                  >
                    <IconCheck className="mt-0.5 size-4 shrink-0 text-primary-text" />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>

              <Cta
                href={plan.cta.href}
                variant={plan.recommended ? "primary" : "secondary"}
                className="mt-8"
              >
                {plan.cta.label}
              </Cta>
            </div>
          ))}
        </Reveal>
      </Container>
    </section>
  );
}

/* ###########################################################################
   SECTION 07 — CTA BAND
   ONE MOVE: inverted band. One dark island in a light page — ration it, don't
   repeat it. The CTA flips to a white fill because primary-on-deep wouldn't
   carry enough contrast in either theme.
   ########################################################################### */

const CTA_BAND = {
  heading: "Set it up tonight. Take bookings tomorrow.",
  body: "Add your services, set your hours, share your link. That's the whole setup.",
  primary: { label: "Get started", href: "#get-started" },
  secondary: { label: "Or see what it costs", href: "#pricing" },
};

export function CtaBand() {
  return (
    <section className="py-16 md:py-24 lg:py-32">
      <Container>
        {/* THE MOVE — the inverted band. */}
        <Reveal className="rounded-2xl bg-deep px-6 py-16 text-center md:px-12 md:py-24">
          <h2 className="mx-auto max-w-2xl font-display text-heading-1 text-on-deep">
            {CTA_BAND.heading}
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-body-md text-on-deep">
            {CTA_BAND.body}
          </p>
          <div className="mt-8 flex flex-col items-center gap-4">
            <Cta href={CTA_BAND.primary.href} variant="on-deep">
              {CTA_BAND.primary.label}
            </Cta>
            <a
              href={CTA_BAND.secondary.href}
              className="inline-flex min-h-11 items-center rounded-md px-3 text-body-sm text-on-deep underline underline-offset-4 transition-opacity duration-120 ease-standard hover:opacity-80"
            >
              {CTA_BAND.secondary.label}
            </a>
          </div>
        </Reveal>
      </Container>
    </section>
  );
}

/* ###########################################################################
   SECTION 08 — SITE FOOTER
   Chrome, so no expressive move.
   ########################################################################### */

const FOOTER_COLUMNS = [
  {
    heading: "Product",
    links: [
      { label: "Features", href: "#features" },
      { label: "Who it's for", href: "#verticals" },
      { label: "Pricing", href: "#pricing" },
    ],
  },
  {
    heading: "Company",
    links: [
      { label: "About", href: "#about" },
      { label: "Contact", href: "#contact" },
    ],
  },
  {
    heading: "Legal",
    links: [
      { label: "Privacy", href: "#privacy" },
      { label: "Terms", href: "#terms" },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="border-t border-hairline bg-surface">
      <Container className="py-16">
        <div className="grid gap-12 md:grid-cols-4">
          <div>
            <Wordmark />
            <p className="mt-3 max-w-xs text-body-sm text-ink-muted">
              Booking for people who work a chair.
            </p>
          </div>

          {FOOTER_COLUMNS.map((column) => (
            <nav key={column.heading} aria-label={column.heading}>
              <h2 className="text-eyebrow uppercase text-ink-muted">
                {column.heading}
              </h2>
              <ul className="mt-3 flex flex-col">
                {column.links.map((link) => (
                  <li key={link.href}>
                    <a
                      href={link.href}
                      className="inline-flex min-h-11 items-center text-body-sm text-ink-secondary transition-colors duration-120 ease-standard hover:text-ink"
                    >
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <p className="mt-12 border-t border-hairline pt-6 text-caption text-ink-muted">
          © {new Date().getFullYear()} book-me-up
        </p>
      </Container>
    </footer>
  );
}

/* ###########################################################################
   PAGE COMPOSITION
   The only place section order lives. Add, remove or reorder lines here.
   ########################################################################### */

export default function LandingPage() {
  return (
    // overflow-x-clip contains the horizontal travel on the feature rows so it
    // can never produce a sideways scrollbar. It must be `clip`, not `hidden`:
    // `hidden` creates a scroll container and would break the sticky header.
    <div className="overflow-x-clip bg-canvas-soft text-ink">
      <SiteHeader />
      <main>
        <Hero />
        <Verticals />
        <FeatureRows />
        <Capabilities />
        <Pricing />
        <CtaBand />
      </main>
      <SiteFooter />
    </div>
  );
}
