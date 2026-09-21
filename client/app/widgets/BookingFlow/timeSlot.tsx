import { IconClock } from "~/widgets/kit";
import type { TimesAvailable } from "~/models/bookingFlow";
import { BackButton, CARD, LONG_DAY, TIME, fmtDay, fmtInstant } from "./shared";

/* Step 2 of the booking flow: pick a time on the chosen day. Tapping a slot is
   the whole interaction; the page advances on its own. Slots are absolute
   instants and are labelled on the shop's clock, not the visitor's. */

const SLOT = "min-h-11 rounded-md border transition-colors duration-120 ease-standard";

export function TimeSlots({
  times,
  selected,
  notice,
  onSelect,
  onBack,
}: {
  times: TimesAvailable;
  selected: string | null;
  /** Why the visitor is back here, e.g. the slot they chose was just taken. */
  notice: string | null;
  onSelect: (startTime: string) => void;
  onBack: () => void;
}) {
  return (
    <div className={`${CARD} p-4`}>
      <div className="flex items-center gap-2">
        <BackButton label="Back to calendar" onClick={onBack} />
        <h2 className="text-heading-3 text-ink">{fmtDay(times.day_chose, LONG_DAY)}</h2>
      </div>

      {notice && (
        <p role="alert" className="mt-4 text-body-sm text-danger-text">
          {notice}
        </p>
      )}

      {times.valid_slots.length === 0 ? (
        <div className="grid place-items-center gap-2 p-8 text-center">
          <IconClock className="size-8 text-ink-muted" />
          <p className="text-body-md text-ink">No times left on this day</p>
          <button
            type="button"
            onClick={onBack}
            className="mt-2 inline-flex min-h-11 items-center rounded-md border border-border-input bg-surface px-4 py-2 text-button text-ink transition-colors duration-120 ease-standard hover:bg-hover-wash active:bg-press-wash"
          >
            Pick another day
          </button>
        </div>
      ) : (
        // Font size sits on the grid, not the buttons, so a button's colour
        // classes never collide with it (see the note in calendar.tsx).
        <div className="mt-4 max-h-96 overflow-y-auto overscroll-contain">
          <div className="grid grid-cols-3 gap-2 text-body-sm">
            {times.valid_slots.map(({ start_time }) => {
              const isSelected = start_time === selected;
              return (
                <button
                  key={start_time}
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => onSelect(start_time)}
                  className={`${SLOT} ${
                    isSelected
                      ? "border-primary bg-primary text-on-primary"
                      : "border-border-input bg-surface text-ink hover:bg-hover-wash active:bg-press-wash"
                  }`}
                >
                  {fmtInstant(start_time, times.timezone, TIME)}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
