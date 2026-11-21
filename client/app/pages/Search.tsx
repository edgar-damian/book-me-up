import { Container } from "~/widgets/kit";
import { SiteHeader } from "~/widgets/siteHeader";
import { CompanyFooter } from "~/widgets/companyFooter";
import { SearchBar } from "~/widgets/Search/searchBar";

export function Search() {
  return (
    <div className="overflow-x-clip bg-canvas-soft text-ink">
      <SiteHeader company />
      <main>
        <section className="py-16 md:py-24 lg:py-32">
          <Container>
            <h1 className="font-display text-display-1 text-ink">Find your next appointment</h1>
            <p className="mt-4 max-w-2xl text-body-md text-ink-secondary">
              Search shops, service providers, or cities.
            </p>
            <SearchBar className="mt-8 max-w-2xl" />
          </Container>
        </section>
      </main>
      <CompanyFooter />
    </div>
  );
}
