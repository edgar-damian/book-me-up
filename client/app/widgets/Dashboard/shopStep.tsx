import { AddShopForm } from "~/widgets/Dashboard/addShop";
import { ConnectShopForm } from "~/widgets/Dashboard/connectShop";
import type { MyChair } from "~/models/dashboard";

/* The shop step: join a shop already on book-me-up, or add a new one. Only the
   chosen form is mounted, so the wizard's Next has one form to submit. The
   radios sit outside both forms and are never posted. */

const CARD =
  "flex cursor-pointer gap-3 rounded-md border border-border-input bg-surface p-4 " +
  "transition-colors duration-120 ease-standard not-has-checked:hover:bg-hover-wash " +
  "has-checked:border-primary has-checked:bg-primary-wash";

const CHOICES = [
  { add: false, id: "shop-join", title: "Join a shop", note: "Your shop is already on book-me-up." },
  { add: true, id: "shop-add", title: "Add my shop", note: "You run your own place and it isn't here yet." },
];

export function ShopStep({
  adding,
  onChoose,
  chairs,
  error,
}: {
  /** True while "Add my shop" is picked. */
  adding: boolean;
  onChoose: (add: boolean) => void;
  /** Shops the worker works at, or has asked to join. */
  chairs: MyChair[];
  /** Form-level failure from the last submit. */
  error: string | null;
}) {
  return (
    <div className="grid gap-6">
      <fieldset className="grid min-w-0 gap-3 text-body-sm sm:grid-cols-2">
        <legend className="sr-only">Join a shop or add yours</legend>
        {CHOICES.map((c) => (
          <label key={c.id} className={CARD}>
            <input
              type="radio"
              name="shop-choice"
              checked={adding === c.add}
              onChange={() => onChoose(c.add)}
              aria-labelledby={`${c.id}-title`}
              aria-describedby={`${c.id}-note`}
              className="mt-0.5 size-4 shrink-0 accent-primary"
            />
            <span>
              <span id={`${c.id}-title`} className="block text-ink">
                {c.title}
              </span>
              <span id={`${c.id}-note`} className="mt-1 block text-caption text-ink-muted">
                {c.note}
              </span>
            </span>
          </label>
        ))}
      </fieldset>

      {adding ? <AddShopForm error={error} /> : <ConnectShopForm chairs={chairs} error={error} />}
    </div>
  );
}
