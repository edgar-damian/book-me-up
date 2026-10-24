import { useState } from "react";
import { Form, useNavigation } from "react-router";
import { Container, Input, Spinner, toE164 } from "~/widgets/kit";
import { SiteHeader } from "~/widgets/siteHeader";
import { CompanyFooter } from "~/widgets/companyFooter";


type Field = "first_name" | "last_name" | "email" | "phone" | "password" | "confirm_password";
type Errors = Partial<Record<Field, string>>;

// In the order they appear, so a failed submit focuses the topmost problem.
const FIELDS: Field[] = ["first_name", "last_name", "email", "phone", "password", "confirm_password"];

/** Same shape check as the waitlist: one @, and a dot in the domain. */
function isEmail(value: string) {
  const [local, domain, ...rest] = value.trim().split("@");
  return local !== "" && rest.length === 0 && (domain ?? "").includes(".");
}

function valueOf(form: HTMLFormElement, name: Field) {
  return (form.elements.namedItem(name) as HTMLInputElement).value;
}

// Spaces can be part of a password, so it is checked for presence and not trimmed.
function check(name: Field, value: string, form: HTMLFormElement) {
  if (name === "email") return isEmail(value) ? undefined : "Enter an email address";
  if (name === "phone") return toE164(value) ? undefined : "Enter a phone number with area code";
  if (name === "password") return value ? undefined : "Enter your password";
  if (name === "confirm_password") {
    if (!value) return "Enter your password again";
    return value === valueOf(form, "password") ? undefined : "Passwords don't match";
  }
  if (value.trim()) return undefined;
  return name === "first_name" ? "Enter your first name" : "Enter your last name";
}


export function SignUp({ error }: { error: string | null }) {
  const [errors, setErrors] = useState<Errors>({});
  // formMethod stays "POST" through the redirect after a sign-up, when state has already moved to "loading".
  const busy = useNavigation().formMethod === "POST";

  // A valid phone is rewritten in place so what is posted is what is shown.
  function blur(e: React.FocusEvent<HTMLInputElement>) {
    const input = e.target;
    const form = input.form!;
    const name = input.name as Field;
    if (name === "phone" && toE164(input.value)) input.value = toE164(input.value)!;
    const next: Errors = {};
    next[name] = check(name, input.value, form);
    // A new password can fix or break a confirmation that is already typed.
    const confirm = valueOf(form, "confirm_password");
    if (name === "password" && confirm) next.confirm_password = check("confirm_password", confirm, form);
    setErrors((cur) => ({ ...cur, ...next }));
  }

  function submit(e: React.SubmitEvent<HTMLFormElement>) {
    const form = e.currentTarget;
    const phone = form.elements.namedItem("phone") as HTMLInputElement;
    if (toE164(phone.value)) phone.value = toE164(phone.value)!;
    const next: Errors = {};
    for (const name of FIELDS) {
      const problem = check(name, valueOf(form, name), form);
      if (problem) next[name] = problem;
    }
    setErrors(next);
    if (Object.keys(next).length === 0) return;
    e.preventDefault();
    (form.elements.namedItem(Object.keys(next)[0]) as HTMLInputElement).focus();
  }

  return (
    <div className="overflow-x-clip bg-canvas-soft text-ink">
      <SiteHeader company />
      <main>
        <section className="py-16 md:py-24 lg:py-32">
          <Container>
            <h1 className="font-display text-display-1 text-ink">Sign up</h1>
            <p className="mt-6 max-w-2xl text-pretty text-body-md text-ink-secondary">
              Create an account to see your bookings and manage your schedule.
            </p>

            <div className="mt-10 max-w-md rounded-xl border border-hairline bg-surface p-6">
              <Form method="post" noValidate onSubmit={submit} className="grid gap-4 text-body-sm">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Input name="first_name" label="First name" autoComplete="given-name" required onBlur={blur} error={errors.first_name} />
                  <Input name="last_name" label="Last name" autoComplete="family-name" required onBlur={blur} error={errors.last_name} />
                </div>
                {/* `username` is what password managers pair with `new-password`. */}
                <Input
                  name="email"
                  label="Email"
                  type="email"
                  autoComplete="username"
                  spellCheck={false}
                  required
                  onBlur={blur}
                  error={errors.email}
                />
                <Input
                  name="phone"
                  label="Phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  required
                  onBlur={blur}
                  error={errors.phone}
                />
                <Input
                  name="password"
                  label="Password"
                  type="password"
                  autoComplete="new-password"
                  required
                  onBlur={blur}
                  error={errors.password}
                />
                <Input
                  name="confirm_password"
                  label="Confirm password"
                  type="password"
                  autoComplete="new-password"
                  required
                  onBlur={blur}
                  error={errors.confirm_password}
                />

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
                  {busy ? <Spinner label="Signing up…" /> : "Sign up"}
                </button>
                <a
                  href="/login"
                  className="inline-flex min-h-11 w-full items-center justify-center rounded-md border border-border-input bg-surface px-4 py-2 text-button text-ink transition-colors duration-120 ease-standard hover:bg-hover-wash active:bg-press-wash"
                >
                  Log in
                </a>
              </Form>
            </div>
          </Container>
        </section>
      </main>
      <CompanyFooter />
    </div>
  );
}
