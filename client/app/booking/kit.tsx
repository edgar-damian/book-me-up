/** Shared chrome for the booking flow: the swapping panel, step trail, form
    field, spinner, and empty/error panels. Mirrors widgets/kit.tsx, which is
    the repo's pattern for a primitives grab-bag. */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Glyph,
  IconCalendarOff,
  IconCheck,
  useMotionAllowed,
  type GlyphProps,
} from "~/widgets/kit";

/* --- icons ---------------------------------------------------------------- */

/** Always paired with a text message — colour is never the channel. */
export const IconAlert = (p: GlyphProps) => (
  <Glyph {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7.5v5" />
    <path d="M12 16.2h.01" />
  </Glyph>
);

/** widgets/kit.tsx has right and down chevrons but no left one. */
export function Chevron({
  direction,
  className,
}: {
  direction: "prev" | "next";
  className: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d={direction === "prev" ? "m14 18-6-6 6-6" : "m10 6 6 6-6 6"} />
    </svg>
  );
}

/* --- spinner -------------------------------------------------------------- */

/** The arc is dropped under reduced motion rather than slowed: app.css
    collapses animation-duration globally, which strands a keyframe animation
    on its final frame. The track and role="status" carry it instead. */
export function Spinner({
  className = "size-4",
  label = "Loading",
}: {
  className?: string;
  label?: string;
}) {
  const motionAllowed = useMotionAllowed();

  return (
    <span role="status" aria-label={label} className="inline-grid place-items-center">
      <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth={2.5} opacity={0.2} />
        {motionAllowed && (
          <path
            d="M21 12a9 9 0 0 0-9-9"
            stroke="currentColor"
            strokeWidth={2.5}
            strokeLinecap="round"
            className="origin-center animate-spin"
            // 700ms is the spinner spec; the 120/200/320/520 tokens are for
            // transitions, and Tailwind's animate-spin default of 1s drags.
            style={{ animationDuration: "700ms" }}
          />
        )}
      </svg>
    </span>
  );
}

/** Renders nothing for `delay` ms, so a fast load never flashes a spinner. */
export function Pending({
  delay = 150,
  className = "size-8",
  label = "Loading",
  children,
}: {
  delay?: number;
  className?: string;
  label?: string;
  children?: React.ReactNode;
}) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), delay);
    return () => clearTimeout(timer);
  }, [delay]);

  if (!visible) return null;

  return (
    <div className="grid place-items-center gap-3 py-12 text-center">
      <span className="text-primary">
        <Spinner className={className} label={label} />
      </span>
      {children && <p className="text-body-sm text-ink-muted">{children}</p>}
    </div>
  );
}

/* --- form field ----------------------------------------------------------- */

// border-input, not hairline: an interactive boundary needs 3:1 (WCAG 1.4.11).
const CONTROL_BASE =
  "w-full min-h-11 rounded-xs border bg-surface px-3 py-2 text-body-sm text-ink " +
  "placeholder:text-ink-muted transition-colors duration-120 ease-standard";

export function Field({
  id,
  name,
  label,
  value,
  onChange,
  onBlur,
  error,
  help,
  type = "text",
  optional = false,
  multiline = false,
  rows = 3,
  autoComplete,
  inputMode,
  maxLength,
}: {
  id: string;
  name: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  error?: string;
  help?: string;
  type?: "text" | "email" | "tel";
  optional?: boolean;
  multiline?: boolean;
  rows?: number;
  autoComplete?: string;
  inputMode?: "text" | "email" | "tel";
  maxLength?: number;
}) {
  const errorId = `${id}-error`;
  const helpId = `${id}-help`;

  const describedBy = [error ? errorId : null, help ? helpId : null]
    .filter(Boolean)
    .join(" ");

  const control = {
    id,
    name,
    value,
    rows: multiline ? rows : undefined,
    maxLength,
    autoComplete,
    inputMode,
    "aria-invalid": error ? (true as const) : undefined,
    "aria-describedby": describedBy || undefined,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      onChange(e.target.value),
    onBlur,
    className: `${CONTROL_BASE} ${
      error ? "border-danger-text" : "border-border-input"
    } ${multiline ? "resize-y" : ""}`,
  };

  return (
    <div>
      <label htmlFor={id} className="block text-body-sm text-ink-secondary mb-1">
        {label}
        {optional && <span className="text-ink-muted"> (optional)</span>}
      </label>

      {multiline ? <textarea {...control} /> : <input {...control} type={type} />}

      {help && (
        <p id={helpId} className="mt-1 text-caption text-ink-muted">
          {help}
        </p>
      )}
      {error && (
        <p id={errorId} className="mt-1 text-caption text-danger-text">
          {error}
        </p>
      )}
    </div>
  );
}

/* --- empty and error panels ----------------------------------------------- */

export function ErrorPanel({
  title,
  body,
  onRetry,
}: {
  title: string;
  body: string;
  onRetry?: () => void;
}) {
  return (
    <div
      role="alert"
      className="grid place-items-center gap-3 rounded-xl bg-canvas-soft px-6 py-12 text-center"
    >
      <span
        className="grid size-12 place-items-center rounded-lg bg-status-rejected-tint text-status-rejected"
        aria-hidden="true"
      >
        <IconAlert className="size-6" />
      </span>

      <h3 className="text-heading-3 text-ink">{title}</h3>
      <p className="max-w-sm text-body-sm text-ink-muted">{body}</p>

      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-1 inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-4 py-2 text-button text-on-primary transition-colors duration-120 ease-standard hover:bg-primary-hover active:bg-primary-active"
        >
          Try again
        </button>
      )}
    </div>
  );
}

