import { useNavigation } from "react-router";
import { Container, IconInbox } from "~/widgets/kit";
import { SiteHeader } from "~/widgets/siteHeader";
import { CompanyFooter } from "~/widgets/companyFooter";
import { EditDialog, type Editing } from "~/widgets/Dashboard/editDialog";
import { ShopSwitcher } from "~/widgets/Dashboard/shopSwitcher";
import { UpcomingWeek } from "~/widgets/Dashboard/appointments";
import type { JoinRequest, MyChair, MyWeek, TimeOffConflict } from "~/models/dashboard";

type Props = {
  /** Every shop the worker works at, or has asked to join. */
  chairs: MyChair[];
  /** The shop whose week is showing, or null until a shop accepts the worker. */
  chair: MyChair | null;
  week: MyWeek | null;
  /** Workers waiting to join the shops the worker owns. */
  requests: JoinRequest[];
  /** The part of the setup the header's links open, from ?edit=. */
  editing: Editing | null;
  /** Why the last save was refused. */
  error: string | null;
  /** The bookings that time off just saved falls on. */
  conflicts: TimeOffConflict[] | null;
};

export function Dashboard({ chairs, chair, week, requests, editing, error, conflicts }: Props) {
  // formMethod stays "POST" through the redirect that closes the dialog.
  const busy = useNavigation().formMethod === "POST";
  const shops = chairs.filter((c) => c.is_active);
  const waiting = chairs.find((c) => !c.is_active);
  const unanswered = requests.length;

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
              <div className="flex items-center justify-between gap-4">
                <h1 className="text-heading-2 text-ink">Upcoming appointments</h1>
                <button
                  type="button"
                  aria-label={unanswered ? `Inbox, ${unanswered} ${unanswered === 1 ? "request" : "requests"}` : "Inbox"}
                  className="relative inline-flex size-11 shrink-0 items-center justify-center rounded-md border border-border-input bg-surface text-ink transition-colors duration-120 ease-standard hover:bg-hover-wash active:bg-press-wash"
                >
                  <IconInbox className="size-5" />
                  {unanswered > 0 && (
                    <span
                      aria-hidden="true"
                      className="absolute -top-1.5 -right-1.5 grid h-5 min-w-5 place-items-center rounded-pill bg-badge px-1 text-eyebrow text-on-badge ring-2 ring-canvas-soft"
                    >
                      {unanswered > 9 ? "9+" : unanswered}
                    </span>
                  )}
                </button>
              </div>
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
