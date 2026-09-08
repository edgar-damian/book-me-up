import * as React from "react";
import { Container, Reveal, WordmarkBar } from "~/widgets/kit";
import { ServiceCard } from "~/widgets/WorkerPage/serviceCard";
import {EstablishmentSelector} from "~/widgets/WorkerPage/establishmentSelector"
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
  needsShopFor,
  onNeedShop,
}: {
  services: Services[];
  workerId: string;
  establishmentId: string | null;
  needsShopFor: string | null;
  onNeedShop: (serviceId: string) => void;
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
                needsShop={needsShopFor === service.id}
                onNeedShop={() => onNeedShop(service.id)}
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

  const [chair, setChair] = React.useState<Chair | null>(
    worker.chairs.length === 1 ? worker.chairs[0] : null,
  );

  const [needsShopFor, setNeedsShopFor] = React.useState<string | null>(null);

  const selectorRef = React.useRef<HTMLDivElement>(null);
  const noChairs = worker.chairs.length === 0;

  function handleNeedShop(serviceId: string) {
    setNeedsShopFor(serviceId);
    if (noChairs) return; // nothing rendered to scroll to

    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    selectorRef.current?.scrollIntoView({
      behavior: calm ? "auto" : "smooth",
      block: "center",
    });

    selectorRef.current
      ?.querySelector<HTMLElement>('[role="button"]')
      ?.focus({ preventScroll: true });

    const el = selectorRef.current;
    if (el) {
      el.classList.remove("attention-nudge");
      void el.offsetWidth;
      el.classList.add("attention-nudge");
    }
  }

  return (
    <div className="overflow-x-clip bg-canvas-soft text-ink">
      <WordmarkBar />
      <main>
        <BarberHeader worker={worker} />

        <div ref={selectorRef} className="mt-10">
          <Container>
            <EstablishmentSelector
              chairs={worker.chairs}
              prompting={needsShopFor !== null}
              onSelect={(next) => {
                setChair(next);
                if (next) setNeedsShopFor(null);
              }}
            />
          </Container>
        </div>

        <ServiceList
          services={worker.services}
          workerId={worker.id}
          establishmentId={chair?.establishment.id ?? null}
          needsShopFor={needsShopFor}
          onNeedShop={handleNeedShop}
        />
      </main>
    </div>
  );
}
