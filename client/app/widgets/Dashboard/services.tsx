import { useEffect, useRef, useState } from "react";
import { Form } from "react-router";
import { FIELD, Input, toCents } from "~/widgets/kit";
import type { MyService } from "~/models/dashboard";

/* The worker's menu as a list. One service is open as a form at a time; the
   rest are collapsed rows with Edit and Delete. Every row's fields stay in the
   page, only hidden while collapsed, so collapsing never loses what was typed
   and Next posts the whole list. Nothing is saved before then. There is no
   submit button here: any button with form={SERVICES_FORM}, like the wizard's
   Next, submits it. */

export const SERVICES_FORM = "worker-services";

const ADD_MORE = `${SERVICES_FORM}-add`;

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

const ROW_BUTTON =
  "inline-flex min-h-11 items-center justify-center rounded-md px-3 text-button " +
  "transition-colors duration-120 ease-standard hover:bg-hover-wash active:bg-press-wash";

// In the order they appear, so a failed check focuses the topmost problem.
const FIELDS = ["title", "price", "duration", "buffer"] as const;

type Row = { key: string; id: string | null; open: boolean; title: string; caption: string };
type Errors = Partial<Record<string, string>>;

const blankRow = (key: string): Row => ({ key, id: null, open: true, title: "", caption: "" });

const captionOf = (cents: number | null, minutes: number) =>
  cents === null ? "" : `${money.format(cents / 100)} · ${minutes} min`;

const withoutRow = (errors: Errors, key: string): Errors => ({
  ...errors,
  ...Object.fromEntries(FIELDS.map((f) => [`${f}-${key}`, undefined])),
});

