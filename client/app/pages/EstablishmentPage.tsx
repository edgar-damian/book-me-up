import { Container, Reveal } from "~/widgets/kit";
import { SiteHeader } from "~/widgets/siteHeader";
import { WorkerCard } from "~/widgets/workerCard";
import { ShopFooter } from "~/widgets/shopFooter";
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


export function EstablishmentPage({
  establishment,
}: {
  establishment: Establishment;
}) {
  return (
    <div className="overflow-x-clip bg-canvas-soft text-ink">
      <SiteHeader company={false} />
      <main>
        <ShopHeader establishment={establishment} />
        <WorkerList workers={establishment.workers} />
      </main>
      <ShopFooter establishment={establishment} />
    </div>
  );
}
