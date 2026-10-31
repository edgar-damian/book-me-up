import { Link } from "react-router";
import type { MyChair } from "~/models/dashboard";

const SHOP =
  "inline-flex min-h-11 items-center rounded-md border bg-surface px-3 text-body-sm " +
  "transition-colors duration-120 ease-standard";

/** A link per shop, for a worker at more than one. The current shop is marked. */
export function ShopSwitcher({
  chairs,
  chair,
  to,
  replace = false,
  className = "",
}: {
  chairs: MyChair[];
  chair: MyChair;
  /** Where each shop's link goes. */
  to: (chair: MyChair) => string;
  replace?: boolean;
  className?: string;
}) {
  return (
    <nav aria-label="Shops" className={className}>
      <ul className="flex flex-wrap gap-2">
        {chairs.map((c) => (
          <li key={c.id}>
            <Link
              to={to(c)}
              replace={replace}
              preventScrollReset
              aria-current={c.id === chair.id ? "true" : undefined}
              className={`${SHOP} ${
                c.id === chair.id
                  ? "border-primary text-primary-text"
                  : "border-border-input text-ink hover:bg-hover-wash active:bg-press-wash"
              }`}
            >
              {c.shop.name}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
