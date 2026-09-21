import { IconCalendar, IconClock, IconNote } from "~/widgets/kit";

export type Step = 1 | 2 | 3 | "done";

const STEPS = [
  { name: "Day", Icon: IconCalendar },
  { name: "Time", Icon: IconClock },
  { name: "Details", Icon: IconNote },
];

const LANDMARK = "grid size-11 place-items-center rounded-pill border transition-colors duration-200 ease-standard";

export function Progress({ step }: { step: Step }) {
  const at = step === "done" ? STEPS.length : step - 1;

  return (
    <ol aria-label="Booking progress" className="flex items-center">
      {STEPS.map(({ name, Icon }, i) => (
        <li
          key={name}
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
            <span className="sr-only">{name}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}
