import { Link } from "react-router";
import type { AppointmentBooked } from "~/models/bookingFlow";
import { CARD, LONG_DAY, TIME, fmtInstant } from "./shared";

/* What got saved. Keyed off status: ACCEPTED is a booking, PENDING is a hold
   the worker has until hold_expires_at to answer. Everything shown here came
   back from the server, nothing is echoed from the form. */

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export function Confirmation({
  booked,
  workerName,
  workerSlug,
}: {
  booked: AppointmentBooked;
  workerName: string;
  workerSlug: string;
}) {
  const pending = booked.status === "PENDING";
  const tz = booked.timezone;

  const rows = [
    ["Service", booked.service_title],
    ["Day", fmtInstant(booked.starts_at, tz, LONG_DAY)],
    ["Time", `${fmtInstant(booked.starts_at, tz, TIME)} to ${fmtInstant(booked.ends_at, tz, TIME)}`],
    ["Price", money.format(booked.price_cents / 100)],
  ];

  return (
    <div className={`${CARD} p-6`}>
      <span
        className={`inline-block rounded-sm px-2 py-1 text-eyebrow ${
          pending ? "bg-status-pending-tint text-status-pending" : "bg-status-accepted-tint text-status-accepted"
        }`}
      >
        {pending ? "Pending" : "Booked"}
      </span>

      <h2 className="mt-3 text-heading-2 text-ink">{pending ? "Request sent" : "You're booked"}</h2>
      <p className="mt-2 text-body-sm text-ink-muted">
        {pending && booked.hold_expires_at
          ? `${workerName} has until ${fmtInstant(booked.hold_expires_at, tz, { month: "short", day: "numeric", ...TIME })} to confirm.`
          : "Your appointment is confirmed."}
      </p>

      <dl className="mt-6 grid gap-2 text-body-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-4">
            <dt className="text-ink-muted">{label}</dt>
            <dd className="text-right text-ink">{value}</dd>
          </div>
        ))}
      </dl>

      <Link
        to={`/view-services/${workerSlug}`}
        className="mt-6 inline-flex min-h-11 w-full items-center justify-center rounded-md border border-border-input bg-surface px-4 py-2 text-button text-ink transition-colors duration-120 ease-standard hover:bg-hover-wash active:bg-press-wash"
      >
        Back to {workerName}
      </Link>
    </div>
  );
}
