import { useEffect, useRef, useState } from "react";
import {
  Container,
  Cta,
  Glyph,
  Reveal,
  Wordmark,
  IconCalendar,
  IconCalendarOff,
  IconCheck,
  IconLash,
  IconLink,
  IconMenuList,
  IconNote,
  IconPiercing,
  IconPolish,
  IconScissors,
  IconShieldCheck,
  IconTattoo,
  IconTimer,
  IconWaves,
} from "../widgets/kit";

/*
Landing page header with a drop down menu (on mobile) or 
*/
const NAV_LINKS = [
  { label: "Features", href: "#features" },
  { label: "Who it's for", href: "#verticals" },
  { label: "Pricing", href: "#pricing" },
  { label: "Contact Us", href: "#pricing"},
  { label: "Free Trial", href: "#pricing"}
];

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);


  // makes a shadow on the header AFTER the user scrolls down
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

/*
Uses `Hero()` to build the top part of the landing page, this is what the users 
first see. 
NOTE: Refine this later
*/
const HERO = {
  eyebrow: "For barbers, stylists, and artists who rent their chair",
  headline: "Stop booking clients in your DMs.",
  body: "Share one link. Clients pick a time that's actually open, reminders go out on their own, and nobody double-books your chair.",
  primaryCta: { label: "Create my booking link", href: "#get-started" },
  primatyCtaWaitlist: { label: "Join Wait List", href: "" }, // NOTE: this is only temporary while the application gets finished
  secondaryCta: { label: "See how it works", href: "#features" },
  footnote: "Set up in 5 minutes from your phone. Clients book in two taps — no app, no account.",
};

// TODO: this will be replaced by a screen shot of the working product 
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

          {/* TODO: this will be replaced by a screen shot of the working product  */}
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

/*
Builds a vertical stack of possible positions/roles the `Worker` is
*/
const VERTICALS_HEADING = "Same setup, whatever's behind your chair.";
const VERTICALS_BODY =
  "Clippers, color, needles, or lashes — you're still one person with a link, a calendar, and a client who needs to show up on time.";

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


// TODO: whole section has to go. its all bad, should be replaced with screen shots
// look for `END OF NOTE`
const FEATURES_HEADING = "Everything a chair needs, nothing it doesn't.";

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
// END OF NOTE

/*
List off some capabilities
*/

const CAPABILITIES_HEADING = "You make the rules. Your link enforces them.";

const CAPABILITIES = [
  {
    Icon: IconShieldCheck,
    title: "Approve every client, or none of them",
    body: "Screen each request one by one if you're picky, or let the book fill itself while you work. Flip it whenever you feel like it.",
  },
  {
    Icon: IconCalendarOff,
    title: "Close the book whenever you want",
    body: "Block an hour, an afternoon, or all of August. You go dark everywhere you work at once — no updating three calendars.",
  },
  {
    Icon: IconTimer,
    title: "Nobody books you back-to-back",
    body: "Set breathing room between clients, cap how many you take in a day, and shut off last-minute requests before they land.",
  },
];

export function Capabilities() {
  return (
    <section className="py-16 md:py-24 lg:py-32">
      <Container>
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


/* 
Pricing section
*/

const PRICING_HEADING = "Everyone pays for their own chair. Bring friends and it gets cheaper.";
const PRICING_NOTE =
  "Early pricing while we're getting off the ground. No setup fee, no contract, cancel whenever.";

const PRICING_PLANS = [
  {
    name: "Solo",
    price: "$20",
    cadence: "per month",
    blurb: "You, your book, your clients.",
    features: [
      "Your own booking link",
      "Unlimited services and appointments",
      "Automatic reminders",
      "Client notes and history",
    ],
    cta: { label: "Get started", href: "#get-started" },
    recommended: false,
  },
  {
    name: "Shop",
    price: "$15",
    cadence: "per person, per month",
    blurb: "Same setup, $5 off each, when 3+ of you work the same shop.",
    features: [
      "Everything in Solo, for each person",
      "Everyone keeps their own link and calendar",
      "Optional shop page that lists all of you",
      "Owner view across the floor, if you want one",
    ],
    cta: { label: "Get started", href: "#get-started" },
    recommended: true,
  },
  {
    name: "Yearly",
    price: "$150",
    cadence: "per person, per year",
    blurb: "Pay once, skip the monthly bill.",
    features: [
      "Everything above, billed once a year",
      "Cheaper than 12 months either way",
      "Solo or shop, same yearly price",
      "One less thing to think about",
    ],
    cta: { label: "Get started", href: "#get-started" },
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

/* 
CTA band, currently shows a 3 month promotion
*/

const CTA_BAND = {
  heading: "Set it up tonight. Take bookings tomorrow.",
  body: "Your first 3 months are free while early pricing lasts. No setup fee, no contract, cancel whenever.",
  primary: { label: "Start my 3 free months", href: "#get-started" },
  secondary: { label: "See what it costs after", href: "#pricing" },
};

export function CtaBand() {
  return (
    <section className="py-16 md:py-24 lg:py-32">
      <Container>
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

/*
Footer
*/
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
      { label: "Contact Us", href: "#contact" },
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
              Scheduling service for independent workers.
            </p>
          </div>

          {FOOTER_COLUMNS.map((column) => (
            <nav key={column.heading} aria-label={column.heading}>
              <h2 className="text-eyebrow uppercase tracking-wide text-ink">
                {column.heading}
              </h2>
              <ul className="mt-3 flex flex-col">
                {column.links.map((link) => (
                  <li key={link.href}>
                    <a
                      href={link.href}
                      className="inline-flex min-h-11 items-center text-body-sm text-ink-muted transition-colors duration-120 ease-standard hover:text-ink md:min-h-8"
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

/*
Constructs the actual LandingPage object that pieces together all the functions above 
*/
export default function LandingPage() {
  return (
    <div id="landing-root" className="overflow-x-clip bg-canvas-soft text-ink">
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
