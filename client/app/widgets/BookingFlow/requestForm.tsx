import { useState } from "react";
import { Form } from "react-router";
import { Spinner } from "~/widgets/kit";
import type { ValidSlot } from "~/models/bookingFlow";
import { BackButton, CARD, TIME, fmtInstant } from "./shared";

/* Step 3 of the booking flow: who is coming. The server scrubs every string
   again and re-derives the slot, so this form only has to be kind: catch the
   empty and the malformed before a round trip, and never lose what was typed.
   Inputs stay uncontrolled; only the errors are state. */

type Field = "first_name" | "last_name" | "phone";
type Errors = Partial<Record<Field, string>>;

const FIELD = "w-full min-h-11 rounded-xs border bg-surface px-3 py-2 text-ink placeholder:text-ink-muted";

/** What people type, as E.164. Ten digits with no country code are read as US. */
function toE164(raw: string) {
  const digits = raw.replace(/\D/g, "");
  const full = raw.trim().startsWith("+")
    ? digits
    : digits.length === 10
      ? `1${digits}`
      : digits.length === 11 && digits.startsWith("1")
        ? digits
        : "";
  return /^[1-9]\d{1,14}$/.test(full) ? `+${full}` : null;
}

function check(name: Field, value: string) {
  if (name === "phone") return toE164(value) ? undefined : "Enter a phone number with area code";
  if (value.trim()) return undefined;
  return name === "first_name" ? "Enter your first name" : "Enter your last name";
}

function Input({
  name,
  label,
  error,
  help,
  ...rest
}: React.InputHTMLAttributes<HTMLInputElement> & {
  name: string;
  label: string;
  error?: string;
  help?: string;
}) {
  const note = error ? `${name}-error` : help ? `${name}-help` : undefined;
  return (
    <div>
      <label htmlFor={name} className="mb-1 block text-ink-secondary">
        {label}
      </label>
      <input
        id={name}
        name={name}
        aria-invalid={error ? true : undefined}
        aria-describedby={note}
        className={`${FIELD} ${error ? "border-danger-text" : "border-border-input"}`}
        {...rest}
      />
      {error ? (
        <p id={note} className="mt-1 text-caption text-danger-text">{error}</p>
      ) : help ? (
        <p id={note} className="mt-1 text-caption text-ink-muted">{help}</p>
      ) : null}
    </div>
  );
}

export function RequestForm({
  slot,
  timezone,
  error,
  busy,
  onBack,
}: {
  slot: ValidSlot;
  timezone: string;
  /** Form-level failure from the last submit, shown above the button. */
  error: string | null;
  busy: boolean;
  onBack: () => void;
}) {
  const [errors, setErrors] = useState<Errors>({});

  // Validate on blur and on submit, never per keystroke. A valid phone is
  // rewritten in place so what is posted is exactly what is shown.
  function blur(e: React.FocusEvent<HTMLInputElement>) {
    const name = e.target.name as Field;
    const value = e.target.value;
    if (name === "phone" && toE164(value)) e.target.value = toE164(value)!;
    setErrors((cur) => ({ ...cur, [name]: check(name, value) }));
  }

  function submit(e: React.FormEvent<HTMLFormElement>) {
    const form = e.currentTarget;
    const next: Errors = {};
    for (const name of ["first_name", "last_name", "phone"] as const) {
      const input = form.elements.namedItem(name) as HTMLInputElement;
      if (name === "phone" && toE164(input.value)) input.value = toE164(input.value)!;
      const problem = check(name, input.value);
      if (problem) next[name] = problem;
    }
    setErrors(next);
    if (Object.keys(next).length === 0) return;
    e.preventDefault();
    (form.elements.namedItem(Object.keys(next)[0]) as HTMLInputElement).focus();
  }

  const when =
    fmtInstant(slot.start_time, timezone, { weekday: "short", month: "short", day: "numeric" }) +
    " at " +
    fmtInstant(slot.start_time, timezone, TIME);

  return (
    <div className={`${CARD} p-4`}>
      <div className="flex items-center gap-2">
        <BackButton label="Back to times" onClick={onBack} />
        <h2 className="text-heading-3 text-ink">{when}</h2>
      </div>

      <Form method="post" noValidate onSubmit={submit} className="mt-4 grid gap-4 text-body-sm">
        <input type="hidden" name="starts_at" value={slot.start_time} />

        <div className="grid gap-4 sm:grid-cols-2">
          <Input name="first_name" label="First name" autoComplete="given-name" required onBlur={blur} error={errors.first_name} />
          <Input name="last_name" label="Last name" autoComplete="family-name" required onBlur={blur} error={errors.last_name} />
        </div>
        <Input
          name="phone"
          label="Phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          required
          onBlur={blur}
          error={errors.phone}
          help="We'll text you about this appointment"
        />
        <Input name="email" label="Email (optional)" type="email" autoComplete="email" />
        <div>
          <label htmlFor="notes" className="mb-1 block text-ink-secondary">
            Notes (optional)
          </label>
          <textarea id="notes" name="notes" rows={3} maxLength={1000} className={`${FIELD} border-border-input`} />
        </div>

        {error && (
          <p role="alert" className="text-danger-text">
            {error}
          </p>
        )}

        <button
          type="submit"
          aria-busy={busy || undefined}
          className={`inline-flex min-h-11 w-full items-center justify-center rounded-md bg-primary px-4 py-2 text-button text-on-primary transition-colors duration-120 ease-standard hover:bg-primary-hover active:bg-primary-active ${
            busy ? "pointer-events-none" : ""
          }`}
        >
          {busy ? <Spinner label="Sending your request" /> : "Request appointment"}
        </button>
      </Form>
    </div>
  );
}
