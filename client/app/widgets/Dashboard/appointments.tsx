import { useState } from "react";
import { useFetcher } from "react-router";
import type { AppointmentStatus, MyAppointment, MyDay, MyWeek } from "~/models/dashboard";
import { LONG_DAY, TIME, fmtDay, fmtInstant } from "~/widgets/BookingFlow/shared";
import { Spinner } from "~/widgets/kit";

/* The worker's next seven days at one shop, a card per day. Every time is put on
   the shop's clock, so the server render and hydration agree wherever each runs. */

export const ANSWER_FORM = "answer-request";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

// Whole class strings, so Tailwind finds each one.
const STATUS: Record<AppointmentStatus, { label: string; chip: string }> = {
  PENDING: { label: "Pending", chip: "bg-status-pending-tint text-status-pending" },
  ACCEPTED: { label: "Accepted", chip: "bg-status-accepted-tint text-status-accepted" },
  REJECTED: { label: "Rejected", chip: "bg-status-rejected-tint text-status-rejected" },
  CANCELLED: { label: "Cancelled", chip: "bg-status-cancelled-tint text-status-cancelled" },
  COMPLETED: { label: "Completed", chip: "bg-status-completed-tint text-status-completed" },
  NO_SHOW: { label: "No-show", chip: "bg-status-no-show-tint text-status-no-show" },
};

// Column widths from md up, shared by the label row and each booking so they line up.
const TIME_COL = "md:w-28 md:shrink-0";
const WHO_COL = "md:min-w-0 md:flex-1 md:pr-4";
const PRICE_COL = "md:w-24 md:shrink-0";
const STATUS_COL = "md:w-28 md:shrink-0";
const ACTIONS_COL = "md:w-60 md:shrink-0";

const BUTTON =
  "inline-flex min-h-11 items-center justify-center rounded-md px-4 text-button " +
  "transition-colors duration-120 ease-standard disabled:pointer-events-none disabled:opacity-50";
const ACCEPT = `${BUTTON} bg-primary text-on-primary hover:bg-primary-hover active:bg-primary-active`;
const REJECT = `${BUTTON} border border-border-input bg-surface text-ink hover:bg-hover-wash active:bg-press-wash`;
const CONFIRM = `${BUTTON} bg-danger text-on-danger hover:bg-danger-hover active:bg-danger-active`;

/** A button's text, kept in place but hidden while a spinner stands in, so the button keeps its width. */
function Label({ text, sending, status }: { text: string; sending: boolean; status: string }) {
  return (
    <>
      <span className={sending ? "invisible" : undefined}>{text}</span>
      {sending && <Spinner label={status} className="absolute size-4" />}
    </>
  );
}

