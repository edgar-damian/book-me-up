import { useState } from "react";

import { Container, IconPause, IconPlay, useMotionAllowed } from "~/widgets/kit";

/* ===========================================================================
   PHOTO MARQUEE — a slow horizontal wheel of a shop's photos.

   THE MOVE for its section, and the only tier-2 motion in the product. Short
   on purpose: this sits between the shop's name and its people on a phone, and
   a tall band of photos would push both off the first screen.

   HOW THE LOOP IS SEAMLESS
   The track holds the tile list twice and slides exactly -50%, which lands on
   the start of the second copy — pixel-identical to where it began. Two things
   keep that true, and both are easy to undo by accident:

     - Tiles are spaced with `me-3`, NOT a flex `gap`. With `gap` the track is
       2S + (2n-1)g wide, so -50% stops half a gap short and the seam hitches
       once every loop.
     - The duration scales with the tile count (--marquee-step per photo), so a
       shop with three photos and one with thirty drift at the same speed.

   DEGRADING
   Motion is opt-in, decided by JS on mount. Without it — no JS, or reduced
   motion — this is a plain swipeable strip of each photo once, no duplicates,
   no pause button. That static state is the real content, not a fallback.

   Gating in JS rather than CSS is deliberate: app.css collapses every
   animation to 0.01ms with one iteration under reduced motion, which would
   strand this track at -50% rather than stopping it where it started.

   BROKEN IMAGES ARE NORMAL
   The API hands over bare URLs it does not verify, with no alt text and no
   ordering. Anything that fails to load is dropped, and if that leaves nothing
   the section renders nothing at all — a shop page that goes name → people →
   address is a good page. An empty grey frame is not.
   =========================================================================== */

/** Below this, a loop reads as one photo sliding away and coming back rather
    than as a wheel, so the list is repeated until it clears the bar. */
const MIN_LOOP_TILES = 4;

export function PhotoMarquee({
  images,
  shopName,
}: {
  images: string[];
  shopName: string;
}) {
  const motionAllowed = useMotionAllowed();
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());
  const [paused, setPaused] = useState(false);
  const [hovered, setHovered] = useState(false);

  const usable = images.filter((src) => !failed.has(src));
  const dropImage = (src: string) =>
    setFailed((previous) => new Set(previous).add(src));

  // Nothing loadable — say nothing.
  if (usable.length === 0) return null;

  // A single photo is a banner, not a wheel.
  if (usable.length === 1) {
    return (
      <section aria-label={`Photo of ${shopName}`}>
        <Container>
          <div className="h-40 overflow-hidden rounded-lg bg-surface-sunken md:h-56">
            <img
              src={usable[0]}
              alt=""
              loading="lazy"
              decoding="async"
              onError={() => dropImage(usable[0])}
              ref={(node) => {
                if (node?.complete && node.naturalWidth === 0)
                  dropImage(usable[0]);
              }}
              className="size-full object-cover"
            />
          </div>
        </Container>
      </section>
    );
  }

  const tile = (src: string, key: string, duplicate = false) => (
    <li
      key={key}
      className="me-3 h-40 w-64 shrink-0 overflow-hidden rounded-lg bg-surface-sunken md:h-56 md:w-80"
    >
      <img
        src={src}
        alt=""
        loading="lazy"
        decoding="async"
        aria-hidden={duplicate || undefined}
        onError={() => dropImage(src)}
        // Catches an image that already failed before React hydrated, whose
        // error event fired into nothing. A decoded image always reports a
        // non-zero naturalWidth, so zero-once-complete means it failed.
        ref={(node) => {
          if (node?.complete && node.naturalWidth === 0) dropImage(src);
        }}
        className="size-full object-cover"
      />
    </li>
  );

  if (!motionAllowed) {
    return (
      <section aria-label={`Photos of ${shopName}`}>
        {/* tabIndex keeps the strip reachable for anyone scrolling by keyboard
            rather than by thumb. */}
        <div tabIndex={0} className="overflow-x-auto">
          <ul className="flex w-max ps-4 pe-1 md:ps-6">
            {usable.map((src, index) => tile(src, `${src}-${index}`))}
          </ul>
        </div>
      </section>
    );
  }

  // Repeat the shop's photos until the strip is long enough to read as a loop,
  // then lay that sequence down twice — the second copy is what the first
  // scrolls into.
  const loop: string[] = [];
  while (loop.length < MIN_LOOP_TILES) loop.push(...usable);

  return (
    <section aria-label={`Photos of ${shopName}`} className="relative">
      <div
        className="marquee-mask overflow-hidden"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <ul
          className="marquee-track flex w-max"
          style={{
            animationDuration: `calc(var(--marquee-step) * ${loop.length})`,
            animationPlayState: paused || hovered ? "paused" : "running",
          }}
        >
          {loop.map((src, index) => tile(src, `a-${src}-${index}`))}
          {loop.map((src, index) => tile(src, `b-${src}-${index}`, true))}
        </ul>
      </div>

      {/* Anything that moves for more than five seconds needs a way to stop it
          (WCAG 2.2.2). Hovering pauses too, but a pointer is not a given. */}
      <button
        type="button"
        onClick={() => setPaused((previous) => !previous)}
        aria-label={paused ? "Play photo carousel" : "Pause photo carousel"}
        className="absolute right-4 bottom-3 grid size-11 place-items-center rounded-pill border border-hairline bg-surface text-ink-secondary shadow-soft transition-colors duration-120 ease-standard hover:bg-hover-wash active:bg-press-wash md:right-6"
      >
        {paused ? (
          <IconPlay className="size-5" />
        ) : (
          <IconPause className="size-5" />
        )}
      </button>
    </section>
  );
}
