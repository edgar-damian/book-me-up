import * as React from "react";
import { Container, Reveal } from "~/widgets/kit";
import { SiteHeader } from "~/widgets/siteHeader";
import { ShopFooter } from "~/widgets/shopFooter";
import { ServiceCard } from "~/widgets/WorkerPage/serviceCard";
import {EstablishmentSelector} from "~/widgets/WorkerPage/establishmentSelector"
import type {
  Services,
  Establishment,
  Day,
  Chair,
  WorkerLandingPage,
} from "~/models/workerPage";


const CONTACT_LINK = "inline-flex min-h-11 items-center text-body-sm text-primary-text";

/** A US number as (692) 555-0102. Other countries stay in E.164. */
function displayPhone(e164: string) {
  const us = e164.match(/^\+1(\d{3})(\d{3})(\d{4})$/);
  return us ? `(${us[1]}) ${us[2]}-${us[3]}` : e164;
}


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
        {(worker.public_phone || worker.public_email) && (
          <div className="mt-6 max-w-2xl">
            <p className="text-body-md text-ink-secondary">Have questions? Reach out:</p>
            <ul className="mt-1 list-disc pl-5 text-body-sm text-ink-secondary">
              {worker.public_phone && (
                <li>
                  Phone:{" "}
                  <a href={`tel:${worker.public_phone}`} className={CONTACT_LINK}>
                    {displayPhone(worker.public_phone)}
                  </a>
                </li>
              )}
              {worker.public_email && (
                <li>
                  Email:{" "}
                  <a href={`mailto:${worker.public_email}`} className={`${CONTACT_LINK} break-all`}>
                    {worker.public_email}
                  </a>
                </li>
              )}
            </ul>
          </div>
        )}
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
      <SiteHeader company={false} />
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
      {chair && <ShopFooter establishment={chair.establishment} />}
    </div>
  );
}
