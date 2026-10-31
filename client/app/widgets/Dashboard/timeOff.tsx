import { useEffect, useRef, useState } from "react";
import { Form } from "react-router";
import type { MyChair, MyTimeOff, TimeOffConflict } from "~/models/dashboard";
import { TIME, fmtDay, fmtInstant, utc } from "~/widgets/BookingFlow/shared";
import { STATUS } from "~/widgets/Dashboard/appointments";
import { Input } from "~/widgets/kit";

/* The worker's time off as a list, soonest first. One stretch is open as a form
   at a time; the rest are collapsed rows with Edit and Delete. Every row's
   fields stay in the page, only hidden while collapsed, so Save posts the whole
   list and nothing is saved before then. Days are whole days on the shop's
   calendar, and time off blocks every shop the worker is at. There is no submit
   button here: any button with form={TIME_OFF_FORM} submits it. */

export const TIME_OFF_FORM = "worker-time-off";

const ADD_MORE = `${TIME_OFF_FORM}-add`;

const SHORT_DAY: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric" };

const ROW_BUTTON =
  "inline-flex min-h-11 items-center justify-center rounded-md px-3 text-button " +
  "transition-colors duration-120 ease-standard hover:bg-hover-wash active:bg-press-wash";

// In the order they appear, so a failed check focuses the topmost problem.
const FIELDS = ["first", "last"] as const;

type Row = { key: string; id: string | null; open: boolean; title: string; caption: string };
type Errors = Partial<Record<string, string>>;

const blankRow = (key: string): Row => ({ key, id: null, open: true, title: "", caption: "" });

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Days from first to last, both counted. */
function daysIn(first: string, last: string) {
  const at = (day: string) => {
    const [y, m, d] = day.split("-").map(Number);
    return utc(y, m, d).getTime();
  };
  return Math.round((at(last) - at(first)) / 86_400_000) + 1;
}

const rangeOf = (first: string, last: string) =>
  first === last ? fmtDay(first, SHORT_DAY) : `${fmtDay(first, SHORT_DAY)} – ${fmtDay(last, SHORT_DAY)}`;

function captionOf(first: string, last: string, bookings: number) {
  const days = count(daysIn(first, last), "day", "days");
  return bookings ? `${days} · ${count(bookings, "booking", "bookings")} in it` : days;
}

const withoutRow = (errors: Errors, key: string): Errors => ({
  ...errors,
  ...Object.fromEntries(FIELDS.map((f) => [`${f}-${key}`, undefined])),
});

