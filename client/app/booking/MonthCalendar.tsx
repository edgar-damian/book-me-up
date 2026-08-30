/** One month of days, one screen. The month range is clamped to the server's
    booking window, and arrows hop between bookable days because the design
    system makes unavailable ones non-focusable. */

import { useEffect, useMemo, useRef, useState } from "react";
import { Chevron } from "./kit";
import {
  WEEKDAY_INITIALS,
  WEEKDAY_NAMES,
  addMonths,
  longDate,
  monthLabel,
  monthMatrix,
  monthOf,
  monthOrdinal,
  parseYmd,
  shiftYmd,
  toYmd,
  weekdayOf,
  type Month,
} from "./format";

export function MonthCalendar({
  available,
  windowStart,
  windowEnd,
  today,
  selected,
  onSelect,
}: {
  /** YYYY-MM-DD with at least one bookable slot, ascending. */
  available: string[];
  windowStart: string;
  windowEnd: string;
  /** Today on the shop's wall, passed as data — never computed in render. */
  today: string;
  selected: string | null;
  onSelect: (day: string) => void;
}) {
  const availableSet = useMemo(() => new Set(available), [available]);

  const floor = useMemo(() => monthOf(windowStart), [windowStart]);
  const ceiling = useMemo(() => monthOf(windowEnd), [windowEnd]);

  const [month, setMonth] = useState<Month>(() =>
    monthOf(selected ?? available[0] ?? windowStart),
  );
  const [focusedDay, setFocusedDay] = useState<string>(
    () => selected ?? available[0] ?? windowStart,
  );

  const gridRef = useRef<HTMLDivElement>(null);
  // Only steal focus when the keyboard moved it, not when a mouse user pages.
  const pullFocus = useRef(false);

  useEffect(() => {
    if (!pullFocus.current) return;
    pullFocus.current = false;
    gridRef.current
      ?.querySelector<HTMLButtonElement>(`[data-day="${focusedDay}"]`)
      ?.focus();
  }, [focusedDay, month]);

  const canGoBack = monthOrdinal(month) > monthOrdinal(floor);
  const canGoForward = monthOrdinal(month) < monthOrdinal(ceiling);

  function goToMonth(next: Month) {
    const ordinal = monthOrdinal(next);
    if (ordinal < monthOrdinal(floor) || ordinal > monthOrdinal(ceiling)) return;
    setMonth(next);
  }

  /** Nearest bookable day at or beyond `from`, walking in `direction`. */
  function seek(from: string, direction: 1 | -1, inclusive = false): string | null {
    const pool = direction === 1 ? available : [...available].reverse();
    for (const day of pool) {
      if (day === from && inclusive) return day;
      if (direction === 1 ? day > from : day < from) return day;
    }
    return null;
  }

  function moveFocus(day: string | null) {
    if (day === null) return;
    pullFocus.current = true;
    setFocusedDay(day);
    // Follow across a month boundary or the cell is not rendered.
    const target = monthOf(day);
    if (monthOrdinal(target) !== monthOrdinal(month)) setMonth(target);
  }

  function onKeyDown(event: React.KeyboardEvent) {
    const { key } = event;

    const weekday = weekdayOf(focusedDay);
    const weekStart = shiftYmd(focusedDay, -weekday, windowStart, windowEnd);
    const weekEnd = shiftYmd(focusedDay, 6 - weekday, windowStart, windowEnd);

    let next: string | null = null;

    switch (key) {
      case "ArrowRight":
        next = seek(focusedDay, 1);
        break;
      case "ArrowLeft":
        next = seek(focusedDay, -1);
        break;
      case "ArrowDown":
        next = seek(shiftYmd(focusedDay, 6, windowStart, windowEnd), 1);
        break;
      case "ArrowUp":
        next = seek(shiftYmd(focusedDay, -6, windowStart, windowEnd), -1);
        break;
      case "Home":
        next = seek(weekStart, 1, true);
        if (next !== null && next > weekEnd) next = null;
        break;
      case "End":
        next = seek(weekEnd, -1, true);
        if (next !== null && next < weekStart) next = null;
        break;
      case "PageUp":
      case "PageDown": {
        const target = addMonths(month, key === "PageUp" ? -1 : 1);
        const ordinal = monthOrdinal(target);
        if (ordinal < monthOrdinal(floor) || ordinal > monthOrdinal(ceiling)) break;
        setMonth(target);
        const firstOfMonth = toYmd(target.year, target.month, 1);
        const candidate = seek(firstOfMonth, 1, true);
        if (candidate && monthOrdinal(monthOf(candidate)) === ordinal) {
          pullFocus.current = true;
          setFocusedDay(candidate);
        }
        event.preventDefault();
        return;
      }
      case "Enter":
      case " ":
        if (availableSet.has(focusedDay)) {
          onSelect(focusedDay);
          event.preventDefault();
        }
        return;
      default:
        return;
    }

    if (next !== null) {
      moveFocus(next);
      event.preventDefault();
    }
  }

  const weeks = monthMatrix(month);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-2">
        <ArrowButton
          label="Previous month"
          disabled={!canGoBack}
          onClick={() => goToMonth(addMonths(month, -1))}
          direction="prev"
        />

        {/* aria-live so PageUp/PageDown announces the new month. */}
        <h3 aria-live="polite" className="text-heading-3 text-ink">
          {monthLabel(month)}
        </h3>

        <ArrowButton
          label="Next month"
          disabled={!canGoForward}
          onClick={() => goToMonth(addMonths(month, 1))}
          direction="next"
        />
      </div>

      <div role="grid" aria-label={monthLabel(month)} ref={gridRef} onKeyDown={onKeyDown}>
        <div role="row" className="grid grid-cols-7 gap-1">
          {WEEKDAY_INITIALS.map((initial, index) => (
            <div
              key={WEEKDAY_NAMES[index]}
              role="columnheader"
              // The initials repeat (S/T/S/T), so the full name is the label.
              aria-label={WEEKDAY_NAMES[index]}
              className="grid h-8 place-items-center text-eyebrow uppercase text-ink-muted"
            >
              <span aria-hidden="true">{initial}</span>
            </div>
          ))}
        </div>

        {weeks.map((week, weekIndex) => (
          <div key={weekIndex} role="row" className="grid grid-cols-7 gap-1">
            {week.map((day, dayIndex) => {
              if (day === null) {
                return <div key={`blank-${dayIndex}`} role="gridcell" />;
              }

              const inWindow = day >= windowStart && day <= windowEnd;
              const isAvailable = inWindow && availableSet.has(day);
              const isSelected = day === selected;
              const isToday = day === today;
              const number = parseYmd(day).day;

              if (!isAvailable) {
                return (
                  <div
                    key={day}
                    role="gridcell"
                    aria-disabled="true"
                    // Shade alone is not a channel, so the name says why.
                    aria-label={`${longDate(day)}, unavailable`}
                    className={`grid aspect-square min-h-11 w-full place-items-center rounded-sm text-body-sm text-day-unavailable ${
                      isToday ? "ring-1 ring-inset ring-primary" : ""
                    }`}
                  >
                    <span aria-hidden="true">{number}</span>
                  </div>
                );
              }

              return (
                <div key={day} role="gridcell" aria-selected={isSelected}>
                  <button
                    type="button"
                    data-day={day}
                    // Roving tabindex: one tab stop for the grid, not 31.
                    tabIndex={day === focusedDay ? 0 : -1}
                    onClick={() => {
                      setFocusedDay(day);
                      onSelect(day);
                    }}
                    aria-label={longDate(day)}
                    className={`grid aspect-square min-h-11 w-full place-items-center rounded-sm text-body-sm transition-colors duration-120 ease-standard ${
                      isSelected
                        ? "bg-primary text-on-primary"
                        : "text-ink hover:bg-hover-wash active:bg-press-wash"
                    } ${isToday && !isSelected ? "ring-1 ring-inset ring-primary" : ""}`}
                  >
                    {number}
                  </button>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      <p className="mt-4 text-caption text-ink-muted">
        Days without an opening are shown in grey.
      </p>
    </div>
  );
}

function ArrowButton({
  label,
  disabled,
  onClick,
  direction,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  direction: "prev" | "next";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="grid size-11 shrink-0 place-items-center rounded-md text-ink transition-colors duration-120 ease-standard hover:bg-hover-wash active:bg-press-wash disabled:pointer-events-none disabled:opacity-50"
    >
      <Chevron direction={direction} className="size-5" />
    </button>
  );
}
