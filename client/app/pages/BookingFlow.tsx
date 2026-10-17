import { useEffect, useRef } from "react";
import { useNavigation, useSearchParams } from "react-router";
import { Container, Spinner } from "~/widgets/kit";
import { SiteHeader } from "~/widgets/siteHeader";
import { Progress, type Step } from "~/widgets/BookingFlow/progress";
import { Calendar } from "~/widgets/BookingFlow/calendar";
import { TimeSlots } from "~/widgets/BookingFlow/timeSlot";
import { RequestForm } from "~/widgets/BookingFlow/requestForm";
import { Confirmation } from "~/widgets/BookingFlow/confirmation";
import type { DatesAvailable, TimesAvailable, AppointmentBooked } from "~/models/bookingFlow";

/* One page, one body. The header never changes; the progress strip and the
   widget under it do. Which widget is derived from the URL, so the loader can
   fetch step 2 on its own and the flow stays shareable and back-button-safe. */

type Params = { day?: string | null; slot?: string | null };

function Header({ dates }: { dates: DatesAvailable }) {
  return (
    <section className="pt-16 pb-12 md:pt-24 lg:pt-32">
      <Container>
        <p className="text-eyebrow uppercase text-ink-muted">{dates.establishment_name}</p>
        <h1 className="mt-3 max-w-4xl font-display text-display-1 text-ink">{dates.service_title}</h1>
        <p className="mt-6 max-w-2xl text-body-md text-ink-secondary">with {dates.worker_name}</p>
      </Container>
    </section>
  );
}

export function BookingFlow({
  dates,
  times,
  day,
  slot,
  booked,
  error,
}: {
  dates: DatesAvailable;
  times: TimesAvailable | null;
  day: string | null;
  slot: string | null;
  booked: AppointmentBooked | null;
  error: string | null;
}) {
  const [, setParams] = useSearchParams();
  const busy = useNavigation().state !== "idle";

  // The first paint is already on screen; only a step change gets the entrance.
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
  }, []);

  const go = (next: Params) =>
    setParams(
      (p) => {
        for (const [k, v] of Object.entries(next)) v ? p.set(k, v) : p.delete(k);
        return p;
      },
      { preventScrollReset: true },
    );

  const chosen = times?.valid_slots.find((s) => s.start_time === slot) ?? null;
  const step: Step = booked ? "done" : chosen ? 3 : times ? 2 : 1;

  const body = booked ? (
    <Confirmation booked={booked} workerName={dates.worker_name} workerSlug={dates.worker_slug} />
  ) : chosen && times ? (
    <RequestForm slot={chosen} timezone={times.timezone} error={error} busy={busy} onBack={() => go({ slot: null })} />
  ) : times ? (
    <TimeSlots times={times} selected={slot} notice={error} onSelect={(s) => go({ slot: s })} onBack={() => go({ day: null, slot: null })} />
  ) : (
    <Calendar dates={dates} selected={day} onSelect={(d) => go({ day: d, slot: null })} />
  );

  return (
    <div className="overflow-x-clip bg-canvas-soft text-ink">
      <SiteHeader company={false} />
      <main>
        <Header dates={dates} />
        <Container className="pb-16 md:pb-24">
          <div className="max-w-sm">
            <Progress step={step} />
            <div key={step} aria-busy={busy} className={`relative mt-6 ${mounted.current ? "step-enter" : ""}`}>
              <div className={`transition-opacity duration-200 ease-standard ${busy ? "pointer-events-none opacity-60" : ""}`}>
                {body}
              </div>
              {busy && (
                <div className="absolute inset-0 grid place-items-center">
                  <Spinner className="size-8" />
                </div>
              )}
            </div>
          </div>
        </Container>
      </main>
    </div>
  );
}
