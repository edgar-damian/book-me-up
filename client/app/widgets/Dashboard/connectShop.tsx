import { useState } from "react";
import { Form } from "react-router";
import { Input, toSlug } from "~/widgets/kit";
import type { MyChair } from "~/models/dashboard";

/* Asks a shop to take the worker on. The request waits, inactive, until the
   shop's owner accepts it. Like the profile form there is no submit button
   here: any button with form={SHOP_FORM}, like the wizard's Next, submits it. */

export const SHOP_FORM = "connect-shop";

const CHIP = "rounded-sm px-2 py-1 text-eyebrow";

export function ConnectShopForm({
  chairs,
  error,
}: {
  /** Shops the worker works at, or has asked to join. */
  chairs: MyChair[];
  /** Form-level failure from the last submit, shown at the end of the form. */
  error: string | null;
}) {
  const [problem, setProblem] = useState<string>();

  // Tidies the link in place, then shows what is wrong with it, if anything.
  function check(input: HTMLInputElement) {
    input.value = toSlug(input.value);
    const found = input.value ? undefined : "Enter your shop's link";
    setProblem(found);
    return found;
  }

  function submit(e: React.SubmitEvent<HTMLFormElement>) {
    const input = e.currentTarget.elements.namedItem("slug") as HTMLInputElement;
    if (check(input) === undefined) return;
    e.preventDefault();
    input.focus();
  }

  // A request still waiting is the one the worker came back to change.
  const current = chairs.find((c) => !c.is_active) ?? chairs[0];

  return (
    <Form id={SHOP_FORM} method="post" noValidate onSubmit={submit} className="grid gap-4 text-body-sm">
      <input type="hidden" name="intent" value={SHOP_FORM} />
      <p className="text-ink-secondary">
        Enter your shop's link and we'll send the owner a request. You can keep setting up while you wait.
      </p>

      {chairs.length > 0 && (
        <ul className="grid gap-2">
          {chairs.map((c) => (
            <li
              key={c.shop.slug}
              className="flex items-center justify-between gap-3 rounded-md border border-hairline px-3 py-2"
            >
              <span className="text-ink">{c.shop.name}</span>
              <span
                className={`${CHIP} ${
                  c.is_active
                    ? "bg-status-accepted-tint text-status-accepted"
                    : "bg-status-pending-tint text-status-pending"
                }`}
              >
                {c.is_active ? "Joined" : "Waiting"}
              </span>
            </li>
          ))}
        </ul>
      )}

      <Input
        name="slug"
        label="Shop link"
        defaultValue={current?.shop.slug ?? ""}
        maxLength={60}
        autoCapitalize="none"
        autoComplete="off"
        spellCheck={false}
        required
        onBlur={(e) => check(e.target)}
        error={problem}
        help="The end of the shop page's address, like main-street-studio."
      />

      {error && (
        <p role="alert" className="text-danger-text">
          {error}
        </p>
      )}
    </Form>
  );
}
