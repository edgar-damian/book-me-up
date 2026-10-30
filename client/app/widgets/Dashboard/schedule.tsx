import { useState } from "react";
import { Form } from "react-router";
import { Input, toClock, toMinutes } from "~/widgets/kit";
import type { MyChair } from "~/models/dashboard";

/* A chair's week: a switch for each day, and the hours of the days switched
   on. Times are the shop's local time, sent as minutes after midnight. There
   is no submit button here: any button with form={HOURS_FORM}, like the
   wizard's Next, submits it. */

export const HOURS_FORM = "worker-hours";

// Sunday first, like the booking calendar and the database's day_of_week.
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// Every time field of one day, in the order they appear.
const TIMES = ["start", "end", "break-start", "break-end"] as const;

// The checkbox itself is hidden, so the track beside it shows the state and
// takes the focus ring the checkbox would have drawn.
const TRACK =
  "relative h-6 w-11 shrink-0 rounded-pill bg-border-input transition-colors duration-120 ease-standard " +
  "peer-checked:bg-primary peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 " +
  "peer-focus-visible:outline-focus-ring after:absolute after:top-0.5 after:left-0.5 after:size-5 " +
  "after:rounded-pill after:bg-surface after:transition-transform after:duration-120 " +
  "after:ease-standard peer-checked:after:translate-x-5";

type Errors = Partial<Record<string, string>>;

/** What is wrong with one open day's times, keyed by field name. */
function check(form: HTMLFormElement, d: number): Errors {
  const value = (field: string) => (form.elements.namedItem(`${field}-${d}`) as HTMLInputElement).value;
  const start = toMinutes(value("start"));
  const end = toMinutes(value("end"), true);
  const found: Errors = {};
  if (start === null) found[`start-${d}`] = "Enter a start time";
  if (end === null) found[`end-${d}`] = "Enter an end time";
  else if (start !== null && end <= start) found[`end-${d}`] = "End after the start";

  if (value("break-start") || value("break-end")) {
    const breakStart = toMinutes(value("break-start"));
    const breakEnd = toMinutes(value("break-end"));
    if (breakStart === null) found[`break-start-${d}`] = "Enter both break times";
    else if (breakEnd === null) found[`break-end-${d}`] = "Enter both break times";
    else if (breakEnd <= breakStart) found[`break-end-${d}`] = "End the break after it starts";
    else if (start !== null && end !== null && (breakStart < start || breakEnd > end)) {
      found[`break-start-${d}`] = "Keep the break inside your hours";
    }
  }
  return found;
}

export function WorkerHoursForm({
  chair,
  error,
}: {
  /** The chair these hours belong to. */
  chair: MyChair;
  /** Form-level failure from the last submit, shown at the end of the form. */
  error: string | null;
}) {
  const saved = new Map(chair.schedule_days.map((s) => [s.day_of_week, s]));
  const [open, setOpen] = useState(() => DAYS.map((_, d) => saved.has(d)));
  const [errors, setErrors] = useState<Errors>({});
  const [problem, setProblem] = useState<string>();

  function toggle(d: number, on: boolean) {
    setOpen((cur) => cur.map((was, i) => (i === d ? on : was)));
    if (on) setProblem(undefined);
    else setErrors((cur) => ({ ...cur, ...Object.fromEntries(TIMES.map((f) => [`${f}-${d}`, undefined])) }));
  }

  // Clears whatever the day no longer gets wrong, but only flags the field just
  // left, so a break half typed isn't flagged before its end is entered.
  function blur(e: React.FocusEvent<HTMLInputElement>) {
    const name = e.target.name;
    const d = Number(name.slice(name.lastIndexOf("-") + 1));
    const found = check(e.target.form!, d);
    setErrors((cur) => {
      const next = { ...cur };
      for (const field of TIMES) if (!found[`${field}-${d}`]) next[`${field}-${d}`] = undefined;
      next[name] = found[name];
      return next;
    });
  }

  function submit(e: React.SubmitEvent<HTMLFormElement>) {
    const form = e.currentTarget;
    if (!open.some(Boolean)) {
      e.preventDefault();
      setProblem("Turn on at least one day you work.");
      return;
    }
    const found: Errors = {};
    open.forEach((on, d) => on && Object.assign(found, check(form, d)));
    setErrors(found);
    const first = DAYS.flatMap((_, d) => TIMES.map((f) => `${f}-${d}`)).find((name) => found[name]);
    if (!first) return;
    e.preventDefault();
    (form.elements.namedItem(first) as HTMLInputElement).focus();
  }

  return (
    <Form id={HOURS_FORM} method="post" noValidate onSubmit={submit} className="grid gap-4 text-body-sm">
      <input type="hidden" name="intent" value={HOURS_FORM} />
      <input type="hidden" name="chair" value={chair.id} />
      <p className="text-ink-secondary">
        Your hours at {chair.shop.name}. Times are the shop's local time.
      </p>

      <div className="divide-y divide-hairline">
        {DAYS.map((day, d) => {
          const s = saved.get(d);
          const time = (minutes: number | null | undefined, fallback: string) =>
            minutes === null || minutes === undefined ? fallback : toClock(minutes);
          return (
            <fieldset key={day} className="min-w-0 py-2">
              <legend className="sr-only">{day}</legend>
              <label className="flex min-h-11 cursor-pointer items-center justify-between gap-3">
                <span className="text-ink">{day}</span>
                <input
                  type="checkbox"
                  role="switch"
                  name={`open-${d}`}
                  checked={open[d]}
                  onChange={(e) => toggle(d, e.target.checked)}
                  className="peer sr-only"
                />
                <span aria-hidden="true" className={TRACK} />
              </label>

              {open[d] && (
                <div className="grid grid-cols-2 gap-3 pt-1 pb-2">
                  <Input
                    type="time"
                    name={`start-${d}`}
                    label="Start"
                    defaultValue={time(s?.start_minute, "09:00")}
                    required
                    onBlur={blur}
                    error={errors[`start-${d}`]}
                  />
                  <Input
                    type="time"
                    name={`end-${d}`}
                    label="End"
                    defaultValue={time(s?.end_minute, "17:00")}
                    required
                    onBlur={blur}
                    error={errors[`end-${d}`]}
                  />
                  <p className="col-span-2 text-caption text-ink-muted">Break, if you take one</p>
                  <Input
                    type="time"
                    name={`break-start-${d}`}
                    label="Break start"
                    defaultValue={time(s?.break_start_minute, "")}
                    onBlur={blur}
                    error={errors[`break-start-${d}`]}
                  />
                  <Input
                    type="time"
                    name={`break-end-${d}`}
                    label="Break end"
                    defaultValue={time(s?.break_end_minute, "")}
                    onBlur={blur}
                    error={errors[`break-end-${d}`]}
                  />
                </div>
              )}
            </fieldset>
          );
        })}
      </div>

      {(problem ?? error) && (
        <p role="alert" className="text-danger-text">
          {problem ?? error}
        </p>
      )}
    </Form>
  );
}
