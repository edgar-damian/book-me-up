/** The booking flow: shop, date, time, details — one step at a time at one
    URL, with the spotlight panel swapping between them. Step state is React
    state, not search params, because search params would re-run the loader. */

import { useEffect, useState } from "react";
import { Link, useFetcher } from "react-router";
import {
  Container,
  IconCalendar,
  IconCheck,
  IconChevronRight,
  IconClock,
  IconStorefront,
  WordmarkBar,
} from "~/widgets/kit";
import { formatDuration, formatPrice } from "~/widgets/format";
import type { Service } from "~/widgets/ServiceCard";
import type { Barber, Chair } from "~/pages/BookWith";
import {
  EmptyPanel,
  ErrorPanel,
  Pending,
  Spotlight,
  StepHeading,
  StepTrail,
  type Step,
} from "~/booking/kit";
import { MonthCalendar } from "~/booking/MonthCalendar";
import { DetailsForm, EMPTY_VALUES, type Values } from "~/booking/DetailsForm";
import {
  availabilityHref,
  type AvailabilityDates,
  type AvailabilityResult,
  type AvailabilityTimes,
  type BookingActionData,
  type BookingConfirmation,
  type BookingTarget,
  type ValidSlot,
} from "~/booking/contract";
import {
  deadline,
  groupByPeriod,
  longDate,
  shortDate,
  slotRange,
  slotTime,
  ymdIn,
} from "~/booking/format";

type FlowStep = "shop" | "date" | "time" | "details" | "done";

