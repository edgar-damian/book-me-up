import type { SearchResult } from "~/models/search";
import { Container } from "~/widgets/kit";
import { SiteHeader } from "~/widgets/siteHeader";
import { CompanyFooter } from "~/widgets/companyFooter";
import { SearchBar, type SearchBy } from "~/widgets/Search/searchBar";
import { SearchResults } from "~/widgets/Search/searchResults";

export function Search({
  by,
  q,
  results,
  error,
  busy,
  onSearch,
}: {
  /** What the results below were searched by, and for. */
  by: SearchBy;
  q: string;
  results: SearchResult[];
  /** Why the last search failed, if it did. */
  error: string | null;
  /** True while a new search is loading. */
  busy: boolean;
  onSearch: (by: SearchBy, text: string) => void;
}) {
  return (
    <div className="overflow-x-clip bg-canvas-soft text-ink">
      <SiteHeader company />
      <main>
        <section className="pt-16 pb-12 md:pt-24 lg:pt-32">
          <Container>
            <h1 className="font-display text-display-1 text-ink">Find your next appointment</h1>
            <p className="mt-4 max-w-2xl text-body-md text-ink-secondary">
              Search shops, service providers, or cities.
            </p>
            <SearchBar className="mt-8 max-w-2xl" busy={busy} onSearch={onSearch} />
          </Container>
        </section>
        <section className="pb-16 md:pb-24 lg:pb-32">
          <Container>
            <div className="border-t border-hairline pt-8">
              <SearchResults by={by} q={q} results={results} error={error} busy={busy} />
            </div>
          </Container>
        </section>
      </main>
      <CompanyFooter />
    </div>
  );
}
