import { useEffect, useRef, useState } from "react";
import { Form, Link, useNavigation, useSearchParams } from "react-router";
import { Container, Cta, Glyph, Spinner, Wordmark } from "~/widgets/kit";

// Root-relative so each link reaches the landing page's section from any page.
const NAV_LINKS = [
  { label: "Features", href: "/#features" },
  { label: "Who it's for", href: "/#verticals" },
  { label: "Pricing", href: "/#pricing" },
  { label: "Contact Us", href: "/#pricing" },
  { label: "Free Trial", href: "/#pricing" },
];

type NavItem = { label: string; href: string };

// A signed-in worker's own settings, each opened in the dashboard's edit dialog.
const SHOP_LINKS: NavItem[] = [
  { label: "Time off", href: "/dashboard?edit=time-off" },
  { label: "Hours", href: "/dashboard?edit=schedule" },
  { label: "Services", href: "/dashboard?edit=services" },
  { label: "Profile", href: "/dashboard?edit=profile" },
];

/** A worker's link goes through Link, so opening a dialog doesn't reload the
 *  dashboard. Company links jump to the landing page's sections, so they stay
 *  plain anchors. */
function HeaderLink({
  link,
  inApp,
  className,
  onClick,
}: {
  link: NavItem;
  inApp: boolean;
  className: string;
  onClick?: () => void;
}) {
  if (inApp) {
    return (
      <Link to={link.href} preventScrollReset onClick={onClick} className={className}>
        {link.label}
      </Link>
    );
  }
  return (
    <a href={link.href} onClick={onClick} className={className}>
      {link.label}
    </a>
  );
}

/** The worker's Log out. The /logout action ends their session and clears the
 *  cookie. While it runs, the spinner covers the hidden label, so the button
 *  keeps its width. */
function LogOut() {
  // formAction stays "/logout" through the redirect to /login.
  const busy = useNavigation().formAction === "/logout";
  return (
    <Form method="post" action="/logout">
      <button
        type="submit"
        aria-busy={busy || undefined}
        className={`inline-grid min-h-11 w-full place-items-center rounded-md border border-border-input bg-surface px-4 text-button text-ink transition-colors duration-120 ease-standard hover:bg-hover-wash active:bg-press-wash ${
          busy ? "pointer-events-none" : ""
        }`}
      >
        <span className={`col-start-1 row-start-1 ${busy ? "invisible" : ""}`}>Log out</span>
        {busy && <Spinner className="col-start-1 row-start-1 size-4" label="Logging out…" />}
      </button>
    </Form>
  );
}

/** One set of links or neither, never both. */
type Props = { company: boolean; shop?: false } | { company?: false; shop: boolean };

/** Sticky top bar on every page.
 *
 *  `company` adds book-me-up's own navigation: section links, Log in / Get
 *  started, and the mobile menu. `shop` adds a signed-in worker's instead: their
 *  own pages and Log out, with the wordmark leading back to the dashboard. Pages
 *  that belong to a shop or a barber pass neither and show the wordmark alone,
 *  linking home. */
export function SiteHeader({ company = false, shop = false }: Props) {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const chair = useSearchParams()[0].get("chair");

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

  // The shop the dashboard shows rides along, so a dialog opened from here keeps it.
  const shopLinks = chair
    ? SHOP_LINKS.map((l) => ({ ...l, href: `${l.href}&chair=${encodeURIComponent(chair)}` }))
    : SHOP_LINKS;
  const links: NavItem[] | null = company ? NAV_LINKS : shop ? shopLinks : null;

  return (
    <header
      className={`sticky top-0 z-50 border-b border-hairline bg-surface transition-shadow duration-200 ease-standard ${
        scrolled ? "shadow-soft" : ""
      }`}
    >
      <Container>
        <div className="flex min-h-14 items-center justify-between gap-4">
          <Link
            to={shop ? "/dashboard" : "/"}
            className="inline-flex min-h-11 items-center rounded-md pe-2 transition-colors duration-120 ease-standard hover:bg-hover-wash"
          >
            <Wordmark />
            <span className="sr-only">{shop ? "book-me-up dashboard" : "book-me-up home"}</span>
          </Link>

          {links && (
            <>
              <nav aria-label="Primary" className="hidden md:block">
                <ul className="flex items-center gap-1">
                  {links.map((link) => (
                    <li key={link.label}>
                      <HeaderLink
                        link={link}
                        inApp={shop}
                        className="inline-flex min-h-11 items-center rounded-md px-3 text-body-sm text-ink-secondary transition-colors duration-120 ease-standard hover:bg-hover-wash hover:text-ink"
                      />
                    </li>
                  ))}
                </ul>
              </nav>

              <div className="hidden items-center gap-2 md:flex">
                {company ? (
                  <>
                    <a
                      href="/login"
                      className="inline-flex min-h-11 items-center rounded-md px-3 text-body-sm text-primary-text transition-colors duration-120 ease-standard hover:bg-hover-wash"
                    >
                      Log in
                    </a>
                    <a
                      href="/waitlist"
                      className="inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-4 text-button text-on-primary transition-colors duration-120 ease-standard hover:bg-primary-hover active:bg-primary-active"
                    >
                      Join a waitlist
                    </a>
                  </>
                ) : (
                  <LogOut />
                )}
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
            </>
          )}
        </div>
      </Container>

      {links && (
        <>
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
                {links.map((link) => (
                  <li key={link.label}>
                    <HeaderLink
                      link={link}
                      inApp={shop}
                      onClick={() => setOpen(false)}
                      className="flex min-h-11 items-center rounded-sm px-3 text-title text-ink transition-colors duration-120 ease-standard hover:bg-hover-wash"
                    />
                  </li>
                ))}
              </ul>
            </nav>

            <div className="flex flex-col gap-2">
              {company ? (
                <>
                  <Cta href="/waitlist">Join a waitlist</Cta>
                  <Cta href="/login" variant="secondary">
                    Log in
                  </Cta>
                </>
              ) : (
                <LogOut />
              )}
            </div>
          </div>
        </>
      )}
    </header>
  );
}
