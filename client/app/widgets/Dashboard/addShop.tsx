import { useState } from "react";
import { Form } from "react-router";
import { FIELD, IconChevronDown, Input, toE164, toMinutes, toSlug } from "~/widgets/kit";

/* A new shop, owned by the worker who adds it, with their own chair there.
   Inputs stay uncontrolled; only the errors are state. There is no submit
   button here: any button with form={ADD_SHOP_FORM}, like the wizard's Next,
   submits it. */

export const ADD_SHOP_FORM = "add-shop";

// Keys match the establishment.hours jsonb.
const DAYS = [
  ["sun", "Sun", "Sunday"],
  ["mon", "Mon", "Monday"],
  ["tue", "Tue", "Tuesday"],
  ["wed", "Wed", "Wednesday"],
  ["thu", "Thu", "Thursday"],
  ["fri", "Fri", "Friday"],
  ["sat", "Sat", "Saturday"],
] as const;

// IANA names, as establishment.timezone stores them.
const TIMEZONES = [
  ["America/New_York", "Eastern"],
  ["America/Chicago", "Central"],
  ["America/Denver", "Mountain"],
  ["America/Phoenix", "Arizona"],
  ["America/Los_Angeles", "Pacific"],
  ["America/Anchorage", "Alaska"],
  ["Pacific/Honolulu", "Hawaii"],
] as const;

type Errors = Partial<Record<string, string>>;

// In the order they appear.
const REQUIRED: Record<string, string> = {
  name: "Enter the shop's name",
  slug: "Enter a link for the shop's page",
  address: "Enter the street address",
  city: "Enter the city",
  state: "Enter the state",
  zip: "Enter the ZIP code",
  timezone: "Choose the shop's timezone",
};

const DETAILS = [...Object.keys(REQUIRED), "phone", "email"];

// Every checked field in the order they appear, so a failed submit focuses the topmost problem.
const FIELDS = [...DETAILS, ...DAYS.flatMap(([key]) => [`hours-${key}-open`, `hours-${key}-close`])];

/** Same shape check as the sign-up page: one @, and a dot in the domain. */
function isEmail(value: string) {
  const [local, domain, ...rest] = value.trim().split("@");
  return local !== "" && rest.length === 0 && (domain ?? "").includes(".");
}

// The link is tidied before it is checked, so anything left in it is valid.
function check(name: string, value: string) {
  if (name === "email") return !value.trim() || isEmail(value) ? undefined : "Enter an email address";
  if (name === "phone") return !value.trim() || toE164(value) ? undefined : "Enter a phone number with area code";
  return value.trim() ? undefined : REQUIRED[name];
}

/** Rewrites the link, and a valid phone, in place so what is posted is what is shown. */
function tidy(input: HTMLInputElement | HTMLSelectElement) {
  if (input.name === "slug") input.value = toSlug(input.value);
  if (input.name === "phone" && toE164(input.value)) input.value = toE164(input.value)!;
}

/**
 * What is wrong with one day's hours, keyed by field name. A day with neither
 * time is closed. 00:00 is the start of the day, so it can't be a close.
 */
function checkDay(form: HTMLFormElement, key: string): Errors {
  const time = (end: string) => toMinutes((form.elements.namedItem(`hours-${key}-${end}`) as HTMLInputElement).value);
  const open = time("open");
  const close = time("close");
  if (open === null && close === null) return {};
  if (open === null) return { [`hours-${key}-open`]: "Enter both times" };
  if (close === null) return { [`hours-${key}-close`]: "Enter both times" };
  return close > open ? {} : { [`hours-${key}-close`]: "Close after it opens" };
}

