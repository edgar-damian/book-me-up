import { Link } from "react-router";
import { IconMapPin, IconStorefront, ImageTile } from "~/widgets/kit";
import type { SearchResultShop } from "~/models/search";

const CARD =
  "relative overflow-hidden rounded-lg border border-hairline bg-surface " +
  "transition-colors duration-120 ease-standard hover:bg-hover-wash";

const TAG =
  "absolute top-3 left-3 rounded-pill border border-hairline bg-surface px-2 py-1 " +
  "text-eyebrow text-ink";

export function ShopCard({ shop }: { shop: SearchResultShop }) {
  return (
    <div className={CARD}>
      <ImageTile
        src={shop.images[0] ?? null}
        className="aspect-video w-full"
        fallback={<IconStorefront className="size-8 text-ink-muted" />}
      />
      <span className={TAG}>Shop</span>
      <div className="p-4">
        {/* The name is the card's one link, stretched over the whole card. */}
        <p className="text-title text-ink">
          <Link to={`/shops/${shop.slug}`} className="after:absolute after:inset-0">
            {shop.name}
          </Link>
        </p>
        <p className="mt-2 flex gap-2 text-body-sm text-ink-secondary">
          <IconMapPin className="mt-0.5 size-4 shrink-0" />
          <span>
            {shop.address}
            <br />
            {shop.city}, {shop.state} {shop.zip}
          </span>
        </p>
      </div>
    </div>
  );
}
