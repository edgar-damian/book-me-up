import { IconChevronRight } from "~/widgets/kit";

export const CARD = "w-full max-w-sm rounded-xl border border-hairline bg-surface";
export const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));
export const LONG_DAY: Intl.DateTimeFormatOptions = { weekday: "long", month: "long", day: "numeric" };
export const TIME: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" };

/** A `YYYY-MM-DD` local day, e.g. "Tuesday, September 16". */
export function fmtDay(day: string, opts: Intl.DateTimeFormatOptions) {
  const [y, m, d] = day.split("-").map(Number);
  return utc(y, m, d).toLocaleDateString("en-US", { timeZone: "UTC", ...opts });
}

/** An ISO instant on the shop's clock, e.g. "9:15 AM". */
export const fmtInstant = (iso: string, timeZone: string, opts: Intl.DateTimeFormatOptions) =>
  new Date(iso).toLocaleString("en-US", { timeZone, ...opts });

/** Ghost icon-only button. `label` is its accessible name; nothing is visible but the icon. */
export function IconButton({
  label,
  onClick,
  disabled = false,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={`grid size-11 shrink-0 place-items-center rounded-md transition-colors duration-120 ease-standard ${
        disabled ? "text-ink-faint" : "text-ink hover:bg-hover-wash active:bg-press-wash"
      }`}
    >
      {children}
    </button>
  );
}

/** The way back that every step after the first carries. */
export const BackButton = ({ label, onClick }: { label: string; onClick: () => void }) => (
  <IconButton label={label} onClick={onClick}>
    <IconChevronRight className="size-5 rotate-180" />
  </IconButton>
);