export function TimeOffForm({
  chair,
  timeOff,
  error,
}: {
  /** The shop whose calendar the days are on. */
  chair: MyChair;
  timeOff: MyTimeOff;
  /** Form-level failure from the last submit, shown at the end of the form. */
  error: string | null;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  // Keys for rows added on this page. The first blank row is new-0 on the
  // server and in the browser alike, so the two renders agree.
  const added = useRef(1);
  const [rows, setRows] = useState<Row[]>(() =>
    timeOff.stretches.length
      ? timeOff.stretches.map((s) => ({
          key: s.id,
          id: s.id,
          open: false,
          title: rangeOf(s.first_day, s.last_day),
          caption: captionOf(s.first_day, s.last_day, s.bookings),
        }))
      : [blankRow("new-0")],
  );
  const [errors, setErrors] = useState<Errors>({});
  const [focus, setFocus] = useState<{ id: string } | null>(null);

  // Runs after the render that shows the row, so the field is there to focus.
  useEffect(() => {
    if (focus) document.getElementById(focus.id)?.focus();
  }, [focus]);

  const saved = new Map(timeOff.stretches.map((s) => [s.id, s]));
  const value = (key: string, field: string) =>
    (formRef.current!.elements.namedItem(`${field}-${key}`) as HTMLInputElement).value;

  // A new row nobody has filled in: skipped on save, dropped rather than collapsed.
  const isBlank = (row: Row) => !row.id && FIELDS.every((f) => !value(row.key, f));

  /** What is wrong with one row, keyed by field name. Days compare as YYYY-MM-DD text. */
  function check(key: string): Errors {
    const first = value(key, "first");
    const last = value(key, "last");
    const found: Errors = {};
    if (!first) found[`first-${key}`] = "Enter your first day off";
    if (!last) found[`last-${key}`] = "Enter your last day off";
    else if (first && last < first) found[`last-${key}`] = "End on or after the first day";
    else if (last < timeOff.today) found[`last-${key}`] = "End today or later";
    return found;
  }

  /** The row collapsed to its days. Its count of bookings only stands while the days are the saved ones. */
  function collapse(row: Row): Row {
    const first = value(row.key, "first");
    const last = value(row.key, "last");
    const s = row.id ? saved.get(row.id) : undefined;
    const bookings = s && s.first_day === first && s.last_day === last ? s.bookings : 0;
    return { ...row, open: false, title: rangeOf(first, last), caption: captionOf(first, last, bookings) };
  }

  /**
   * The rows with the open one closed: a blank new row is dropped and a finished
   * one collapses. null when the open row still has problems, which are shown
   * and focused instead.
   */
  function closeOpen(): Row[] | null {
    const row = rows.find((r) => r.open);
    if (!row) return rows;
    if (isBlank(row)) return rows.filter((r) => r !== row);
    const found = check(row.key);
    setErrors((cur) => ({ ...withoutRow(cur, row.key), ...found }));
    const first = FIELDS.map((f) => `${f}-${row.key}`).find((name) => found[name]);
    if (first) {
      setFocus({ id: first });
      return null;
    }
    return rows.map((r) => (r === row ? collapse(r) : r));
  }

  function addMore() {
    const row = rows.find((r) => r.open);
    if (row && isBlank(row)) return setFocus({ id: `first-${row.key}` });
    const closed = closeOpen();
    if (!closed) return;
    const key = `new-${added.current++}`;
    setRows([...closed, blankRow(key)]);
    setFocus({ id: `first-${key}` });
  }

  function edit(key: string) {
    const closed = closeOpen();
    if (!closed) return;
    setRows(closed.map((r) => (r.key === key ? { ...r, open: true } : r)));
    setFocus({ id: `first-${key}` });
  }

  function remove(key: string) {
    setErrors((cur) => withoutRow(cur, key));
    const left = rows.filter((r) => r.key !== key);
    if (left.length) {
      setRows(left);
      setFocus({ id: ADD_MORE });
      return;
    }
    const fresh = `new-${added.current++}`;
    setRows([blankRow(fresh)]);
    setFocus({ id: `first-${fresh}` });
  }

  // Clears whatever the row no longer gets wrong, but only flags the field just
  // left, and nothing on a row nobody has filled in yet.
  function blur(e: React.FocusEvent<HTMLInputElement>) {
    const name = e.target.name;
    const key = name.slice(name.indexOf("-") + 1);
    const row = rows.find((r) => r.key === key);
    if (!row || isBlank(row)) return;
    const found = check(key);
    setErrors((cur) => {
      const next = { ...cur };
      for (const f of FIELDS) if (!found[`${f}-${key}`]) next[`${f}-${key}`] = undefined;
      next[name] = found[name];
      return next;
    });
  }

  function submit(e: React.SubmitEvent<HTMLFormElement>) {
    const filled = rows.filter((r) => !isBlank(r));
    const found: Errors = {};
    for (const row of filled) Object.assign(found, check(row.key));
    setErrors(found);
    const bad = filled.find((row) => FIELDS.some((f) => found[`${f}-${row.key}`]));
    if (!bad) return;
    e.preventDefault();
    setRows(
      rows
        .filter((r) => r === bad || !isBlank(r))
        .map((r) => (r === bad ? { ...r, open: true } : r.open ? collapse(r) : r)),
    );
    setFocus({ id: FIELDS.map((f) => `${f}-${bad.key}`).find((name) => found[name])! });
  }

  return (
    <Form
      ref={formRef}
      id={TIME_OFF_FORM}
      method="post"
      noValidate
      onSubmit={submit}
      className="grid gap-3 text-body-sm"
    >
      <input type="hidden" name="intent" value={TIME_OFF_FORM} />
      <input type="hidden" name="chair" value={chair.id} />
      <p className="text-ink-secondary">
        Add the days you're away. Clients can't book you on them at any of your shops.
      </p>

      {rows.map((row) => {
        const s = row.id ? saved.get(row.id) : undefined;
        return (
          <div key={row.key} className="rounded-md border border-hairline">
            <input type="hidden" name="stretch" value={row.key} />
            <input type="hidden" name={`id-${row.key}`} value={row.id ?? ""} />

            {!row.open && (
              <div className="flex items-center gap-1 py-1 pr-1 pl-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-ink">{row.title}</p>
                  <p className="text-caption text-ink-muted">{row.caption}</p>
                </div>
                <button
                  type="button"
                  onClick={() => edit(row.key)}
                  aria-label={`Edit ${row.title}`}
                  className={`${ROW_BUTTON} text-ink`}
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => remove(row.key)}
                  aria-label={`Delete ${row.title}`}
                  className={`${ROW_BUTTON} text-danger-text`}
                >
                  Delete
                </button>
              </div>
            )}

            {/* The hidden attribute, not a class: preflight forces it over `grid`,
                and a hidden field still posts with the form. */}
            <div hidden={!row.open} className="grid gap-4 p-4">
              <div className="grid grid-cols-2 gap-3">
                <Input
                  type="date"
                  name={`first-${row.key}`}
                  label="First day off"
                  defaultValue={s?.first_day}
                  required
                  onBlur={blur}
                  error={errors[`first-${row.key}`]}
                />
                <Input
                  type="date"
                  name={`last-${row.key}`}
                  label="Last day off"
                  defaultValue={s?.last_day}
                  min={timeOff.today}
                  required
                  onBlur={blur}
                  error={errors[`last-${row.key}`]}
                />
              </div>
              {(row.id || rows.length > 1) && (
                <button
                  type="button"
                  onClick={() => remove(row.key)}
                  aria-label="Delete this time off"
                  className={`${ROW_BUTTON} justify-self-start text-danger-text`}
                >
                  Delete
                </button>
              )}
            </div>
          </div>
        );
      })}

      <button
        id={ADD_MORE}
        type="button"
        onClick={addMore}
        className="inline-flex min-h-11 w-full items-center justify-center rounded-md border border-border-input bg-surface px-4 py-2 text-button text-ink transition-colors duration-120 ease-standard hover:bg-hover-wash active:bg-press-wash"
      >
        Add time off
      </button>

      {error && (
        <p role="alert" className="text-danger-text">
          {error}
        </p>
      )}
    </Form>
  );
}

