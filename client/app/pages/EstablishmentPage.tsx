import { Container, IconMapPin, Reveal, WordmarkBar } from "~/widgets/kit";
import { WorkerCard } from "~/widgets/workerCard";
import type { Establishment, EstablishmentWorker } from "~/models/establishmentPage";


function ShopHeader({ establishment }: { establishment: Establishment }) {
  return (
    <section className="pt-16 pb-12 md:pt-24 lg:pt-32">
      <Container>
        <p className="text-eyebrow uppercase text-ink-muted">
          {establishment.city}, {establishment.state}
        </p>
        <h1 className="mt-3 max-w-4xl font-display text-display-1 text-ink">
          {establishment.name}
        </h1>
        <p className="mt-6 max-w-2xl text-body-md text-ink-secondary">
          {establishment.description}
        </p>
      </Container>
    </section>
  );
}


function WorkerList({ workers }: { workers: EstablishmentWorker[] }) {
  return (
    <section className="py-16 md:py-24 lg:py-32">
      <Container>
        <h2 className="text-heading-2 text-ink"> Meet our crew </h2>

        {workers.length === 0 ? (
          <p className="mt-3 text-body-md text-ink-muted">
            Nobody is taking bookings here yet.
          </p>
        ) : (
          <Reveal stagger className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {workers.map((worker) => (
              <WorkerCard key={worker.id} worker={worker} />
            ))}
          </Reveal>
        )}
      </Container>
    </section>
  );
}


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
    >
      Get directions
    </a>
  );
}


function AddressFooter({ establishment }: { establishment: Establishment }) {
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

            {(establishment.phone || establishment.email) && (
              <div className="mt-2 flex flex-col items-start">
                <a className="inline-flex min-h-11 items-center text-body-sm text-primary-text">
                  <DirectionsLink location={establishment} />
                </a>
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
            )}
          </div>
        </div>
      </Container>
    </footer>
  );
}


export function EstablishmentPage({
  establishment,
}: {
  establishment: Establishment;
}) {
  return (
    <div className="overflow-x-clip bg-canvas-soft text-ink">
      <WordmarkBar />
      <main>
        <ShopHeader establishment={establishment} />
        <WorkerList workers={establishment.workers} />
      </main>
      <AddressFooter establishment={establishment} />
    </div>
  );
}
