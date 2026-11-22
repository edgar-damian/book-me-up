import type { SearchResult } from "~/models/search";
import { IconSearch } from "~/widgets/kit";
import type { SearchBy } from "~/widgets/Search/searchBar";
import { ShopCard } from "~/widgets/Search/shopCard";
import { WorkerCard } from "~/widgets/Search/workerCard";

type Place = { key: string; label: string };

/** A worker card in the location list only holds the shops in one city. */
function placeOf(card: SearchResult): Place {
  const place = card.kind === "shop" ? card : card.shops[0];
  if (!place) return { key: "", label: "" };
  return { key: `${place.city}|${place.state}`.toLowerCase(), label: `${place.city}, ${place.state}` };
}

/** Cards in a row that share a place. The API already sorts by place. */
function groupByPlace(cards: SearchResult[]) {
  const groups: (Place & { cards: SearchResult[] })[] = [];
  for (const card of cards) {
    const place = placeOf(card);
    const last = groups.at(-1);
    if (last?.key === place.key) last.cards.push(card);
    else groups.push({ ...place, cards: [card] });
  }
  return groups;
}

function Cards({ cards, className = "" }: { cards: SearchResult[]; className?: string }) {
  return (
    <ul className={`grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 ${className}`}>
      {cards.map((card) => (
        // A worker with shops in two cities is in the location list twice.
        <li key={`${card.kind}-${card.slug}-${placeOf(card).key}`} className="grid">
          {card.kind === "shop" ? <ShopCard shop={card} /> : <WorkerCard worker={card} />}
        </li>
      ))}
    </ul>
  );
}

function NoResults({ q }: { q: string }) {
  return (
    <div className="grid place-items-center gap-3 rounded-xl border border-hairline bg-surface px-6 py-12 text-center">
      <span className="grid size-12 place-items-center rounded-lg bg-accent-indigo-tint text-accent-indigo">
        <IconSearch />
      </span>
      <h2 className="text-heading-3 text-ink">
        {q ? `No results for "${q}"` : "Nobody is taking bookings yet"}
      </h2>
      <p className="max-w-sm text-body-sm text-ink-muted">
        {q
          ? "Check the spelling, or try Shop, Service Provider or Location instead."
          : "Check back soon."}
      </p>
    </div>
  );
}

export function SearchResults({
  by,
  q,
  results,
  error,
  busy,
}: {
  by: SearchBy;
  q: string;
  results: SearchResult[];
  error: string | null;
  busy: boolean;
}) {
  const count = `${results.length} ${results.length === 1 ? "result" : "results"}`;

  return (
    <div
      aria-busy={busy}
      className={`transition-opacity duration-200 ease-standard ${busy ? "opacity-60" : ""}`}
    >
      {error ? (
        <p role="alert" className="text-body-sm text-danger-text">
          {error}
        </p>
      ) : results.length === 0 ? (
        <NoResults q={q} />
      ) : (
        <>
          <p role="status" className="text-body-sm text-ink-secondary">
            {q ? `${count} for "${q}"` : count}
          </p>
          {by === "location" ? (
            <div className="mt-6 grid gap-10">
              {groupByPlace(results).map((group) => (
                <div key={group.key}>
                  <h2 className="text-heading-2 text-ink">{group.label}</h2>
                  <Cards cards={group.cards} className="mt-4" />
                </div>
              ))}
            </div>
          ) : (
            <Cards cards={results} className="mt-6" />
          )}
        </>
      )}
    </div>
  );
}
