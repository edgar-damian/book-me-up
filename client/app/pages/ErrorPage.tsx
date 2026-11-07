import { Container, Cta } from "~/widgets/kit";
import { SiteHeader } from "~/widgets/siteHeader";
import { CompanyFooter } from "~/widgets/companyFooter";

/** What the root error boundary shows. */
export function ErrorPage({ title, details }: { title: string; details: string }) {
  return (
    <div className="flex min-h-dvh flex-col overflow-x-clip bg-canvas-soft text-ink">
      <SiteHeader company />
      <main className="flex-1">
        <section className="py-16 md:py-24 lg:py-32">
          <Container>
            <h1 className="font-display text-display-1 text-ink">{title}</h1>
            <p className="mt-6 max-w-2xl text-pretty text-body-md text-ink-secondary">{details}</p>
            <Cta href="/" className="mt-8">
              Go home
            </Cta>
          </Container>
        </section>
      </main>
      <CompanyFooter />
    </div>
  );
}
