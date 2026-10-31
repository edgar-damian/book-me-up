import { useNavigation } from "react-router";
import { Container } from "~/widgets/kit";
import { SiteHeader } from "~/widgets/siteHeader";
import { CompanyFooter } from "~/widgets/companyFooter";
import { EditDialog, type Editing } from "~/widgets/Dashboard/editDialog";
import { ShopSwitcher } from "~/widgets/Dashboard/shopSwitcher";
import { UpcomingWeek } from "~/widgets/Dashboard/appointments";
import type { MyChair, MyWeek, TimeOffConflict } from "~/models/dashboard";

type Props = {
  /** Every shop the worker works at, or has asked to join. */
  chairs: MyChair[];
  /** The shop whose week is showing, or null until a shop accepts the worker. */
  chair: MyChair | null;
  week: MyWeek | null;
  /** The part of the setup the header's links open, from ?edit=. */
  editing: Editing | null;
  /** Why the last save was refused. */
  error: string | null;
  /** The bookings that time off just saved falls on. */
  conflicts: TimeOffConflict[] | null;
};

export function Dashboard({ chairs, chair, week, editing, error, conflicts }: Props) {
  // formMethod stays "POST" through the redirect that closes the dialog.
  const busy = useNavigation().formMethod === "POST";
  const shops = chairs.filter((c) => c.is_active);
  const waiting = chairs.find((c) => !c.is_active);

  return (
    <div className="overflow-x-clip bg-canvas-soft text-ink">
      <SiteHeader shop />
      <main>
        <section className="py-8 md:py-12">
          <Container>
            <div className="max-w-4xl">
              {chair && shops.length > 1 && (
                <ShopSwitcher chairs={shops} chair={chair} to={(c) => `?chair=${c.id}`} className="mb-6" />
              )}
              <h1 className="text-heading-2 text-ink">Upcoming appointments</h1>
              {week ? (
                <UpcomingWeek week={week} />
              ) : (
                <p className="mt-1 text-body-sm text-ink-secondary">
                  We're waiting for {waiting?.shop.name ?? "your shop"} to approve you.
                </p>
              )}
            </div>
          </Container>
        </section>
      </main>
      <CompanyFooter />
      {editing && <EditDialog editing={editing} error={error} conflicts={conflicts} busy={busy} />}
    </div>
  );
}
