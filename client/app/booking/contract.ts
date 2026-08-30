/** Shapes the booking flow exchanges with FastAPI, and the endpoint URLs.
    snake_case because that is what FastAPI sends — no alias generator.
    Types only, so this is safe to import from client components. */

/* --- responses ------------------------------------------------------------ */

export type DatesAvailable = {
  /** IANA zone of the establishment. Slots render in this, not the browser's. */
  timezone: string;
  window_start: string;
  window_end: string;
  /** YYYY-MM-DD. Empty is a valid 200 — fully booked. */
  dates: string[];
};

export type ValidSlot = {
  /** UTC instant, posted back verbatim — this is a slot's identity. */
  start_time: string;
  end_time: string;
};

export type TimesAvailable = {
  timezone: string;
  /** Named `day_chose` on the server; kept verbatim. */
  day_chose: string;
  valid_slots: ValidSlot[];
};

/** What a brand new booking can be. Narrower than the six-value column enum —
    the create endpoint only ever returns these two. */
export type BookingStatus = "PENDING" | "ACCEPTED";

/** AppointmentBooked. `anon` has no SELECT policy on `appointment`, so this is
    the only time the client sees any of it — including the title and price,
    which the row snapshots at booking time. */
export type BookingConfirmation = {
  id: string;
  status: BookingStatus;
  timezone: string;
  starts_at: string;
  /** Client-facing end, no buffer. */
  ends_at: string;
  service_title: string;
  price_cents: number;
  /** Only set while PENDING. */
  hold_expires_at: string | null;
};

/** BookAppointment. `client` is nested; `notes` is a sibling of it, not a
    member, and the three ids travel in the body rather than the URL. */
export type BookingRequest = {
  client: {
    first_name: string;
    last_name: string;
    /** E.164. The server re-checks it with a Pydantic pattern. */
    phone: string;
    email: string | null;
  };
  starts_at: string;
  notes: string | null;
  service_id: string;
  worker_id: string;
  establishment_id: string;
};

/* --- our own resource route ----------------------------------------------- */

/** `today` is stamped server-side and carried as data — computing it in render
    would differ between SSR and hydration. */
type Availability<T> = T & { today: string };

export type AvailabilityDates = Availability<DatesAvailable>;
export type AvailabilityTimes = Availability<TimesAvailable>;

/** Discriminated so one shared fetcher can carry either read. */
export type AvailabilityResult =
  | { kind: "dates"; ok: true; data: AvailabilityDates }
  | { kind: "times"; ok: true; data: AvailabilityTimes }
  | { kind: "dates" | "times"; ok: false; message: string };

/** Every way the create POST can land, flattened for the form. */
export type BookingActionData =
  | { ok: true; booking: BookingConfirmation }
  /** 409 — someone took the slot mid-form. */
  | { ok: false; kind: "slot_taken" }
  | { ok: false; kind: "fields"; fields: Record<string, string> }
  | { ok: false; kind: "error"; message: string };

/* --- endpoints ------------------------------------------------------------ */

export type BookingTarget = {
  establishmentId: string;
  workerId: string;
  serviceId: string;
};

function targetPath({ establishmentId, workerId, serviceId }: BookingTarget) {
  return `/booking/establishment/${establishmentId}/worker/${workerId}/service/${serviceId}`;
}

export function datesUrl(base: string, target: BookingTarget) {
  return `${base}${targetPath(target)}/dates`;
}

export function timesUrl(base: string, target: BookingTarget, day: string) {
  return `${base}${targetPath(target)}/times?day=${encodeURIComponent(day)}`;
}

/** No path params here — unlike the two reads, the ids ride in the body. */
export function createUrl(base: string) {
  return `${base}/booking/appointments`;
}

/** Availability goes through our resource route, not FastAPI directly:
    API_URL has no VITE_ prefix, so it does not exist in the browser. */
export function availabilityHref(
  kind: "dates" | "times",
  target: BookingTarget,
  day?: string,
) {
  const params = new URLSearchParams({
    kind,
    e: target.establishmentId,
    w: target.workerId,
    s: target.serviceId,
  });
  if (day) params.set("day", day);
  return `/api/booking/availability?${params}`;
}
