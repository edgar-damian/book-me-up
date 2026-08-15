/* ===========================================================================
   book-me-up — DISPLAY FORMATTERS
   ===========================================================================

   The server sends money as integer cents, durations as minutes, and opening
   hours as minutes past midnight. Nothing here talks to the API or to React —
   these are pure functions that turn those numbers into the strings a client
   reads.

   EVERY FUNCTION HERE MUST BE DETERMINISTIC. These run during SSR on the Node
   server and again in the browser during hydration; if the two disagree React
   throws away the server markup. That is why the locale is pinned rather than
   left to the host, and why the clock is arithmetic instead of a Date.
   =========================================================================== */

/** Fixed locale, not the host's: a server in one locale and a browser in
    another would render different strings and break hydration. No currency
    column exists anywhere in the schema, so USD is an assumption — the day a
    second currency appears, it belongs on Establishment or WorkerProfile and
    this signature grows a parameter. */
const USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

/** 1500 → "$15.00". Zero is named rather than priced — a $0.00 service is a
    free consultation, and "Free" is what a client is looking for. */
export function formatPrice(cents: number): string {
  return cents === 0 ? "Free" : USD.format(cents / 100);
}

/** 45 → "45 min", 60 → "1 hr", 75 → "1 hr 15 min". */
export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;

  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} hr` : `${hours} hr ${rest} min`;
}

/**
 * Minutes past midnight → a 12-hour clock. 540 → "9:00 AM".
 *
 * WorkerScheduleDay minutes are 0-1440 and are **already local to the
 * establishment's timezone** (docs/schema.md). Running them through a Date or
 * an Intl formatter with a timeZone would convert an already-converted value,
 * so this is deliberately plain arithmetic on the number.
 *
 * An end_minute of 1440 is midnight closing; it wraps to 0 and reads
 * "12:00 AM" rather than the nonsensical "24:00".
 */
export function formatTime(minute: number): string {
  const m = ((Math.trunc(minute) % 1440) + 1440) % 1440;
  const hours24 = Math.floor(m / 60);
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  const mm = String(m % 60).padStart(2, "0");

  return `${hours12}:${mm} ${hours24 < 12 ? "AM" : "PM"}`;
}

/** "America/Los_Angeles" → "Los Angeles". Only shown when a barber's shops
    span more than one timezone, where a bare "8:00 AM" at each would look
    comparable and is not. Deliberately not Intl's short name ("PST"), which
    depends on the current date's DST state and would drift between the SSR
    render and hydration. */
export function tzLabel(timezone: string): string {
  const city = timezone.split("/").pop();
  return city ? city.replace(/_/g, " ") : timezone;
}

/* --- the week ------------------------------------------------------------ */

export type ScheduleDay = {
  /** 0 = Sunday … 6 = Saturday, straight off WorkerScheduleDay.dayOfWeek. */
  day_of_week: number;
  start_minute: number;
  end_minute: number;
};

export type ScheduleRow = {
  /** "Mon–Wed", "Thu & Fri", "Mon–Wed, Sat" */
  days: string;
  /** "9:00 AM – 5:00 PM" */
  hours: string;
};

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** The data is Sunday-first; this reorders to Monday-first for display.
    A barber who works Saturday and Sunday reads "Sat & Sun" in Monday-first
    order, and the nonsense "Sun, Sat" in Sunday-first — weekend work is
    common enough in this trade that it is worth the remap. */
const weekPosition = (dayOfWeek: number) => (dayOfWeek + 6) % 7;

/** "Mon" · "Mon & Tue" · "Mon–Wed" · "Every day". Two days get an ampersand
    rather than a range because "Mon–Tue" reads like it is hiding something,
    and a full week is a sentence rather than the technically-correct
    "Mon–Sun". */
function labelRun(run: number[]): string {
  if (run.length === 7) return "Every day";

  const first = DAY_NAMES[run[0]];
  const last = DAY_NAMES[run[run.length - 1]];

  if (run.length === 1) return first;
  if (run.length === 2) return `${first} & ${last}`;
  return `${first}–${last}`;
}

/**
 * Collapse a chair's schedule days into the fewest readable lines.
 *
 * Days are grouped by *identical hours first*, then by adjacency — collapsing
 * Mon/Tue/Wed into "Mon–Wed" when Tuesday actually runs 10–6 would be a lie,
 * and the whole point of this section is that a client knows when to show up.
 * A chair with uniform hours therefore yields exactly one row, which is the
 * common case.
 *
 * Returns rows in week order. Input may be unsorted — PostgREST does not order
 * embedded rows.
 */
export function groupScheduleDays(days: ScheduleDay[]): ScheduleRow[] {
  const byHours = new Map<string, { positions: number[]; row: ScheduleDay }>();

  for (const day of days) {
    if (day.day_of_week < 0 || day.day_of_week > 6) continue;

    const key = `${day.start_minute}-${day.end_minute}`;
    const bucket = byHours.get(key);

    if (bucket) bucket.positions.push(weekPosition(day.day_of_week));
    else byHours.set(key, { positions: [weekPosition(day.day_of_week)], row: day });
  }

  const rows = [...byHours.values()].map(({ positions, row }) => {
    const sorted = [...new Set(positions)].sort((a, b) => a - b);

    // Split into consecutive runs, so a Mon/Tue/Thu/Fri barber on one set of
    // hours reads "Mon & Tue, Thu & Fri" rather than a false "Mon–Fri".
    const runs: number[][] = [];
    for (const position of sorted) {
      const current = runs[runs.length - 1];
      if (current && position === current[current.length - 1] + 1) current.push(position);
      else runs.push([position]);
    }

    return {
      earliest: sorted[0],
      days: runs
        // Back to Sunday-first indices for the name lookup.
        .map((run) => labelRun(run.map((position) => (position + 1) % 7)))
        .join(", "),
      hours: `${formatTime(row.start_minute)} – ${formatTime(row.end_minute)}`,
    };
  });

  // Earliest day first, so a multi-row shop still reads forwards through the
  // week instead of in whatever order the hours happened to appear.
  return rows
    .sort((a, b) => a.earliest - b.earliest)
    .map(({ days, hours }) => ({ days, hours }));
}
