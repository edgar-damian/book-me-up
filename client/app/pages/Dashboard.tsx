import { Container } from "~/widgets/kit";
import { SiteHeader } from "~/widgets/siteHeader";
import { CompanyFooter } from "~/widgets/companyFooter";

export function Dashboard({ firstName }: { firstName: string }) {
  return (
    <div className="overflow-x-clip bg-canvas-soft text-ink">
      <SiteHeader company />
      <main>
        <section className="py-16 md:py-24 lg:py-32">
          <Container>
            <h1 className="font-display text-display-1 text-ink">Dashboard</h1>
            <p className="mt-6 max-w-2xl text-pretty text-body-md text-ink-secondary">
              Hi, {firstName}. You're logged in.
            </p>
          </Container>
        </section>
      </main>
      <CompanyFooter />
    </div>
  );
}
