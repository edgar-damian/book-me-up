import { Link } from "react-router";
import { IconUser, ImageTile } from "~/widgets/kit";
import type { SearchResultWorker } from "~/models/search";

const CARD =
  "relative flex flex-col items-center rounded-lg border border-hairline bg-surface " +
  "px-6 pt-12 pb-6 text-center transition-colors duration-120 ease-standard hover:bg-hover-wash";

const TAG =
  "absolute top-3 left-3 rounded-pill border border-hairline bg-surface px-2 py-1 " +
  "text-eyebrow text-ink";

export function WorkerCard({ worker }: { worker: SearchResultWorker }) {
  return (
    <div className={CARD}>
      <span className={TAG}>Service Provider</span>
      <ImageTile
        src={worker.image}
        className="size-20 rounded-pill"
        fallback={<IconUser className="size-8 text-ink-muted" />}
      />
      {/* The name is the card's one link, stretched over the whole card. */}
      <p className="mt-4 text-title text-ink">
        <Link to={`/view-services/${worker.slug}`} className="after:absolute after:inset-0">
          {worker.first_name} {worker.last_name}
        </Link>
      </p>
      {worker.shops.length > 0 && (
        <p className="mt-1 text-body-sm text-ink-secondary">
          at <span className="text-ink">{worker.shops.map((shop) => shop.name).join(", ")}</span>
        </p>
      )}
      <span className="mt-auto pt-4 text-body-sm text-primary-text">View services</span>
    </div>
  );
}
