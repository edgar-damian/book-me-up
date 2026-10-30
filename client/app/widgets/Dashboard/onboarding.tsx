import { useEffect, useRef } from "react";
import { Link } from "react-router";
import { IconCalendar, IconCheck, IconMenuList, IconStorefront, IconUser, Spinner } from "~/widgets/kit";

/* The setup wizard's frame: where the worker is, and the buttons that move
   them. It has no form of its own. Next submits the step's form by id through
   the button's form attribute, so each step widget also works outside it. */

export const STEPS = [
  { key: "profile", title: "Your profile", Icon: IconUser },
  { key: "shop", title: "Your shop", Icon: IconStorefront },
  { key: "schedule", title: "Your hours", Icon: IconCalendar },
  { key: "services", title: "Your services", Icon: IconMenuList },
  { key: "live", title: "Go live", Icon: IconCheck },
] as const;

export type StepKey = (typeof STEPS)[number]["key"];

const LANDMARK = "grid size-11 place-items-center rounded-pill border transition-colors duration-200 ease-standard";

const BUTTON =
  "inline-flex min-h-11 w-full items-center justify-center rounded-md px-4 py-2 text-button " +
  "transition-colors duration-120 ease-standard disabled:pointer-events-none disabled:opacity-50";

function Progress({ at }: { at: number }) {
  return (
    <ol aria-label="Setup progress" className="flex items-center">
      {STEPS.map(({ key, title, Icon }, i) => (
        <li
          key={key}
          aria-current={i === at ? "step" : undefined}
          className={`flex items-center ${i > 0 ? "flex-1" : ""}`}
        >
          {i > 0 && (
            <span
              aria-hidden="true"
              className={`h-px flex-1 transition-colors duration-200 ease-standard ${
                i <= at ? "bg-primary" : "bg-hairline"
              }`}
            />
          )}
          <span
            className={`${LANDMARK} ${
              i < at
                ? "border-primary bg-primary text-on-primary"
                : i === at
                  ? "border-primary bg-surface text-primary-text"
                  : "border-hairline bg-surface text-ink-muted"
            }`}
          >
            <Icon className="size-5" />
            <span className="sr-only">{title}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

export function OnboardingWizard({
  step,
  form,
  busy,
  children,
}: {
  step: StepKey;
  /** id of the step's form, which Next submits. Left out while a step has nothing to save. */
  form?: string;
  busy: boolean;
  children: React.ReactNode;
}) {
  const at = STEPS.findIndex((s) => s.key === step);
  const previous = at > 0 ? STEPS[at - 1] : null;
  // Nothing comes after the last step, so it has no Next.
  const last = at === STEPS.length - 1;

  // The first paint is already on screen; only a step change gets the entrance.
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
  }, []);

  return (
    <div>
      <Progress at={at} />
      <div className="mt-6 rounded-xl border border-hairline bg-surface p-6">
        <p className="text-eyebrow uppercase text-ink-muted">
          Step {at + 1} of {STEPS.length}
        </p>
        <h2 className="mt-2 text-heading-3 text-ink">{STEPS[at].title}</h2>
        <div key={step} className={`mt-6 ${mounted.current ? "step-enter" : ""}`}>
          {children}
        </div>

        <div className="mt-6 grid grid-cols-2 gap-3">
          {previous ? (
            <Link
              to={`?step=${previous.key}`}
              className={`${BUTTON} border border-border-input bg-surface text-ink hover:bg-hover-wash active:bg-press-wash`}
            >
              Previous
            </Link>
          ) : (
            <button
              type="button"
              disabled
              className={`${BUTTON} border border-border-input bg-surface text-ink`}
            >
              Previous
            </button>
          )}
          {!last && (
            <button
              type="submit"
              form={form}
              disabled={!form}
              aria-busy={busy || undefined}
              className={`${BUTTON} bg-primary text-on-primary hover:bg-primary-hover active:bg-primary-active ${
                busy ? "pointer-events-none" : ""
              }`}
            >
              {busy ? <Spinner label="Saving…" /> : "Next"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
