import {
  Children,
  cloneElement,
  isValidElement,
  useEffect,
  useRef,
  useState,
} from "react";
import { Link } from "react-router";

/* ===========================================================================
   book-me-up — SHARED KIT
   ===========================================================================

   The primitives every page is built from: page container, scroll reveal,
   buttons, icons, wordmark. Nothing in here knows about any particular page.

   Lifted out of pages/LandingPage.tsx when the establishment page became the
   second consumer. It is a move, not a rewrite — LandingPage.tsx renders exactly
   what it rendered before.

   DESIGN SYSTEM — see .claude/skills/design-system/
   Every value here is a token utility from client/app/app.css. No raw hex, no
   arbitrary values. Two things that bite: `rounded-lg` is 12px here (not
   Tailwind's 8px), and `duration-base` is not a class (use `duration-200`).
   =========================================================================== */

/** Page gutter and max width. Mobile gutters are px-4, widening at md. */
export function Container({
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

export const REVEAL = {
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

export type RevealFrom = "below" | "left" | "right";

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

/** True once the visitor has NOT asked for reduced motion. Always false on the
    server and on the first client render, so it never causes a hydration
    mismatch — and so the no-JS state is the no-motion state.

    Use it to GATE an animation rather than to speed one up. app.css collapses
    every animation-duration to 0.01ms under reduced motion, which stops a
    transition cleanly but leaves a keyframe animation stranded at its final
    frame. Anything that loops has to not start at all. */
export function useMotionAllowed() {
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setAllowed(!query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  return allowed;
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
export function Reveal({
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

export type CtaVariant = "primary" | "secondary" | "on-deep";

export const CTA_BASE =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-pill px-6 py-3 " +
  "text-button transition duration-120 ease-standard active:scale-[0.98]";

export const CTA_VARIANTS: Record<CtaVariant, string> = {
  primary:
    "bg-primary text-on-primary hover:bg-primary-hover active:bg-primary-active",
  secondary:
    "border border-border-input bg-surface text-ink hover:bg-hover-wash active:bg-press-wash",
  // On the inverted band the fill flips to white and the label goes deep blue
  // — white sits on `deep` at 10.42:1 in both themes, which a primary-on-deep
  // pairing would not clear.
  "on-deep": "bg-on-deep text-deep hover:opacity-90",
};

export function Cta({
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

export function Glyph({
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

export type GlyphProps = { className?: string };

export const IconScissors = (p: GlyphProps) => (
  <Glyph {...p}>
    <circle cx="6" cy="18" r="2.6" />
    <circle cx="18" cy="18" r="2.6" />
    <path d="M7.9 16.1 19.5 4.5M16.1 16.1 4.5 4.5" />
  </Glyph>
);

export const IconWaves = (p: GlyphProps) => (
  <Glyph {...p}>
    <path d="M3 7c1.5-2 3-2 4.5 0s3 2 4.5 0 3-2 4.5 0 3 2 4.5 0" />
    <path d="M3 12c1.5-2 3-2 4.5 0s3 2 4.5 0 3-2 4.5 0 3 2 4.5 0" />
    <path d="M3 17c1.5-2 3-2 4.5 0s3 2 4.5 0 3-2 4.5 0 3 2 4.5 0" />
  </Glyph>
);

export const IconPolish = (p: GlyphProps) => (
  <Glyph {...p}>
    <path d="M10 2.5h4v3h-4z" />
    <path d="M9 8.6a2.2 2.2 0 0 1 1.3-2l.2-1.1h3l.2 1.1a2.2 2.2 0 0 1 1.3 2V19.5a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2Z" />
    <path d="M9 12.5h6" />
  </Glyph>
);

export const IconTattoo = (p: GlyphProps) => (
  <Glyph {...p}>
    <path d="m15.5 3.5 5 5" />
    <path d="M18 6 8.5 15.5a3 3 0 0 0-.8 1.4L6.5 21l4.1-1.2a3 3 0 0 0 1.4-.8L21.5 9.5" />
    <path d="M4 21h3" />
  </Glyph>
);

export const IconLash = (p: GlyphProps) => (
  <Glyph {...p}>
    <path d="M2.5 13.5s3.6-5.5 9.5-5.5 9.5 5.5 9.5 5.5-3.6 5.5-9.5 5.5S2.5 13.5 2.5 13.5Z" />
    <circle cx="12" cy="13.5" r="2.4" />
    <path d="M6.2 7.6 5 5.4M12 6.4V3.9M17.8 7.6 19 5.4" />
  </Glyph>
);

export const IconPiercing = (p: GlyphProps) => (
  <Glyph {...p}>
    <circle cx="12" cy="13" r="7" />
    <circle cx="12" cy="6" r="1.8" />
  </Glyph>
);

export const IconCalendar = (p: GlyphProps) => (
  <Glyph {...p}>
    <rect x="3" y="5" width="18" height="16" rx="2.5" />
    <path d="M3 10h18M8 3v4M16 3v4" />
  </Glyph>
);

export const IconMenuList = (p: GlyphProps) => (
  <Glyph {...p}>
    <path d="M9 7h11M9 12h11M9 17h11" />
    <path d="M4.5 7h.01M4.5 12h.01M4.5 17h.01" />
  </Glyph>
);

export const IconLink = (p: GlyphProps) => (
  <Glyph {...p}>
    <path d="M10.5 13.5a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.7 1.7" />
    <path d="M13.5 10.5a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.7-1.7" />
  </Glyph>
);

export const IconNote = (p: GlyphProps) => (
  <Glyph {...p}>
    <path d="M5 4.5A1.5 1.5 0 0 1 6.5 3h11A1.5 1.5 0 0 1 19 4.5v15L15.5 17 12 19.5 8.5 17 5 19.5Z" />
    <path d="M9 8h6M9 12h4" />
  </Glyph>
);

export const IconCalendarOff = (p: GlyphProps) => (
  <Glyph {...p}>
    <rect x="3" y="5" width="18" height="16" rx="2.5" />
    <path d="M3 10h18M8 3v4M16 3v4" />
    <path d="m9.5 14.5 5 4M14.5 14.5l-5 4" />
  </Glyph>
);

export const IconClock = (p: GlyphProps) => (
  <Glyph {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5.2l3.2 2" />
  </Glyph>
);

export const IconStorefront = (p: GlyphProps) => (
  <Glyph {...p}>
    <path d="M3.5 9.5h17V20a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1Z" />
    <path d="M3 9.5 4.6 4a1 1 0 0 1 1-.7h12.8a1 1 0 0 1 1 .7L21 9.5" />
    <path d="M9.5 21v-6h5v6" />
  </Glyph>
);

export const IconCheck = (p: GlyphProps) => (
  <Glyph {...p}>
    <path d="m4.5 12.5 5 5 10-11" />
  </Glyph>
);

export const IconChevronRight = (p: GlyphProps) => (
  <Glyph {...p}>
    <path d="m9.5 5 7 7-7 7" />
  </Glyph>
);

export const IconArrowRight = (p: GlyphProps) => (
  <Glyph {...p}>
    <path d="M4 12h15" />
    <path d="m13 6 6 6-6 6" />
  </Glyph>
);

export const IconChevronDown = (p: GlyphProps) => (
  <Glyph {...p}>
    <path d="m5 9.5 7 7 7-7" />
  </Glyph>
);

export const IconMail = (p: GlyphProps) => (
  <Glyph {...p}>
    <rect x="2.5" y="5" width="19" height="14" rx="2.5" />
    <path d="m3.5 7 7.4 5.3a2 2 0 0 0 2.2 0L20.5 7" />
  </Glyph>
);

export const IconPhone = (p: GlyphProps) => (
  <Glyph {...p}>
    <path d="M7.5 3.5h-2A2.5 2.5 0 0 0 3 6.2C3.5 14 10 20.5 17.8 21a2.5 2.5 0 0 0 2.7-2.5v-2l-4.5-1.5-2 2a13.5 13.5 0 0 1-5-5l2-2Z" />
  </Glyph>
);

export const IconMapPin = (p: GlyphProps) => (
  <Glyph {...p}>
    <path d="M12 21.5s7-5.6 7-11.5a7 7 0 1 0-14 0c0 5.9 7 11.5 7 11.5Z" />
    <circle cx="12" cy="10" r="2.6" />
  </Glyph>
);

export const IconPlay = (p: GlyphProps) => (
  <Glyph {...p}>
    <path d="M8 5.5v13l11-6.5Z" />
  </Glyph>
);

export const IconPause = (p: GlyphProps) => (
  <Glyph {...p}>
    <path d="M9 5v14M15 5v14" />
  </Glyph>
);

export const IconShieldCheck = (p: GlyphProps) => (
  <Glyph {...p}>
    <path d="M12 3 5 5.5V11c0 5 3 8.5 7 10 4-1.5 7-5 7-10V5.5Z" />
    <path d="m9 12 2.2 2.2L15.5 9.7" />
  </Glyph>
);

export const IconTimer = (p: GlyphProps) => (
  <Glyph {...p}>
    <path d="M9 2.5h6" />
    <path d="M12 5.5v3" />
    <circle cx="12" cy="14" r="8" />
    <path d="M12 14V9.8" />
  </Glyph>
);

/* --- image tile ----------------------------------------------------------
   A square well holding a picture, or an icon when there is no picture — a
   headshot nobody uploaded, a service with no photo, a URL that 404s.       */

/**
 * Renders `src`, falling back to `fallback` when it is null or fails to load.
 *
 * @param src       Image URL, or null when there is none.
 * @param alt       Alt text. Empty by default: these images sit beside a
 *                  heading that already names the thing, so announcing them
 *                  again is noise.
 * @param fallback  Rendered in place of the image. An icon, usually.
 * @param className Sizing and shape of the well itself.
 */
export function ImageTile({
  src,
  alt = "",
  fallback,
  className = "",
}: {
  src: string | null;
  alt?: string;
  fallback: React.ReactNode;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);

  return (
    <span
      className={`grid shrink-0 place-items-center overflow-hidden bg-surface-sunken ${className}`}
    >
      {src !== null && !failed ? (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          // onError alone is not enough on a server-rendered page: the browser
          // starts loading from the HTML, so an image that fails before React
          // hydrates fires its error event into nothing and stays visibly
          // broken forever. A decoded image always reports a non-zero
          // naturalWidth, so zero-once-complete means it failed.
          ref={(node) => {
            if (node?.complete && node.naturalWidth === 0) setFailed(true);
          }}
          className="size-full object-cover"
        />
      ) : (
        fallback
      )}
    </span>
  );
}

/** Minimal page chrome: the wordmark and a way home, nothing else.
 *
 *  For pages that belong to somebody else — a shop, a barber — where the
 *  landing page's nav would be wrong, since its anchors point at sections
 *  those pages do not have. */
export function WordmarkBar() {
  return (
    <header className="border-b border-hairline bg-surface">
      <Container>
        <div className="flex min-h-14 items-center">
          <Link
            to="/"
            className="inline-flex min-h-11 items-center rounded-md pe-2 transition-colors duration-120 ease-standard hover:bg-hover-wash"
          >
            <Wordmark />
          </Link>
        </div>
      </Container>
    </header>
  );
}

/** Wordmark lockup. Used by the header and the footer. */
export function Wordmark({ className = "" }: { className?: string }) {
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
