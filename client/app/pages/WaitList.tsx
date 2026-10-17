import { useState } from "react";
import { Form, useNavigation } from "react-router";
import { Container, Input, Spinner, toE164 } from "~/widgets/kit";
import { SiteHeader } from "~/widgets/siteHeader";
import { CompanyFooter } from "~/widgets/companyFooter";


type Field = "first_name" | "last_name" | "phone" | "email";
type Errors = Partial<Record<Field, string>>;

const FIELDS: Field[] = ["first_name", "last_name", "phone", "email"];

/** The server's `_clean_email()` shape check: one @, and a dot in the domain. */
function isEmail(value: string) {
  const [local, domain, ...rest] = value.trim().split("@");
  return local !== "" && rest.length === 0 && (domain ?? "").includes(".");
}

function check(name: Field, value: string) {
  if (name === "phone") return toE164(value) ? undefined : "Enter a phone number with area code";
  if (name === "email") return isEmail(value) ? undefined : "Enter an email address";
  if (value.trim()) return undefined;
  return name === "first_name" ? "Enter your first name" : "Enter your last name";
}


function ConfirmationMessage() {
  return (
    <div role="status" className="flex aspect-square flex-col items-center justify-center gap-6 text-center">
      <h2 className="text-heading-2 text-ink">You're on the list</h2>
      <span aria-hidden="true" className="text-display-1">🎉</span>
      <p className="text-body-md text-ink-secondary">Thanks, we'll be in touch.</p>
    </div>
  );
}


export function WaitList({ joined, error }: { joined: boolean; error: string | null }) {
  const [errors, setErrors] = useState<Errors>({});
  const busy = useNavigation().state === "submitting";

  // A valid phone is rewritten in place so what is posted is what is shown.
  function blur(e: React.FocusEvent<HTMLInputElement>) {
    const name = e.target.name as Field;
    const value = e.target.value;
    if (name === "phone" && toE164(value)) e.target.value = toE164(value)!;
    setErrors((cur) => ({ ...cur, [name]: check(name, value) }));
  }

  function submit(e: React.SubmitEvent<HTMLFormElement>) {
    const form = e.currentTarget;
    const next: Errors = {};
    for (const name of FIELDS) {
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

  return (
    <div className="overflow-x-clip bg-canvas-soft text-ink">
      <SiteHeader company />
      <main>
        <section className="py-16 md:py-24 lg:py-32">
          <Container>
            <h1 className="font-display text-display-1 text-ink">Join the waitlist</h1>
            <p className="mt-6 max-w-2xl text-body-md text-ink-secondary">
              Get in before launch and your first 3 months of book-me-up are on us.
            </p>

            <div className="mt-10 max-w-md rounded-xl border border-hairline bg-surface p-6">
              {joined ? (
                <ConfirmationMessage />
              ) : (
                <Form method="post" noValidate onSubmit={submit} className="grid gap-4 text-body-sm">
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
                  />
                  <Input name="email" label="Email" type="email" autoComplete="email" required onBlur={blur} error={errors.email} />

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
                    {busy ? <Spinner label="Start my 3 months free" /> : "Join the waitlist"}
                  </button>
                </Form>
              )}
            </div>
          </Container>
        </section>
      </main>
      <CompanyFooter />
    </div>
  );
}