export function BookingFlow({
  barber,
  service,
  chairs,
  prefetchedDates,
}: {
  barber: Barber;
  service: Service;
  chairs: Chair[];
  /** Present only when the barber has one chair — see the loader. */
  prefetchedDates: AvailabilityResult | null;
}) {
  const needsShopChoice = chairs.length > 1;

  const [chair, setChair] = useState<Chair | null>(() =>
    chairs.length === 1 ? chairs[0] : null,
  );
  const [day, setDay] = useState<string | null>(null);
  const [slot, setSlot] = useState<ValidSlot | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Held here rather than in DetailsForm: a 409 sends the flow back to the time
  // step, which unmounts the form, and local state would go with it.
  const [values, setValues] = useState<Values>(EMPTY_VALUES);

  /* --- availability --- */

  // One fetcher for both reads, so a fast day-switch can't let a stale
  // response win. Results are copied into state because they share it.
  const availability = useFetcher<AvailabilityResult>();
  const [loadingKind, setLoadingKind] = useState<"dates" | "times" | null>(null);

  const [dates, setDates] = useState<AvailabilityDates | null>(() =>
    prefetchedDates?.ok && prefetchedDates.kind === "dates" ? prefetchedDates.data : null,
  );
  const [datesError, setDatesError] = useState<string | null>(() =>
    prefetchedDates && !prefetchedDates.ok ? prefetchedDates.message : null,
  );

  const [times, setTimes] = useState<AvailabilityTimes | null>(null);
  const [timesError, setTimesError] = useState<string | null>(null);

  useEffect(() => {
    if (availability.state !== "idle") return;

    const result = availability.data;
    if (result) {
      if (result.kind === "dates") {
        setDates(result.ok ? result.data : null);
        setDatesError(result.ok ? null : result.message);
      } else {
        setTimes(result.ok ? result.data : null);
        setTimesError(result.ok ? null : result.message);
      }
    }
    setLoadingKind(null);
  }, [availability.state, availability.data]);

  const target: BookingTarget | null = chair
    ? {
        establishmentId: chair.establishment.id,
        workerId: barber.id,
        serviceId: service.id,
      }
    : null;

  function loadDates(next: Chair) {
    setLoadingKind("dates");
    setDatesError(null);
    availability.load(
      availabilityHref("dates", {
        establishmentId: next.establishment.id,
        workerId: barber.id,
        serviceId: service.id,
      }),
    );
  }

  function loadTimes(forDay: string) {
    if (!target) return;
    setLoadingKind("times");
    setTimesError(null);
    availability.load(availabilityHref("times", target, forDay));
  }

  /* --- creating the booking --- */

  const booking = useFetcher<BookingActionData>();
  const confirmed = booking.data?.ok ? booking.data.booking : null;

  // Losing the race is ordinary traffic: the slot list cannot be race-proof
  // and the exclusion constraint is the real guard.
  useEffect(() => {
    const result = booking.data;
    if (!result || result.ok || result.kind !== "slot_taken") return;
    if (!day) return;

    setSlot(null);
    setNotice("Someone took that time while you were filling this in. Here's what's still open.");
    loadTimes(day);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [booking.data]);

  /* --- which step is in the light --- */

  const step: FlowStep = confirmed
    ? "done"
    : chair === null
      ? "shop"
      : day === null
        ? "date"
        : slot === null
          ? "time"
          : "details";

  const steps: Step[] = [
    ...(needsShopChoice ? [{ id: "shop", label: "Shop" }] : []),
    { id: "date", label: "Date" },
    { id: "time", label: "Time" },
    { id: "details", label: "Details" },
  ];
  const currentIndex =
    step === "done" ? steps.length : steps.findIndex((s) => s.id === step);

  /* --- moving between steps --- */

  function chooseChair(next: Chair) {
    setChair(next);
    setDay(null);
    setSlot(null);
    setTimes(null);
    setNotice(null);
    loadDates(next);
  }

  function chooseDay(next: string) {
    setDay(next);
    setSlot(null);
    setNotice(null);
    loadTimes(next);
  }

  function backToShop() {
    setChair(null);
    setDay(null);
    setSlot(null);
    setDates(null);
    setTimes(null);
    setNotice(null);
  }

  function backToDate() {
    setDay(null);
    setSlot(null);
    setTimes(null);
    setNotice(null);
  }

  return (
    <div className="min-h-screen bg-canvas-soft text-ink">
      <WordmarkBar />

      <main className="pb-16 pt-8 md:pb-24 md:pt-12">
        <Container className="max-w-2xl">
          <FlowHeader
            barber={barber}
            service={service}
            chair={chair}
            day={day}
            slot={slot}
            done={step === "done"}
          />

          <StepTrail steps={steps} currentIndex={currentIndex} />

          <Spotlight stepKey={step}>
            {step === "shop" && (
              <>
                <StepHeading
                  title="Which shop?"
                  hint={`${barber.first_name} works at ${chairs.length} places. Hours and openings are different at each.`}
                />
                <ShopPicker chairs={chairs} onSelect={chooseChair} />
              </>
            )}

            {step === "date" && (
              <>
                <StepHeading
                  title="Pick a day"
                  hint={chair ? `At ${chair.establishment.name}.` : undefined}
                  onBack={needsShopChoice ? backToShop : undefined}
                  backLabel="Change shop"
                />

                {loadingKind === "dates" ? (
                  <Pending label="Loading open days">Finding open days…</Pending>
                ) : datesError ? (
                  <ErrorPanel
                    title="Couldn't load the calendar"
                    body={datesError}
                    onRetry={() => chair && loadDates(chair)}
                  />
                ) : dates && dates.dates.length === 0 ? (
                  <EmptyPanel
                    title="No openings right now"
                    body={`${barber.first_name} has nothing free in the next ${barber.max_advance_days} days for this service. Their other services may have more room.`}
                    action={
                      <Link
                        to={`/book-with/${barber.slug}`}
                        className="mt-1 inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-4 py-2 text-button text-on-primary transition-colors duration-120 ease-standard hover:bg-primary-hover active:bg-primary-active"
                      >
                        See other services
                      </Link>
                    }
                  />
                ) : dates ? (
                  <MonthCalendar
                    available={dates.dates}
                    windowStart={dates.window_start}
                    windowEnd={dates.window_end}
                    today={dates.today}
                    selected={day}
                    onSelect={chooseDay}
                  />
                ) : null}
              </>
            )}

            {step === "time" && day && (
              <>
                <StepHeading
                  title="Pick a time"
                  hint={longDate(day)}
                  onBack={backToDate}
                  backLabel="Change day"
                />

                {notice && (
                  <p
                    role="status"
                    className="mb-4 rounded-md border border-hairline bg-status-pending-tint px-3 py-2 text-body-sm text-status-pending"
                  >
                    {notice}
                  </p>
                )}

                {loadingKind === "times" ? (
                  <Pending label="Loading times">Checking what's open…</Pending>
                ) : timesError ? (
                  <ErrorPanel
                    title="Couldn't load times"
                    body={timesError}
                    onRetry={() => loadTimes(day)}
                  />
                ) : times && times.valid_slots.length === 0 ? (
                  <EmptyPanel
                    title="Nothing open that day"
                    body="That day filled up or the chair is closed. Pick another one — the calendar shows which days still have room."
                    action={
                      <button
                        type="button"
                        onClick={backToDate}
                        className="mt-1 inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-4 py-2 text-button text-on-primary transition-colors duration-120 ease-standard hover:bg-primary-hover active:bg-primary-active"
                      >
                        Pick another day
                      </button>
                    }
                  />
                ) : times ? (
                  <SlotPicker
                    slots={times.valid_slots}
                    timezone={times.timezone}
                    durationMin={service.duration_min}
                    onSelect={setSlot}
                  />
                ) : null}
              </>
            )}

            {step === "details" && slot && target && chair && day && (
              <>
                <StepHeading
                  title="Your details"
                  hint="So the shop knows who's coming."
                  onBack={() => setSlot(null)}
                  backLabel="Change time"
                />

                <DetailsForm
                  fetcher={booking}
                  target={target}
                  startsAt={slot.start_time}
                  values={values}
                  setValues={setValues}
                  submitLabel={barber.auto_accept ? "Book it" : "Request this time"}
                  summary={
                    <ReviewCard
                      service={service}
                      chair={chair}
                      day={day}
                      slot={slot}
                      timezone={times?.timezone ?? chair.establishment.timezone}
                      autoAccept={barber.auto_accept}
                      holdExpiryHours={barber.hold_expiry_hours}
                    />
                  }
                />
              </>
            )}

            {step === "done" && confirmed && chair && (
              <BookingResult
                booking={confirmed}
                barberFirstName={barber.first_name}
                shopName={chair.establishment.name}
                shopSlug={chair.establishment.slug}
              />
            )}
          </Spotlight>
        </Container>
      </main>
    </div>
  );
}

/* --- chrome --------------------------------------------------------------- */

/** Running summary above the spotlight. Flat on purpose — the panel below is
    the page's one lifted surface. */
function FlowHeader({
  barber,
  service,
  chair,
  day,
  slot,
  done,
}: {
  barber: Barber;
  service: Service;
  chair: Chair | null;
  day: string | null;
  slot: ValidSlot | null;
  done: boolean;
}) {
  return (
    <div className="mb-6">
      <Link
        to={`/book-with/${barber.slug}`}
        className="text-body-sm text-primary-text underline decoration-1 underline-offset-4"
      >
        ← {barber.first_name} {barber.last_name}
      </Link>

      <h1 className="mt-3 font-display text-heading-1 text-ink">{service.title}</h1>

      <p className="mt-2 text-body-sm text-ink-secondary">
        <span className="text-ink">{formatPrice(service.price_cents)}</span>
        <span aria-hidden="true"> · </span>
        {formatDuration(service.duration_min)}
      </p>

      {!done && (chair || day || slot) && (
        <ul className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-caption text-ink-muted">
          {chair && (
            <Crumb icon={<IconStorefront className="size-4" />}>
              {chair.establishment.name}
            </Crumb>
          )}
          {day && <Crumb icon={<IconCalendar className="size-4" />}>{shortDate(day)}</Crumb>}
          {slot && chair && (
            <Crumb icon={<IconClock className="size-4" />}>
              {slotTime(slot.start_time, chair.establishment.timezone)}
            </Crumb>
          )}
        </ul>
      )}
    </div>
  );
}

function Crumb({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-1.5">
      <span aria-hidden="true">{icon}</span>
      {children}
    </li>
  );
}

/** What you are about to commit to, restated above the submit button. */
function ReviewCard({
  service,
  chair,
  day,
  slot,
  timezone,
  autoAccept,
  holdExpiryHours,
}: {
  service: Service;
  chair: Chair;
  day: string;
  slot: ValidSlot;
  timezone: string;
  autoAccept: boolean;
  holdExpiryHours: number;
}) {
  return (
    <div className="rounded-lg border border-hairline bg-canvas-soft p-4">
      <p className="text-body-md text-ink">
        {service.title} · {formatDuration(service.duration_min)} ·{" "}
        {formatPrice(service.price_cents)}
      </p>
      <p className="mt-1 text-body-sm text-ink-secondary">
        {longDate(day)} at {slotTime(slot.start_time, timezone)}
      </p>
      <p className="mt-1 text-body-sm text-ink-secondary">{chair.establishment.name}</p>

      {/* Sets the expectation before they commit. A hold that turns out not to
          be a booking is the worst surprise this flow has. */}
      <p className="mt-3 text-caption text-ink-muted">
        {autoAccept
          ? "This time is confirmed as soon as you book."
          : `This sends a request. The slot is held for you for ${holdExpiryHours} hours while it's reviewed.`}
      </p>
    </div>
  );
}

/* --- step 0: shop --------------------------------------------------------- */

/** Only rendered when the barber works at two or more shops. Buttons, not
    links: choosing loads dates into the panel rather than navigating. */
function ShopPicker({
  chairs,
  onSelect,
}: {
  chairs: Chair[];
  onSelect: (chair: Chair) => void;
}) {
  return (
    <ul className="flex flex-col gap-2">
      {chairs.map((chair) => (
        <li key={chair.id}>
          <button
            type="button"
            onClick={() => onSelect(chair)}
            className="flex min-h-11 w-full items-center gap-3 rounded-lg border border-border-input bg-surface p-4 text-left transition-colors duration-120 ease-standard hover:bg-hover-wash active:bg-press-wash"
          >
            <IconStorefront className="size-5 shrink-0 text-ink-muted" />

            <span className="min-w-0 flex-1">
              <span className="block text-body-md text-ink">
                {chair.establishment.name}
              </span>
              <span className="block text-caption text-ink-muted">
                {chair.establishment.city}
              </span>
            </span>

            <IconChevronRight className="size-5 shrink-0 text-ink-faint" />
          </button>
        </li>
      ))}
    </ul>
  );
}

/* --- step 2: time --------------------------------------------------------- */

/** Scrolls inside its own box so the heading and Back stay put with 40 slots.
    Times render in the shop's zone, not the browser's. */
function SlotPicker({
  slots,
  timezone,
  durationMin,
  onSelect,
}: {
  slots: ValidSlot[];
  timezone: string;
  durationMin: number;
  onSelect: (slot: ValidSlot) => void;
}) {
  const groups = groupByPeriod(slots, timezone);

  return (
    <div>
      <div className="max-h-96 overflow-y-auto rounded-md border border-hairline">
        {groups.map(({ period, slots: run }) => (
          <section key={period}>
            <h3 className="sticky top-0 z-10 border-b border-hairline bg-surface px-3 py-2 text-eyebrow uppercase text-ink-muted">
              {period}
            </h3>

            <div className="grid grid-cols-3 gap-2 p-3 sm:grid-cols-4">
              {run.map((slot) => (
                <button
                  key={slot.start_time}
                  type="button"
                  onClick={() => onSelect(slot)}
                  className="inline-flex min-h-11 items-center justify-center rounded-md border border-border-input bg-surface px-2 py-2 text-body-sm text-ink transition-colors duration-120 ease-standard hover:bg-hover-wash active:bg-press-wash"
                >
                  {slotTime(slot.start_time, timezone)}
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>

      <p className="mt-3 text-caption text-ink-muted">
        {slots.length} {slots.length === 1 ? "opening" : "openings"} · each appointment
        runs {durationMin} minutes · times shown in shop local time
      </p>
    </div>
  );
}

/* --- confirmation --------------------------------------------------------- */

/**
 * Rendered from the POST response, never re-fetched: `anon` has no SELECT
 * policy on `appointment`. Copy forks on status because "you're booked" and
 * "you're holding a request" are different promises.
 */
function BookingResult({
  booking,
  barberFirstName,
  shopName,
  shopSlug,
}: {
  booking: BookingConfirmation;
  barberFirstName: string;
  shopName: string;
  shopSlug: string;
}) {
  const accepted = booking.status === "ACCEPTED";
  // Title, price, timezone and the day all come off the saved row rather than
  // flow state — the appointment snapshots its service at booking time, and
  // that snapshot is what the client was actually quoted.
  const day = ymdIn(booking.starts_at, booking.timezone);

  return (
    <div>
      <div className="flex flex-col items-start gap-4">
        <span
          className={`grid size-12 place-items-center rounded-lg ${
            accepted
              ? "bg-status-accepted-tint text-status-accepted"
              : "bg-status-pending-tint text-status-pending"
          }`}
          aria-hidden="true"
        >
          {accepted ? <IconCheck className="size-6" /> : <IconClock className="size-6" />}
        </span>

        {/* The chip carries its own label — a status told by colour alone is a
            bug, and accepted/rejected are a deuteranopia confusion pair. */}
        <span
          className={`rounded-sm px-2 py-1 text-eyebrow uppercase ${
            accepted
              ? "bg-status-accepted-tint text-status-accepted"
              : "bg-status-pending-tint text-status-pending"
          }`}
        >
          {accepted ? "Accepted" : "Pending"}
        </span>

        <h2 className="text-heading-2 text-ink">
          {accepted ? "You're booked." : "Request sent."}
        </h2>

        <p className="text-body-md text-ink-secondary">
          {accepted ? (
            <>
              {barberFirstName} has you down for {booking.service_title}. See you at{" "}
              {shopName}.
            </>
          ) : (
            <>
              {barberFirstName} still has to confirm this one. The slot is held for you
              {booking.hold_expires_at && (
                <> until {deadline(booking.hold_expires_at, booking.timezone)}</>
              )}
              , and you'll hear back before then.
            </>
          )}
        </p>
      </div>

      <dl className="mt-6 divide-y divide-hairline rounded-lg border border-hairline">
        <ResultRow
          icon={<IconCalendar className="size-5" />}
          label="When"
          value={`${longDate(day)}, ${slotRange(booking.starts_at, booking.ends_at, booking.timezone)}`}
        />
        <ResultRow
          icon={<IconStorefront className="size-5" />}
          label="Where"
          value={shopName}
        />
        <ResultRow
          icon={<IconCheck className="size-5" />}
          label="What"
          value={`${booking.service_title} · ${formatPrice(booking.price_cents)}`}
        />
      </dl>

      <p className="mt-4 text-caption text-ink-muted">
        Reference {booking.id.slice(0, 8)} · times shown in shop local time
      </p>

      <Link
        to={`/establishments/${shopSlug}`}
        className="mt-6 inline-flex min-h-11 items-center justify-center rounded-md border border-border-input bg-surface px-4 py-2 text-button text-ink transition-colors duration-120 ease-standard hover:bg-hover-wash active:bg-press-wash"
      >
        Back to {shopName}
      </Link>
    </div>
  );
}

function ResultRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-3 p-4">
      <span className="mt-0.5 shrink-0 text-ink-muted" aria-hidden="true">
        {icon}
      </span>
      <div className="min-w-0">
        <dt className="text-eyebrow uppercase text-ink-muted">{label}</dt>
        <dd className="mt-0.5 text-body-md text-ink">{value}</dd>
      </div>
    </div>
  );
}