/**
 * The bookings that fall in the time off just saved, shown in the dialog in
 * place of the form. Each time is on its own shop's clock, and the shop is
 * named when it isn't the one the dashboard is showing.
 */
export function TimeOffConflicts({
  conflicts,
  chair,
  timezone,
}: {
  conflicts: TimeOffConflict[];
  /** The shop the dashboard is showing. */
  chair: MyChair;
  /** That shop's time zone, for a booking whose shop the worker can no longer see. */
  timezone: string;
}) {
  return (
    <div className="grid gap-4 text-body-sm">
      <p role="alert" className="text-ink">
        Your time off is saved.{" "}
        {conflicts.length === 1 ? "This booking falls" : `These ${conflicts.length} bookings fall`} in it:
      </p>
      <ul className="divide-y divide-hairline rounded-md border border-hairline">
        {conflicts.map((c) => {
          const zone = c.shop?.timezone ?? timezone;
          const elsewhere = c.shop && c.shop.slug !== chair.shop.slug ? c.shop.name : null;
          const { label, chip } = STATUS[c.status];
          return (
            <li key={c.id} className="flex items-start justify-between gap-3 px-3 py-3">
              <div className="min-w-0 break-words">
                <p className="font-medium text-ink">
                  {fmtInstant(c.starts_at, zone, SHORT_DAY)} · {fmtInstant(c.starts_at, zone, TIME)}
                </p>
                <p className="text-caption text-ink-muted">
                  {c.client_name} · {c.service_title}
                  {elsewhere && ` · ${elsewhere}`}
                </p>
              </div>
              <span className={`shrink-0 rounded-sm px-2 py-1 text-eyebrow ${chip}`}>{label}</span>
            </li>
          );
        })}
      </ul>
      <p className="text-ink-secondary">
        Clients aren't told about your time off. Reject the requests you can't take, and reach out about
        the rest.
      </p>
    </div>
  );
}
