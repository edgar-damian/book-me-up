import { Container, Wordmark } from "~/widgets/kit";

// Root-relative so each link reaches the landing page's section from any page.
const FOOTER_COLUMNS = [
  {
    heading: "Product",
    links: [
      { label: "Features", href: "/#features" },
      { label: "Who it's for", href: "/#verticals" },
      { label: "Pricing", href: "/#pricing" },
    ],
  },
  {
    heading: "Company",
    links: [
      { label: "About", href: "/#about" },
      { label: "Contact Us", href: "/#contact" },
    ],
  },
  {
    heading: "Legal",
    links: [
      { label: "Privacy", href: "/#privacy" },
      { label: "Terms", href: "/#terms" },
    ],
  },
];

/** Footer for book-me-up's own pages. Pages that belong to a shop use
 *  `ShopFooter` instead. */
export function CompanyFooter() {
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
