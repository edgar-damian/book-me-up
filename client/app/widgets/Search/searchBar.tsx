import { useRef, useState } from "react";
import { IconClose, IconSearch, Spinner } from "~/widgets/kit";

export type SearchBy = "shop" | "provider" | "location";

export const SEARCH_BY: { value: SearchBy; chip: string; label: string; placeholder: string }[] = [
  { value: "shop", chip: "Shop", label: "Search shops by name", placeholder: "Shop name" },
  {
    value: "provider",
    chip: "Service Provider",
    label: "Search service providers by name",
    placeholder: "Service provider name",
  },
  { value: "location", chip: "Location", label: "Search by city", placeholder: "City" },
];

const FIELD =
  "w-full min-h-11 rounded-xs border border-border-input bg-surface py-2 pl-10 pr-12 " +
  "text-body-sm text-ink placeholder:text-ink-muted";

const SUBMIT =
  "inline-flex min-h-11 min-w-24 shrink-0 items-center justify-center rounded-md bg-primary px-4 " +
  "text-button text-on-primary transition-colors duration-120 ease-standard " +
  "hover:bg-primary-hover active:bg-primary-active";

const CLEAR =
  "absolute top-0 right-0 grid size-11 place-items-center rounded-md text-ink-muted " +
  "transition-colors duration-120 ease-standard hover:bg-hover-wash hover:text-ink " +
  "active:bg-press-wash";

// The radio is hidden, so the chip shows its state and takes the focus ring.
const CHIP =
  "inline-flex min-h-11 cursor-pointer items-center rounded-pill border border-border-input " +
  "bg-surface px-4 text-body-sm text-ink transition-colors duration-120 ease-standard " +
  "not-has-checked:hover:bg-hover-wash has-checked:border-primary has-checked:bg-primary-wash " +
  "has-checked:text-primary-text has-focus-visible:outline-2 has-focus-visible:outline-offset-2 " +
  "has-focus-visible:outline-focus-ring";

export function SearchBar({
  onSearch,
  busy = false,
  className = "",
}: {
  /** Called on submit and whenever a different chip is picked. */
  onSearch?: (by: SearchBy, text: string) => void;
  /** True while a search is loading. */
  busy?: boolean;
  className?: string;
}) {
  const [by, setBy] = useState<SearchBy>("shop");
  const [text, setText] = useState("");
  const field = useRef<HTMLInputElement>(null);
  const mode = SEARCH_BY.find((m) => m.value === by) ?? SEARCH_BY[0];

  function pick(next: SearchBy) {
    setBy(next);
    onSearch?.(next, text);
  }

  function clear() {
    setText("");
    field.current?.focus();
  }

  return (
    <form
      role="search"
      className={className}
      onSubmit={(e) => {
        e.preventDefault();
        onSearch?.(by, text);
      }}
    >
      <div className="flex gap-2">
        <div className="relative flex-1">
          <label htmlFor="search-text" className="sr-only">
            {mode.label}
          </label>
          <IconSearch className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-ink-muted" />
          <input
            ref={field}
            id="search-text"
            type="text"
            inputMode="search"
            enterKeyHint="search"
            autoComplete="off"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={mode.placeholder}
            className={FIELD}
          />
          {text && (
            <button type="button" onClick={clear} aria-label="Clear search" className={CLEAR}>
              <IconClose className="size-5" />
            </button>
          )}
        </div>
        <button type="submit" disabled={busy} aria-busy={busy} className={SUBMIT}>
          {busy ? <Spinner label="Searching…" /> : "Search"}
        </button>
      </div>

      <fieldset className="mt-4 flex flex-wrap gap-2">
        <legend className="sr-only">Search by</legend>
        {SEARCH_BY.map((m) => (
          <label key={m.value} className={CHIP}>
            <input
              type="radio"
              name="by"
              value={m.value}
              checked={by === m.value}
              onChange={() => pick(m.value)}
              className="sr-only"
            />
            {m.chip}
          </label>
        ))}
      </fieldset>
    </form>
  );
}
