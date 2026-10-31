import { useNavigation } from "react-router";
import { Container } from "~/widgets/kit";
import { SiteHeader } from "~/widgets/siteHeader";
import { CompanyFooter } from "~/widgets/companyFooter";
import { EditDialog, type Editing } from "~/widgets/Dashboard/editDialog";
import type { Me } from "~/models/auth";

type Props = {
  me: Me;
  /** The part of the setup the header's links open, from ?edit=. */
  editing: Editing | null;
  /** Why the last save was refused. */
  error: string | null;
};

export function Dashboard({ me, editing, error }: Props) {
  // formMethod stays "POST" through the redirect that closes the dialog.
  const busy = useNavigation().formMethod === "POST";

  return (
    <div className="overflow-x-clip bg-canvas-soft text-ink">
      <SiteHeader shop />
      <main>
        <section className="py-16 md:py-24 lg:py-32">
          <Container>
            <h1 className="font-display text-display-1 text-ink">Dashboard</h1>
            <p className="mt-6 max-w-2xl text-pretty text-body-md text-ink-secondary">
              Hi, {me.first_name}. You're logged in.
            </p>
          </Container>
        </section>
      </main>
      <CompanyFooter />
      {editing && <EditDialog editing={editing} error={error} busy={busy} />}
    </div>
  );
}
