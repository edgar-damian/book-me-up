import Velaris from "~/widgets/21dev/header"
import { Container, IconMapPin, Reveal, WordmarkBar } from "~/widgets/kit";
import { ServiceCard } from "~/widgets/WorkerPage/serviceCard";
import type { 
  Services, 
  Establishment, 
  Day,
  Chair,
  WorkerLandingPage,
} from "~/models/workerPage";


function BarberHeader({ worker }: { worker: WorkerLandingPage }) {
  return (
    <section className="pt-16 md:pt-24 lg:pt-32"> 
      <Container>
        <h1 className="mt-3 max-w-4xl font-display text-display-1 text-ink">
          {worker.first_name + " " + worker.last_name}
        </h1>
        <p className="mt-6 max-w-2xl text-body-md text-ink-secondary">
          {worker.bio}
        </p>
      </Container>
    </section>
  );
}


function ServiceList({
  services,
  workerId,
  establishmentId,
}: {
  services: Services[];
  workerId: string;
  establishmentId: string;
}) {
  return (
    <section className="pt-18 pb-16 md:pt-24 md:pb-24 lg:pt-30 lg:pb-32">
      <Container>
        <h2 className="text-heading-2 text-ink"> Services </h2>

        {services.length === 0 ? (
          <p className="mt-3 text-body-md text-ink-muted">
            This person has not posted their services yet.
          </p>
        ) : (
          <Reveal stagger className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {services.map((service) => (
              <ServiceCard
                key={service.id}
                service={service}
                workerId={workerId}
                establishmentId={establishmentId}
              />
            ))}
          </Reveal>
        )}
      </Container>
    </section>
  );
}


export function WorkerPage({
  worker,
}: {
  worker: WorkerLandingPage;
}) {
  return (
    <div className="overflow-x-clip bg-canvas-soft text-ink">
      <WordmarkBar />
      <main>
        <BarberHeader worker={worker} />
        {/* TODO: chairs is a list -- a barber can work several shops, and this
            silently picks the first. Needs a location picker before it ships. */}
        <ServiceList
          services={worker.services}
          workerId={worker.id}
          establishmentId={worker.chairs[0]?.establishment.id ?? ""}
        />
      </main>
    </div>
  );
}