/** Always carries a next action — an empty state with nowhere to go is a bug. */
export function EmptyPanel({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="grid place-items-center gap-3 rounded-xl bg-canvas-soft px-6 py-12 text-center">
      <span
        className="grid size-12 place-items-center rounded-lg bg-accent-amber-tint text-accent-amber"
        aria-hidden="true"
      >
        <IconCalendarOff className="size-6" />
      </span>

      <h3 className="text-heading-3 text-ink">{title}</h3>
      <p className="max-w-sm text-body-sm text-ink-muted">{body}</p>
      {action}
    </div>
  );
}

/* --- the spotlight -------------------------------------------------------- */

// Client-side layout effect so the incoming panel never paints at full opacity
// for a frame; plain effect on the server, where React would warn.
const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

/**
 * The one panel that swaps as the flow advances — steps are never stacked.
 * Carries a min-height so a short panel does not collapse the page, and moves
 * focus on each swap since nothing navigates.
 */
export function Spotlight({
  stepKey,
  children,
}: {
  stepKey: string;
  children: React.ReactNode;
}) {
  const motionAllowed = useMotionAllowed();
  const panelRef = useRef<HTMLDivElement>(null);
  const lastStep = useRef<string | null>(null);
  const [entered, setEntered] = useState(true);

  useIsomorphicLayoutEffect(() => {
    const previous = lastStep.current;
    lastStep.current = stepKey;

    // Compared against the last step, not a "has run" flag: useMotionAllowed
    // resolves after mount, so this re-runs on load with the step unchanged —
    // firing then would yank focus out of the page at hydration.
    if (previous === null || previous === stepKey) return;

    panelRef.current?.focus({ preventScroll: true });

    if (!motionAllowed) return;
    setEntered(false);
    const frame = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(frame);
  }, [stepKey, motionAllowed]);

  return (
    <div
      ref={panelRef}
      tabIndex={-1}
      // p-4 below sm: seven 44px columns plus gaps need 332px and a 375px
      // screen has 343px inside the gutters, so padding gives way, not the grid.
      className="min-h-96 rounded-xl bg-surface p-4 shadow-soft outline-none sm:p-6"
      style={
        motionAllowed
          ? {
              transition:
                "opacity var(--duration-base) var(--ease-entrance), " +
                "transform var(--duration-base) var(--ease-entrance)",
              opacity: entered ? 1 : 0,
              transform: entered ? "none" : "translate3d(0, 8px, 0)",
            }
          : undefined
      }
    >
      {children}
    </div>
  );
}

/** Back steps the wizard, not the browser — the URL never changes, so browser
    back leaves the flow entirely. */
export function StepHeading({
  title,
  hint,
  onBack,
  backLabel,
}: {
  title: string;
  hint?: string;
  onBack?: () => void;
  backLabel?: string;
}) {
  return (
    <div className="mb-6">
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          className="-ml-3 mb-2 inline-flex min-h-11 items-center gap-2 rounded-md px-3 text-body-sm text-ink transition-colors duration-120 ease-standard hover:bg-hover-wash active:bg-press-wash"
        >
          <Chevron direction="prev" className="size-4 shrink-0" />
          {backLabel ?? "Back"}
        </button>
      )}

      <h2 className="text-heading-2 text-ink">{title}</h2>
      {hint && <p className="mt-1 text-body-sm text-ink-muted">{hint}</p>}
    </div>
  );
}

/* --- step trail ----------------------------------------------------------- */

export type Step = { id: string; label: string };

/**
 * Progress indicator, not navigation — Back inside the panel is the only way
 * backwards. The live region matters: the panel swaps without a page load, so
 * nothing else announces that the step advanced.
 */
export function StepTrail({
  steps,
  currentIndex,
}: {
  steps: Step[];
  currentIndex: number;
}) {
  const done = currentIndex >= steps.length;

  return (
    <div className="mb-6">
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {steps.map((step, index) => {
          const isCurrent = index === currentIndex;
          const isComplete = index < currentIndex;

          return (
            <li key={step.id} className="flex items-center gap-2">
              {index > 0 && (
                <span aria-hidden="true" className="text-ink-faint">
                  ·
                </span>
              )}

              <span
                aria-current={isCurrent ? "step" : undefined}
                className={`inline-flex items-center gap-1.5 text-eyebrow uppercase ${
                  isCurrent
                    ? "text-ink"
                    : isComplete
                      ? "text-ink-secondary"
                      : "text-ink-faint"
                }`}
              >
                {isComplete && <IconCheck className="size-3.5 text-status-accepted" />}
                {step.label}
                {isComplete && <span className="sr-only">, done</span>}
              </span>
            </li>
          );
        })}
      </ol>

      <p aria-live="polite" className="sr-only">
        {done
          ? "Booking complete."
          : `Step ${currentIndex + 1} of ${steps.length}: ${steps[currentIndex]?.label}.`}
      </p>
    </div>
  );
}
