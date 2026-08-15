import { IconMenuList, ImageTile } from "~/widgets/kit";
import { formatDuration, formatPrice } from "~/widgets/format";

/* ===========================================================================
   SERVICE CARD — one thing a barber will do, and what it costs.

   Matches WorkerLandingPage.Services in
   server/src/server/models/public_models.py. snake_case because that is what
   FastAPI actually sends — there is no alias generator on the model.

   `buffer_after_min` is deliberately not in the public model: the buffer is
   the barber's cleanup time and belongs on their calendar, not on a price
   list. The duration shown here is the duration the client is quoted.
   =========================================================================== */

export type Service = {
  id: string;
  worker_id: string;
  title: string;
  description: string;
  image: string | null;
  price_cents: number;
  duration_min: number;
  is_active: boolean;
};

export function ServiceCard({ service }: { service: Service }) {
  return (
    <article className="flex flex-col gap-4 rounded-lg border border-hairline bg-surface p-6">
      <div className="flex items-start gap-4">
        <ImageTile
          src={service.image}
          className="size-16 rounded-lg"
          // A generic "item on a menu", not scissors: services here are just
          // as likely to be a fill set or a lash lift, and an icon that reads
          // barbershop tells half the market the product is not for them.
          fallback={<IconMenuList className="size-7 text-ink-faint" />}
        />

        <div className="min-w-0 flex-1">
          <h3 className="text-heading-3 text-ink">{service.title}</h3>
          {/* description is non-null at the DB level — it defaults to '' — so
              an empty one collapses rather than rendering a stray gap. */}
          {service.description !== "" && (
            <p className="mt-1 text-body-sm text-ink-muted">
              {service.description}
            </p>
          )}
        </div>
      </div>

      <div className="mt-auto flex flex-wrap items-center justify-between gap-3">
        <p className="text-body-sm text-ink-secondary">
          <span className="text-ink">{formatPrice(service.price_cents)}</span>
          <span aria-hidden="true"> · </span>
          {formatDuration(service.duration_min)}
        </p>

        {/* Utility chrome rather than a primary fill: there is one primary per
            view, and a grid of ten filled buttons is ten things shouting.
            Inert until the booking flow exists — the section header says so,
            so this is not a control that silently does nothing. Wiring it up
            later is a <button> → <Link> swap. */}
        <button
          type="button"
          disabled
          className="inline-flex min-h-11 items-center justify-center rounded-md border border-border-input bg-surface px-4 py-2 text-button text-ink transition-colors duration-120 ease-standard hover:bg-hover-wash active:bg-press-wash disabled:pointer-events-none disabled:opacity-50"
        >
          Book
        </button>
      </div>
    </article>
  );
}