/** One booking: a two-column block on a phone, one line of the table from md up. */
function Booking({ appointment: a, timezone }: { appointment: MyAppointment; timezone: string }) {
  const time = fmtInstant(a.starts_at, timezone, TIME);
  const { label, chip } = STATUS[a.status];
  // Held by the row, not its buttons, so a refusal still shows once the row reloads with another status.
  const answer = useFetcher<{ error: string | null }>();
  const sending = answer.state === "idle" ? null : answer.formData?.get("status");
  // "kept" is the first pair again, with focus back on Reject.
  const [step, setStep] = useState<"answer" | "confirm" | "kept">("answer");

  return (
    <li className="grid grid-cols-2 gap-x-4 gap-y-3 px-4 py-4 md:flex md:flex-wrap md:items-center md:gap-0 md:px-6 md:py-3">
      <div className={`col-start-1 row-start-1 ${TIME_COL}`}>
        <p className="text-body-sm font-medium text-ink tabular-nums">{time}</p>
        <p className="text-caption text-ink-muted">{a.duration_min} min</p>
      </div>
      <div className={`col-start-1 row-start-2 min-w-0 break-words ${WHO_COL}`}>
        <p className="text-body-sm font-medium text-ink">{a.client_name}</p>
        <p className="text-caption text-ink-muted">{a.service_title}</p>
      </div>
      <p className={`col-start-2 row-start-2 justify-self-end text-body-sm font-medium text-ink tabular-nums ${PRICE_COL}`}>
        {money.format(a.price_cents / 100)}
      </p>
      <div className={`col-start-2 row-start-1 justify-self-end ${STATUS_COL}`}>
        <span className={`inline-block rounded-sm px-2 py-1 text-eyebrow ${chip}`}>{label}</span>
      </div>
      {a.status === "PENDING" ? (
        <answer.Form
          method="post"
          className={`col-span-2 grid grid-cols-2 gap-2 md:flex md:justify-end ${ACTIONS_COL}`}
        >
          <input type="hidden" name="intent" value={ANSWER_FORM} />
          <input type="hidden" name="appointment" value={a.id} />
          {/* Keyed, so each pair mounts fresh and autoFocus lands; nothing is focused on the first render. */}
          {step === "confirm" ? (
            <>
              <button
                key="keep"
                type="button"
                autoFocus
                disabled={!!sending}
                onClick={() => setStep("kept")}
                aria-label={`Keep request from ${a.client_name} at ${time}`}
                className={REJECT}
              >
                Keep
              </button>
              <button
                key="reject-request"
                type="submit"
                name="status"
                value="REJECTED"
                aria-busy={sending === "REJECTED" || undefined}
                aria-label={`Reject request from ${a.client_name} at ${time}`}
                className={`relative ${CONFIRM} ${sending ? "pointer-events-none" : ""}`}
              >
                <Label text="Reject request" sending={sending === "REJECTED"} status="Rejecting…" />
              </button>
            </>
          ) : (
            <>
              <button
                key="accept"
                type="submit"
                name="status"
                value="ACCEPTED"
                aria-busy={sending === "ACCEPTED" || undefined}
                aria-label={`Accept ${a.client_name} at ${time}`}
                className={`relative ${ACCEPT} ${sending ? "pointer-events-none" : ""}`}
              >
                <Label text="Accept" sending={sending === "ACCEPTED"} status="Accepting…" />
              </button>
              <button
                key="reject"
                type="button"
                autoFocus={step === "kept"}
                disabled={!!sending}
                onClick={() => setStep("confirm")}
                aria-label={`Reject ${a.client_name} at ${time}`}
                className={REJECT}
              >
                Reject
              </button>
            </>
          )}
        </answer.Form>
      ) : (
        <div className={`hidden md:block ${ACTIONS_COL}`} />
      )}
      {answer.data?.error && (
        <p role="alert" className="col-span-2 text-body-sm text-danger-text md:basis-full md:pt-2 md:text-right">
          {answer.data.error}
        </p>
      )}
    </li>
  );
}

/** One day's card. The first two days are named Today and Tomorrow. */
function DayCard({ day, index, timezone }: { day: MyDay; index: number; timezone: string }) {
  const title = index === 0 ? "Today" : index === 1 ? "Tomorrow" : fmtDay(day.day, { weekday: "long" });
  const date = fmtDay(day.day, index < 2 ? LONG_DAY : { month: "long", day: "numeric" });
  const count = day.appointments.length;
  const empty = day.day_off ? "Day off" : index === 0 ? "No appointments today yet" : "No appointments yet";

  return (
    <section className="overflow-hidden rounded-lg border border-hairline bg-surface">
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-4 md:px-6">
        <h2 className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-title text-ink">{title}</span>{" "}
          <span className="text-body-sm text-ink-muted">{date}</span>
        </h2>
        {count > 0 && (
          <p className="text-caption text-ink-muted">
            {count} {count === 1 ? "appointment" : "appointments"}
          </p>
        )}
      </header>
      {count > 0 ? (
        <>
          <div
            aria-hidden="true"
            className="hidden border-t border-hairline bg-surface-sunken px-6 py-2 text-eyebrow text-ink-muted md:flex"
          >
            <span className={TIME_COL}>Time</span>
            <span className={WHO_COL}>Client and service</span>
            <span className={PRICE_COL}>Price</span>
            <span className={STATUS_COL}>Status</span>
            <span className={ACTIONS_COL} />
          </div>
          <ol className="divide-y divide-hairline border-t border-hairline">
            {day.appointments.map((a) => (
              <Booking key={a.id} appointment={a} timezone={timezone} />
            ))}
          </ol>
        </>
      ) : (
        <p className="border-t border-hairline px-4 py-4 text-body-sm text-ink-muted md:px-6">{empty}</p>
      )}
    </section>
  );
}

/** The requests still waiting on the worker, then a card per day of the week. */
export function UpcomingWeek({ week }: { week: MyWeek }) {
  const requests = week.days.reduce(
    (n, d) => n + d.appointments.filter((a) => a.status === "PENDING").length,
    0,
  );

  return (
    <>
      {requests > 0 && (
        <p className="mt-1 text-body-sm text-ink-secondary">
          <span className="font-medium text-ink">
            {requests} {requests === 1 ? "request" : "requests"}
          </span>{" "}
          {requests === 1 ? "needs" : "need"} your response.
        </p>
      )}
      <div className="mt-6 grid gap-4 md:gap-6">
        {week.days.map((d, i) => (
          <DayCard key={d.day} day={d} index={i} timezone={week.timezone} />
        ))}
      </div>
    </>
  );
}
