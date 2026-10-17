import { Container, IconMapPin } from "~/widgets/kit";
import type { Establishment } from "~/models/establishmentPage";


function DirectionsLink({ location }: { location: Establishment }) {

  function getDirectionsUrl(loc: Establishment): string {
    const destination =
      loc.lat !== null && loc.lng !== null
        ? `${loc.lat},${loc.lng}`
        : [loc.address, loc.city, loc.state, loc.zip].filter(Boolean).join(", ");

    return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`;
  }

  return (
    <a
      href={getDirectionsUrl(location)}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex min-h-11 items-center text-body-sm text-primary-text"
    >
      Get directions
    </a>
  );
}


/** Footer for pages that belong to a shop: its address, directions, and
 *  contact links, with no book-me-up branding. */
export function ShopFooter({ establishment }: { establishment: Establishment }) {
  return (
    <footer className="border-t border-hairline bg-surface">
      <Container className="py-16">
        <div className="flex items-start gap-4">
          <span className="grid size-11 shrink-0 place-items-center rounded-lg border border-hairline text-ink-secondary">
            <IconMapPin className="size-5" />
          </span>

          <div>
            <h2 className="text-heading-3 text-ink">{establishment.name}</h2>
            <address className="mt-2 not-italic text-body-md text-ink-secondary">
              {establishment.address}
              <br />
              {establishment.city}, {establishment.state} {establishment.zip}
            </address>

            <div className="mt-2 flex flex-col items-start">
              <DirectionsLink location={establishment} />
              {establishment.phone && (
                <a
                  href={`tel:${establishment.phone}`}
                  className="inline-flex min-h-11 items-center text-body-sm text-primary-text"
                >
                  {establishment.phone}
                </a>
              )}
              {establishment.email && (
                <a
                  href={`mailto:${establishment.email}`}
                  className="inline-flex min-h-11 items-center text-body-sm text-primary-text"
                >
                  {establishment.email}
                </a>
              )}
            </div>
          </div>
        </div>
      </Container>
    </footer>
  );
}
