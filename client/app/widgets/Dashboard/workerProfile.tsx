import { useState } from "react";
import { Form } from "react-router";
import { FIELD, Input, toE164, toSlug } from "~/widgets/kit";
import type { SaveWorkerProfile } from "~/models/dashboard";

/* What a worker's public page shows about them. Inputs stay uncontrolled and
   start from `profile`; only the errors are state. There is no submit button
   here: any button with form={PROFILE_FORM}, like the wizard's Next, submits it. */

export const PROFILE_FORM = "worker-profile";

type Field = "slug" | "first_name" | "last_name" | "public_email" | "public_phone";
type Errors = Partial<Record<Field, string>>;

// In the order they appear, so a failed submit focuses the topmost problem.
const FIELDS: Field[] = ["slug", "first_name", "last_name", "public_email", "public_phone"];

/** Same shape check as the sign-up page: one @, and a dot in the domain. */
function isEmail(value: string) {
  const [local, domain, ...rest] = value.trim().split("@");
  return local !== "" && rest.length === 0 && (domain ?? "").includes(".");
}

// The link is tidied before it is checked, so anything left in it is valid.
function check(name: Field, value: string) {
  if (name === "public_email") return !value.trim() || isEmail(value) ? undefined : "Enter an email address";
  if (name === "public_phone") {
    return !value.trim() || toE164(value) ? undefined : "Enter a phone number with area code";
  }
  if (value.trim()) return undefined;
  if (name === "slug") return "Enter a link for your page";
  return name === "first_name" ? "Enter your first name" : "Enter your last name";
}

/** Rewrites the link, and a valid phone, in place so what is posted is what is shown. */
function tidy(input: HTMLInputElement) {
  if (input.name === "slug") input.value = toSlug(input.value);
  if (input.name === "public_phone" && toE164(input.value)) input.value = toE164(input.value)!;
}

export function WorkerProfileForm({
  profile,
  error,
}: {
  profile: SaveWorkerProfile;
  /** Form-level failure from the last submit, shown at the end of the form. */
  error: string | null;
}) {
  const [errors, setErrors] = useState<Errors>({});

  // Validate on blur and on submit, never per keystroke.
  function blur(e: React.FocusEvent<HTMLInputElement>) {
    tidy(e.target);
    const name = e.target.name as Field;
    setErrors((cur) => ({ ...cur, [name]: check(name, e.target.value) }));
  }

  function submit(e: React.SubmitEvent<HTMLFormElement>) {
    const form = e.currentTarget;
    const next: Errors = {};
    for (const name of FIELDS) {
      const input = form.elements.namedItem(name) as HTMLInputElement;
      tidy(input);
      const problem = check(name, input.value);
      if (problem) next[name] = problem;
    }
    setErrors(next);
    if (Object.keys(next).length === 0) return;
    e.preventDefault();
    (form.elements.namedItem(Object.keys(next)[0]) as HTMLInputElement).focus();
  }

  return (
    <Form id={PROFILE_FORM} method="post" noValidate onSubmit={submit} className="grid gap-4 text-body-sm">
      <input type="hidden" name="intent" value={PROFILE_FORM} />
      <Input
        name="slug"
        label="Your link"
        defaultValue={profile.slug}
        maxLength={60}
        autoCapitalize="none"
        autoComplete="off"
        spellCheck={false}
        required
        onBlur={blur}
        error={errors.slug}
        help="Ends your page's web address. Letters, numbers and dashes."
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          name="first_name"
          label="First name"
          defaultValue={profile.first_name}
          autoComplete="given-name"
          required
          onBlur={blur}
          error={errors.first_name}
        />
        <Input
          name="last_name"
          label="Last name"
          defaultValue={profile.last_name}
          autoComplete="family-name"
          required
          onBlur={blur}
          error={errors.last_name}
        />
      </div>
      <div>
        <label htmlFor="bio" className="mb-1 block text-ink-secondary">
          Bio (optional)
        </label>
        <textarea
          id="bio"
          name="bio"
          rows={4}
          maxLength={1000}
          defaultValue={profile.bio}
          className={`${FIELD} border-border-input`}
        />
      </div>
      <Input
        name="public_email"
        label="Email for clients (optional)"
        type="email"
        defaultValue={profile.public_email ?? ""}
        autoComplete="email"
        spellCheck={false}
        onBlur={blur}
        error={errors.public_email}
      />
      <Input
        name="public_phone"
        label="Phone for clients (optional)"
        type="tel"
        inputMode="tel"
        defaultValue={profile.public_phone ?? ""}
        autoComplete="tel"
        onBlur={blur}
        error={errors.public_phone}
      />

      {error && (
        <p role="alert" className="text-danger-text">
          {error}
        </p>
      )}
    </Form>
  );
}
