import { useEffect, useState } from "react";
import { Link } from "react-router";
import type { MyChair, MyService } from "~/models/dashboard";

/* The last step. A worker's page goes live on its own once their shop approves
   them, so this only says which side of that they are on. Laid out like the
   booking confirmation: a status chip, what it means, then the details. */

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const listOf = new Intl.ListFormat("en-US", { type: "conjunction" });

const CHIP = "justify-self-start rounded-sm px-2 py-1 text-eyebrow";
const BUTTON =
  "inline-flex min-h-11 w-full items-center justify-center rounded-md px-4 py-2 text-button " +
  "transition-colors duration-120 ease-standard";
const PRIMARY = `${BUTTON} bg-primary text-on-primary hover:bg-primary-hover active:bg-primary-active`;
const SECONDARY = `${BUTTON} border border-border-input bg-surface text-ink hover:bg-hover-wash active:bg-press-wash`;

export function GoLive({
  live,
  chairs,
  chair,
  services,
  slug,
}: {
  /** True once the worker's page is public. */
  live: boolean;
  /** Every shop the worker works at, or has asked to join. */
  chairs: MyChair[];
  /** The request the worker is waiting on, else their first chair. */
  chair: MyChair | null;
  services: MyService[];
  /** The end of the worker's page address. */
  slug: string;
}) {
  const path = `/view-services/${slug}`;
  // The browser knows the address clients use; behind a proxy the server may not.
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);

  if (!live) {
    return (
      <div className="grid gap-4 text-body-sm">
        <span className={`${CHIP} bg-status-pending-tint text-status-pending`}>Waiting</span>
        <p className="text-body-md text-ink">
          We're waiting for {chair?.shop.name ?? "your shop"} to approve you.
        </p>
        <p className="text-ink-secondary">
          No further steps are needed. Your booking page goes live on its own as soon as they do.
        </p>
        <Link to="/dashboard" className={PRIMARY}>
          Go to dashboard
        </Link>
        <Link to="?step=live" className={SECONDARY}>
          Check again
        </Link>
      </div>
    );
  }

  const joined = chairs.filter((c) => c.is_active).map((c) => c.shop.name);
  return (
    <div className="grid gap-4 text-body-sm">
      <span className={`${CHIP} bg-status-accepted-tint text-status-accepted`}>Live</span>
      <p className="text-body-md text-ink">Your booking page is live.</p>
      <p className="text-ink-secondary">
        You're set up at {joined.length ? listOf.format(joined) : "your shop"} with these services:
      </p>
      <ul className="grid gap-2">
        {services.map((s) => (
          <li key={s.id} className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 text-ink">{s.title}</span>
            <span className="shrink-0 text-ink-muted">
              {money.format(s.price_cents / 100)} · {s.duration_min} min
            </span>
          </li>
        ))}
      </ul>
      <div>
        <p className="mb-1 text-ink-secondary">Your booking link</p>
        <Link to={path} className="break-all text-primary-text underline underline-offset-2">
          {origin}
          {path}
        </Link>
      </div>
      <p className="text-ink-muted">You can change any of this later.</p>
      <Link to="/dashboard" className={PRIMARY}>
        Go to dashboard
      </Link>
      <Link to={path} className={SECONDARY}>
        See your page
      </Link>
    </div>
  );
}