export function ServicesForm({
  services,
  error,
}: {
  /** What the worker already offers, oldest first. */
  services: MyService[];
  /** Form-level failure from the last submit, shown at the end of the form. */
  error: string | null;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  // Keys for rows added on this page. The first blank row is new-0 on the
  // server and in the browser alike, so the two renders agree.
  const added = useRef(1);
  const [rows, setRows] = useState<Row[]>(() =>
    services.length
      ? services.map((s) => ({
          key: s.id,
          id: s.id,
          open: false,
          title: s.title,
          caption: captionOf(s.price_cents, s.duration_min),
        }))
      : [blankRow("new-0")],
  );
  const [errors, setErrors] = useState<Errors>({});
  const [focus, setFocus] = useState<{ id: string } | null>(null);

  // Runs after the render that shows the row, so the field is there to focus.
  useEffect(() => {
    if (focus) document.getElementById(focus.id)?.focus();
  }, [focus]);

  const saved = new Map(services.map((s) => [s.id, s]));
  const value = (key: string, field: string) =>
    (formRef.current!.elements.namedItem(`${field}-${key}`) as HTMLInputElement).value;

  // A new row nobody has typed into: skipped on save, dropped rather than collapsed.
  const isBlank = (row: Row) =>
    !row.id && ["title", "price", "duration"].every((f) => !value(row.key, f).trim());

  /** What is wrong with one row, keyed by field name. */
  function check(key: string): Errors {
    const found: Errors = {};
    if (!value(key, "title").trim()) found[`title-${key}`] = "Enter a name";
    const cents = toCents(value(key, "price"));
    if (cents === null || cents > 10_000_000) found[`price-${key}`] = "Enter a price, like 35 or 35.50";
    const duration = Number(value(key, "duration"));
    if (!Number.isInteger(duration) || duration < 1 || duration > 1440) {
      found[`duration-${key}`] = "Enter how many minutes it takes";
    }
    const buffer = Number(value(key, "buffer") || 0);
    if (!Number.isInteger(buffer) || buffer < 0 || buffer > 480) {
      found[`buffer-${key}`] = "Enter 0 to 480 minutes";
    }
    return found;
  }

  /** The row collapsed to its name and price, read from what was typed. */
  function collapse(row: Row): Row {
    const caption = captionOf(toCents(value(row.key, "price")), Number(value(row.key, "duration")));
    return { ...row, open: false, title: value(row.key, "title").trim(), caption };
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
    if (row && isBlank(row)) return setFocus({ id: `title-${row.key}` });
    const closed = closeOpen();
    if (!closed) return;
    const key = `new-${added.current++}`;
    setRows([...closed, blankRow(key)]);
    setFocus({ id: `title-${key}` });
  }

  function edit(key: string) {
    const closed = closeOpen();
    if (!closed) return;
    setRows(closed.map((r) => (r.key === key ? { ...r, open: true } : r)));
    setFocus({ id: `title-${key}` });
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
    setFocus({ id: `title-${fresh}` });
  }

  // Only flags the field just left, and not on a row nobody has typed into yet.
  function blur(e: React.FocusEvent<HTMLInputElement>) {
    const name = e.target.name;
    const row = rows.find((r) => r.key === name.slice(name.indexOf("-") + 1));
    if (!row || isBlank(row)) return;
    const found = check(row.key);
    setErrors((cur) => ({ ...cur, [name]: found[name] }));
  }

  function submit(e: React.SubmitEvent<HTMLFormElement>) {
    const typed = rows.filter((r) => !isBlank(r));
    // With nothing typed at all, the blank row is what has to be filled in.
    const checked = typed.length ? typed : rows.slice(0, 1);
    const found: Errors = {};
    for (const row of checked) Object.assign(found, check(row.key));
    setErrors(found);
    const bad = checked.find((row) => FIELDS.some((f) => found[`${f}-${row.key}`]));
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
      id={SERVICES_FORM}
      method="post"
      noValidate
      onSubmit={submit}
      className="grid gap-3 text-body-sm"
    >
      <input type="hidden" name="intent" value={SERVICES_FORM} />
      <p className="text-ink-secondary">Add each service you offer. Clients book these from your page.</p>

      {rows.map((row) => {
        const s = row.id ? saved.get(row.id) : undefined;
        return (
          <div key={row.key} className="rounded-md border border-hairline">
            <input type="hidden" name="service" value={row.key} />
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
              <Input
                name={`title-${row.key}`}
                label="Name"
                defaultValue={s?.title}
                maxLength={100}
                required
                onBlur={blur}
                error={errors[`title-${row.key}`]}
              />
              <div>
                <label htmlFor={`description-${row.key}`} className="mb-1 block text-ink-secondary">
                  Description (optional)
                </label>
                <textarea
                  id={`description-${row.key}`}
                  name={`description-${row.key}`}
                  rows={2}
                  maxLength={1000}
                  defaultValue={s?.description}
                  className={`${FIELD} border-border-input`}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Input
                  name={`price-${row.key}`}
                  label="Price ($)"
                  inputMode="decimal"
                  defaultValue={s ? (s.price_cents / 100).toFixed(2) : ""}
                  required
                  onBlur={blur}
                  error={errors[`price-${row.key}`]}
                />
                <Input
                  name={`duration-${row.key}`}
                  label="Duration (min)"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={1440}
                  defaultValue={s?.duration_min}
                  required
                  onBlur={blur}
                  error={errors[`duration-${row.key}`]}
                />
              </div>
              <Input
                name={`buffer-${row.key}`}
                label="Cleanup after (min)"
                type="number"
                inputMode="numeric"
                min={0}
                max={480}
                defaultValue={s?.buffer_after_min ?? 0}
                onBlur={blur}
                error={errors[`buffer-${row.key}`]}
                help="Time kept free after each appointment. Clients don't see it."
              />
              {(row.id || rows.length > 1) && (
                <button
                  type="button"
                  onClick={() => remove(row.key)}
                  aria-label="Delete this service"
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
        Add more
      </button>

      {error && (
        <p role="alert" className="text-danger-text">
          {error}
        </p>
      )}
    </Form>
  );
}