export function AddShopForm({
  error,
}: {
  /** Form-level failure from the last submit, shown at the end of the form. */
  error: string | null;
}) {
  const [errors, setErrors] = useState<Errors>({});

  // Validate on blur and on submit, never per keystroke. The timezone is also
  // checked when one is picked.
  function blur(e: { target: HTMLInputElement | HTMLSelectElement }) {
    tidy(e.target);
    const name = e.target.name;
    const problem = check(name, e.target.value);
    setErrors((cur) => ({ ...cur, [name]: problem }));
  }

  // Clears whatever the day no longer gets wrong, but only flags the time just
  // left, so a day isn't flagged before its second time is entered.
  function blurTime(e: React.FocusEvent<HTMLInputElement>) {
    const name = e.target.name;
    const key = name.split("-")[1];
    const found = checkDay(e.target.form!, key);
    setErrors((cur) => {
      const next = { ...cur };
      for (const end of ["open", "close"]) {
        if (!found[`hours-${key}-${end}`]) next[`hours-${key}-${end}`] = undefined;
      }
      next[name] = found[name];
      return next;
    });
  }

  function submit(e: React.SubmitEvent<HTMLFormElement>) {
    const form = e.currentTarget;
    const found: Errors = {};
    for (const name of DETAILS) {
      const input = form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement;
      tidy(input);
      const problem = check(name, input.value);
      if (problem) found[name] = problem;
    }
    for (const [key] of DAYS) Object.assign(found, checkDay(form, key));
    setErrors(found);
    const first = FIELDS.find((name) => found[name]);
    if (!first) return;
    e.preventDefault();
    (form.elements.namedItem(first) as HTMLElement).focus();
  }

  return (
    <Form id={ADD_SHOP_FORM} method="post" noValidate onSubmit={submit} className="grid gap-4 text-body-sm">
      <input type="hidden" name="intent" value={ADD_SHOP_FORM} />
      <p className="text-ink-secondary">
        Add your shop and you'll be its owner. Clients see these details on the shop's page.
      </p>

      <Input
        name="name"
        label="Shop name"
        maxLength={100}
        autoComplete="organization"
        required
        onBlur={blur}
        error={errors.name}
      />
      <Input
        name="slug"
        label="Shop link"
        maxLength={60}
        autoCapitalize="none"
        autoComplete="off"
        spellCheck={false}
        required
        onBlur={blur}
        error={errors.slug}
        help="The end of the shop page's address, like main-street-studio."
      />

      <Input
        name="address"
        label="Street address"
        autoComplete="address-line1"
        required
        onBlur={blur}
        error={errors.address}
      />
      <div className="grid gap-4 sm:grid-cols-4">
        <div className="sm:col-span-2">
          <Input
            name="city"
            label="City"
            autoComplete="address-level2"
            required
            onBlur={blur}
            error={errors.city}
          />
        </div>
        <Input
          name="state"
          label="State"
          maxLength={2}
          autoCapitalize="characters"
          autoComplete="address-level1"
          required
          onBlur={blur}
          error={errors.state}
        />
        <Input
          name="zip"
          label="ZIP code"
          maxLength={10}
          inputMode="numeric"
          autoComplete="postal-code"
          required
          onBlur={blur}
          error={errors.zip}
        />
      </div>

      <div>
        <label htmlFor="timezone" className="mb-1 block text-ink-secondary">
          Timezone
        </label>
        <div className="relative">
          <select
            id="timezone"
            name="timezone"
            defaultValue=""
            required
            aria-invalid={errors.timezone ? true : undefined}
            aria-describedby={errors.timezone ? "timezone-error" : "timezone-help"}
            onChange={blur}
            onBlur={blur}
            className={`${FIELD} appearance-none pr-10 ${errors.timezone ? "border-danger-text" : "border-border-input"}`}
          >
            <option value="" disabled>
              Choose your shop's timezone
            </option>
            {TIMEZONES.map(([zone, label]) => (
              <option key={zone} value={zone}>
                {label}
              </option>
            ))}
          </select>
          <IconChevronDown className="pointer-events-none absolute top-1/2 right-3 size-5 -translate-y-1/2 text-ink-muted" />
        </div>
        {errors.timezone ? (
          <p id="timezone-error" className="mt-1 text-caption text-danger-text">
            {errors.timezone}
          </p>
        ) : (
          <p id="timezone-help" className="mt-1 text-caption text-ink-muted">
            Hours and bookings at this shop run on this clock.
          </p>
        )}
      </div>

      <Input
        name="phone"
        label="Shop phone (optional)"
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        onBlur={blur}
        error={errors.phone}
      />
      <Input
        name="email"
        label="Shop email (optional)"
        type="email"
        autoComplete="email"
        spellCheck={false}
        onBlur={blur}
        error={errors.email}
      />

      <div>
        <label htmlFor="description" className="mb-1 block text-ink-secondary">
          About the shop (optional)
        </label>
        <textarea
          id="description"
          name="description"
          rows={4}
          maxLength={1000}
          className={`${FIELD} border-border-input`}
        />
      </div>

      <fieldset className="min-w-0">
        <legend className="mb-1 text-ink-secondary">Opening hours (optional)</legend>
        <p className="text-caption text-ink-muted">
          Shown on the shop's page. Leave a day empty if the shop is closed.
        </p>
        <div aria-hidden="true" className="mt-3 flex gap-3 text-caption text-ink-muted">
          <span className="w-10 shrink-0" />
          <span className="flex-1">Opens</span>
          <span className="flex-1">Closes</span>
        </div>
        <div className="divide-y divide-hairline">
          {DAYS.map(([key, short, day]) => {
            const open = `hours-${key}-open`;
            const close = `hours-${key}-close`;
            const note = `hours-${key}-error`;
            const problem = errors[open] ?? errors[close];
            const box = (name: string) =>
              `${FIELD} min-w-0 flex-1 ${errors[name] ? "border-danger-text" : "border-border-input"}`;
            return (
              <div key={key} className="py-2">
                <div className="flex items-center gap-3">
                  <span className="w-10 shrink-0 text-ink">{short}</span>
                  <input
                    type="time"
                    name={open}
                    aria-label={`${day} opens`}
                    aria-invalid={errors[open] ? true : undefined}
                    aria-describedby={errors[open] ? note : undefined}
                    onBlur={blurTime}
                    className={box(open)}
                  />
                  <input
                    type="time"
                    name={close}
                    aria-label={`${day} closes`}
                    aria-invalid={errors[close] ? true : undefined}
                    aria-describedby={errors[close] ? note : undefined}
                    onBlur={blurTime}
                    className={box(close)}
                  />
                </div>
                {problem && (
                  <p id={note} className="mt-1 pl-13 text-caption text-danger-text">
                    {problem}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </fieldset>

      {error && (
        <p role="alert" className="text-danger-text">
          {error}
        </p>
      )}
    </Form>
  );
}
