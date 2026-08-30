const TIME: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" };
const HOUR: Intl.DateTimeFormatOptions = { hour: "numeric", hour12: false };
const DEADLINE: Intl.DateTimeFormatOptions = {
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
};
const YMD: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
};

const formatters = new Map<string, Intl.DateTimeFormat>();

// Locale pinned, not the host's: a server and browser in different locales would
// render different strings. Cached — a slot list makes 40 calls.
function formatter(name: string, timeZone: string, options: Intl.DateTimeFormatOptions) {
  const key = `${name}|${timeZone}`;
  let cached = formatters.get(key);
  if (!cached) {
    cached = new Intl.DateTimeFormat("en-US", { timeZone, ...options });
    formatters.set(key, cached);
  }
  return cached;
}

export function slotTime(instant: string, timeZone: string): string {
  return formatter("time", timeZone, TIME).format(new Date(instant));
}

export function slotRange(start: string, end: string, timeZone: string): string {
  return `${slotTime(start, timeZone)} – ${slotTime(end, timeZone)}`;
}

export function deadline(instant: string, timeZone: string): string {
  return formatter("deadline", timeZone, DEADLINE).format(new Date(instant));
}

export type Period = "Morning" | "Afternoon" | "Evening";

export function slotPeriod(instant: string, timeZone: string): Period {
  // Some ICU builds emit "24" for midnight; modulo folds it back.
  const hour = Number(formatter("hour", timeZone, HOUR).format(new Date(instant))) % 24;
  if (hour < 12) return "Morning";
  if (hour < 17) return "Afternoon";
  return "Evening";
}

export function groupByPeriod<T extends { start_time: string }>(
  slots: T[],
  timeZone: string,
): { period: Period; slots: T[] }[] {
  const order: Period[] = ["Morning", "Afternoon", "Evening"];
  const buckets = new Map<Period, T[]>();

  for (const slot of slots) {
    const period = slotPeriod(slot.start_time, timeZone);
    const bucket = buckets.get(period);
    if (bucket) bucket.push(slot);
    else buckets.set(period, [slot]);
  }

  return order
    .filter((period) => buckets.has(period))
    .map((period) => ({ period, slots: buckets.get(period)! }));
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// Sunday-first, matching the grid and the DB's day_of_week.
export const WEEKDAY_INITIALS = ["S", "M", "T", "W", "T", "F", "S"];
export const WEEKDAY_NAMES = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
];

export type Month = { year: number; month: number /* 0-11 */ };

export function parseYmd(ymd: string): { year: number; month: number; day: number } {
  const [year, month, day] = ymd.split("-").map(Number);
  return { year, month: month - 1, day };
}

export function toYmd(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function monthOf(ymd: string): Month {
  const { year, month } = parseYmd(ymd);
  return { year, month };
}

export function monthOrdinal({ year, month }: Month): number {
  return year * 12 + month;
}

export function addMonths(month: Month, delta: number): Month {
  const ordinal = monthOrdinal(month) + delta;
  return { year: Math.floor(ordinal / 12), month: ((ordinal % 12) + 12) % 12 };
}

export function monthLabel({ year, month }: Month): string {
  return `${MONTHS[month]} ${year}`;
}

export function longDate(ymd: string): string {
  const { month, day } = parseYmd(ymd);
  return `${WEEKDAY_NAMES[weekdayOf(ymd)]}, ${MONTHS[month]} ${day}`;
}

export function shortDate(ymd: string): string {
  const { month, day } = parseYmd(ymd);
  return `${MONTHS[month]} ${day}`;
}

// 0 = Sunday .. 6 = Saturday. Date.UTC, so there is no offset to get wrong.
export function weekdayOf(ymd: string): number {
  const { year, month, day } = parseYmd(ymd);
  return new Date(Date.UTC(year, month, day)).getUTCDay();
}

function daysInMonth({ year, month }: Month): number {
  // Day 0 of next month is the last day of this one.
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

// Blanks are null, not the neighbouring month's digits, which read as unavailable days.
export function monthMatrix(month: Month): (string | null)[][] {
  const total = daysInMonth(month);
  const lead = weekdayOf(toYmd(month.year, month.month, 1));

  const cells: (string | null)[] = Array(lead).fill(null);
  for (let day = 1; day <= total; day++) {
    cells.push(toYmd(month.year, month.month, day));
  }
  while (cells.length % 7 !== 0) cells.push(null);

  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

export function shiftYmd(ymd: string, delta: number, min: string, max: string): string {
  const { year, month, day } = parseYmd(ymd);
  const moved = new Date(Date.UTC(year, month, day + delta));
  const next = toYmd(moved.getUTCFullYear(), moved.getUTCMonth(), moved.getUTCDate());
  if (next < min) return min;
  if (next > max) return max;
  return next;
}

function ymdOf(at: Date, timeZone: string): string {
  const parts = formatter("ymd", timeZone, YMD).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function ymdIn(instant: string, timeZone: string): string {
  return ymdOf(new Date(instant), timeZone);
}

// The one function here that reads the clock: call it in a loader or resource
// route only, never during render.
export function todayIn(timeZone: string): string {
  return ymdOf(new Date(), timeZone);
}

// The DB's appointment_phone_e164_ck verbatim, so anything this file accepts
// cannot be rejected by Postgres.
export const E164 = /^\+[1-9]\d{1,14}$/;

// The +1 default is deliberate: the rest of the schema is US-shaped (state, zip,
// USD). Elsewhere is served by typing the country code.
export function normalizePhone(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;

  if (trimmed.startsWith("+")) {
    const e164 = `+${trimmed.slice(1).replace(/\D/g, "")}`;
    return E164.test(e164) ? e164 : null;
  }

  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

export function displayPhone(e164: string): string {
  const us = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164);
  return us ? `(${us[1]}) ${us[2]}-${us[3]}` : e164;
}
