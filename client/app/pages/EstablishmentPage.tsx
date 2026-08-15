import { Container, IconMapPin, Reveal, WordmarkBar } from "~/widgets/kit";
import { PhotoMarquee } from "~/widgets/PhotoMarquee";
import { WorkerCard, type Worker } from "~/widgets/WorkerCard";


export type Establishment = {
  id: string;
  slug: string;
  name: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  lat: number | null;
  lng: number | null;
  timezone: string;
  phone: string | null;
  email: string | null;
  hours: unknown | null;
  description: string;
  images: string[];
  is_active: boolean;
  workers: Worker[];
};


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


function WorkerList({ workers }: { workers: Worker[] }) {
  return (
    <section className="py-16 md:py-24 lg:py-32">
      <Container>
        <h2 className="text-heading-2 text-ink">Who works here</h2>

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
                {establishment.phone && (
                  // primary-text, not primary: the fill blue does not clear
                  // 4.5:1 at body size.
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
  // filters non activated workers that still show up from the API
  const workers = establishment.workers.filter((worker) => worker.is_active);

  return (
    <div className="overflow-x-clip bg-canvas-soft text-ink">
      <WordmarkBar />
      <main>
        <ShopHeader establishment={establishment} />
        <PhotoMarquee
          images={establishment.images}
          shopName={establishment.name}
        />
        <WorkerList workers={workers} />
      </main>
      <AddressFooter establishment={establishment} />
    </div>
  );
}
