/** Step 3: who's coming. Validates on blur and submit (never per keystroke),
    and keeps the submit button enabled so pressing it explains what's missing.
    The visible phone field takes any shape; a hidden field carries E.164. */

import { useRef, useState } from "react";
import type { FetcherWithComponents } from "react-router";
import { Field, Spinner } from "./kit";
import { displayPhone, normalizePhone } from "./format";
import type { BookingActionData, BookingTarget } from "./contract";


export type Values = {
  first_name: string;
  last_name: string;
  phone: string;
  email: string;
  notes: string;
};


export const EMPTY_VALUES: Values = {
  first_name: "",
  last_name: "",
  phone: "",
  email: "",
  notes: "",
};

/** Deliberately loose — the field is optional, and rejecting an unusual but
    valid address costs more than accepting a typo. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validate(values: Values): Record<string, string> {
  const errors: Record<string, string> = {};

  if (values.first_name.trim() === "") errors.first_name = "Enter your first name.";
  if (values.last_name.trim() === "") errors.last_name = "Enter your last name.";

  if (values.phone.trim() === "") {
    errors.phone = "Enter a phone number so the shop can reach you.";
  } else if (normalizePhone(values.phone) === null) {
    errors.phone = "That does not look like a complete number. Include the area code.";
  }

  if (values.email.trim() !== "" && !EMAIL.test(values.email.trim())) {
    errors.email = "Check this email address.";
  }

  return errors;
}

export function DetailsForm({
  fetcher,
  target,
  startsAt,
  submitLabel,
  summary,
  values,
  setValues,
}: {
  fetcher: FetcherWithComponents<BookingActionData>;
  target: BookingTarget;
  /** The chosen slot's start_time, posted back verbatim. */
  startsAt: string;
  submitLabel: string;
  summary: React.ReactNode;
  values: Values;
  setValues: React.Dispatch<React.SetStateAction<Values>>;
}) {
  // Touched and submitted stay local — resetting those on remount is correct.
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [submitted, setSubmitted] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  const isSubmitting = fetcher.state !== "idle";
  const localErrors = validate(values);

  const serverErrors =
    fetcher.data && !fetcher.data.ok && fetcher.data.kind === "fields"
      ? fetcher.data.fields
      : {};

  const formError =
    fetcher.data && !fetcher.data.ok && fetcher.data.kind === "error"
      ? fetcher.data.message
      : null;

  function set<K extends keyof Values>(key: K) {
    return (value: string) => setValues((v) => ({ ...v, [key]: value }));
  }

  function blur(key: keyof Values) {
    return () => setTouched((t) => ({ ...t, [key]: true }));
  }

  function errorFor(key: keyof Values): string | undefined {
    if (serverErrors[key]) return serverErrors[key];
    if (!touched[key] && !submitted) return undefined;
    return localErrors[key];
  }

  function onPhoneBlur() {
    setTouched((t) => ({ ...t, phone: true }));
    const e164 = normalizePhone(values.phone);
    // Echo back what we understood. Only on success — reformatting something
    // unparsed would just scramble what they typed.
    if (e164) setValues((v) => ({ ...v, phone: displayPhone(e164) }));
  }

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    setSubmitted(true);
    if (Object.keys(localErrors).length === 0) return;

    event.preventDefault();
    const first = ["first_name", "last_name", "phone", "email"].find(
      (key) => key in localErrors,
    );
    if (first) {
      formRef.current?.querySelector<HTMLInputElement>(`#booking-${first}`)?.focus();
    }
  }

  return (
    <fetcher.Form ref={formRef} method="post" onSubmit={onSubmit} noValidate>
      {/* In the form rather than the URL, because the flow never changes its URL. */}
      <input type="hidden" name="establishment_id" value={target.establishmentId} />
      <input type="hidden" name="worker_id" value={target.workerId} />
      <input type="hidden" name="service_id" value={target.serviceId} />
      <input type="hidden" name="starts_at" value={startsAt} />
      <input type="hidden" name="phone" value={normalizePhone(values.phone) ?? ""} />

      {summary}

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <Field
          id="booking-first_name"
          name="first_name"
          label="First name"
          value={values.first_name}
          onChange={set("first_name")}
          onBlur={blur("first_name")}
          error={errorFor("first_name")}
          autoComplete="given-name"
          maxLength={100}
        />
        <Field
          id="booking-last_name"
          name="last_name"
          label="Last name"
          value={values.last_name}
          onChange={set("last_name")}
          onBlur={blur("last_name")}
          error={errorFor("last_name")}
          autoComplete="family-name"
          maxLength={100}
        />
      </div>

      <div className="mt-4 grid gap-4">
        <Field
          id="booking-phone"
          // Not `phone` — the hidden field above is what gets submitted.
          name="phone_display"
          label="Phone number"
          type="tel"
          inputMode="tel"
          value={values.phone}
          onChange={set("phone")}
          onBlur={onPhoneBlur}
          error={errorFor("phone")}
          help="US numbers can skip the country code."
          autoComplete="tel"
          maxLength={24}
        />

        <Field
          id="booking-email"
          name="email"
          label="Email"
          type="email"
          inputMode="email"
          optional
          value={values.email}
          onChange={set("email")}
          onBlur={blur("email")}
          error={errorFor("email")}
          help="For a confirmation you can keep."
          autoComplete="email"
          maxLength={254}
        />

        <Field
          id="booking-notes"
          name="notes"
          label="Comments or concerns"
          optional
          multiline
          rows={3}
          value={values.notes}
          onChange={set("notes")}
          onBlur={blur("notes")}
          help="Anything the shop should know before you arrive."
          maxLength={1000}
        />
      </div>

      {/* Above the button, not a toast — a toast can be missed, and this is
          the only copy of why nothing happened. */}
      {formError && (
        <p
          role="alert"
          className="mt-6 rounded-md border border-danger-text bg-surface px-3 py-2 text-body-sm text-danger-text"
        >
          {formError}
        </p>
      )}

      <div className="mt-6">
        <button
          type="submit"
          aria-busy={isSubmitting}
          className="relative inline-flex min-h-11 w-full items-center justify-center rounded-md bg-primary px-4 py-2 text-button text-on-primary transition-colors duration-120 ease-standard hover:bg-primary-hover active:bg-primary-active sm:w-auto"
        >
          {/* Label stays in flow so the button keeps its width. */}
          <span className={isSubmitting ? "invisible" : undefined}>{submitLabel}</span>
          {isSubmitting && (
            <span className="absolute inset-0 grid place-items-center">
              <Spinner label="Sending your booking" />
            </span>
          )}
        </button>

        <p className="mt-3 text-caption text-ink-muted">
          By booking you agree to let the shop contact you about this appointment.
        </p>
      </div>
    </fetcher.Form>
  );
}
