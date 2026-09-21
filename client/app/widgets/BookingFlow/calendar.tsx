import { useState } from "react";
import { cn } from "~/lib/utils";
import { IconCalendarOff, IconChevronRight } from "~/widgets/kit";
import type { DatesAvailable } from "~/models/bookingFlow";
import { CARD, IconButton, LONG_DAY, fmtDay, utc } from "./shared";

/* Step 1 of the booking flow: pick a day. Everything the server sends is a
   `YYYY-MM-DD` string local to the establishment's timezone, so the dates stay
   strings in here (see shared.tsx for why). The only Dates built are from
   integers and read in UTC, which is grid geometry and label text only. */

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** `YYYY-MM-DD`, month 1-based. */
const iso = (y: number, m: number, d: number) =>
  `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/** A month as one sortable integer, so clamping the nav is a comparison. */
const monthOf = (day: string) => {
  const [y, m] = day.split("-").map(Number);
  return y * 12 + m - 1;
};

export function Calendar({
  dates,
  selected,
  onSelect,
}: {
  dates: DatesAvailable;
  selected: string | null;
  onSelect: (day: string) => void;
}) {
  // Today in the shop's timezone, not the visitor's. Sets the back limit and
  // the today ring. The opening month is wherever the user's answer is: the
  // day they already picked, else the first open day, else this month.
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: dates.timezone }).format(new Date());
  const firstMonth = monthOf(today);
  const lastMonth = Math.max(monthOf(dates.window_end), firstMonth);

  const [cursor, setCursor] = useState(monthOf(selected ?? dates.dates[0] ?? today));
  const year = Math.floor(cursor / 12);
  const month = (cursor % 12) + 1;

  const open = new Set(dates.dates);
  const blanks = utc(year, month, 1).getUTCDay();
  const dayCount = utc(year, month + 1, 0).getUTCDate();

  if (dates.dates.length === 0) {
    return (
      <div className={`${CARD} grid place-items-center gap-2 p-8 text-center`}>
        <IconCalendarOff className="size-8 text-ink-muted" />
        <p className="text-body-md text-ink">No open days</p>
        <p className="text-body-sm text-ink-muted">
          Fully booked through {fmtDay(dates.window_end, { month: "long", day: "numeric" })}.
          Check back soon.
        </p>
      </div>
    );
  }

  return (
    <div className={`${CARD} p-4`}>
      <div className="flex items-center justify-between">
        <IconButton label="Previous month" disabled={cursor <= firstMonth} onClick={() => setCursor(cursor - 1)}>
          <IconChevronRight className="size-5 rotate-180" />
        </IconButton>
        <h2 aria-live="polite" className="text-heading-3 text-ink">
          {fmtDay(iso(year, month, 1), { month: "long", year: "numeric" })}
        </h2>
        <IconButton label="Next month" disabled={cursor >= lastMonth} onClick={() => setCursor(cursor + 1)}>
          <IconChevronRight className="size-5" />
        </IconButton>
      </div>

      <div aria-hidden="true" className="mt-2 grid grid-cols-7 gap-1">
        {WEEKDAYS.map((day) => (
          <span key={day} className="grid h-8 place-items-center text-eyebrow text-ink-muted">
            {day}
          </span>
        ))}
      </div>

      {/* Font size sits on the grid, not the cells: tailwind-merge does not know
          this project's type scale, so inside cn() it reads `text-body-sm` as a
          colour and drops it next to `text-ink`. */}
      <div className="grid grid-cols-7 gap-1 text-body-sm">
        {Array.from({ length: blanks }, (_, i) => (
          <span key={`blank-${i}`} />
        ))}
        {Array.from({ length: dayCount }, (_, i) => {
          const day = i + 1;
          const key = iso(year, month, day);
          const available = open.has(key);
          const isSelected = key === selected;
          const label = fmtDay(key, LONG_DAY);

          return (
            <button
              key={key}
              type="button"
              disabled={!available}
              aria-label={available ? label : `${label}, unavailable`}
              aria-pressed={available ? isSelected : undefined}
              onClick={() => onSelect(key)}
              className={cn(
                "grid h-11 w-full place-items-center rounded-sm",
                "transition-colors duration-120 ease-standard",
                !available && "text-day-unavailable",
                available && !isSelected && "text-ink hover:bg-hover-wash active:bg-press-wash",
                isSelected && "bg-primary text-on-primary",
                !isSelected && key === today && "ring-1 ring-primary",
              )}
            >
              {day}
            </button>
          );
        })}
      </div>
    </div>
  );
}
