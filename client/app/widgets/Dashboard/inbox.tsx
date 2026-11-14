import { useState } from "react";
import { useFetcher } from "react-router";
import type { JoinRequest } from "~/models/dashboard";
import { IconInbox, IconMail, IconPhone } from "~/widgets/kit";
import { ACCEPT, CONFIRM, Label, REJECT, STATUS } from "~/widgets/Dashboard/appointments";
import { SHEET_BUTTON, Sheet } from "~/widgets/Dashboard/sheet";

/* The requests to join the shops the worker owns, opened from the dashboard's
   Inbox by ?inbox. Each answer posts from its row through a fetcher, like a
   booking's, and the page stays put while the loaders reload behind it. */

export const JOIN_ANSWER_FORM = "answer-join-request";

const CONTACT_LINK = "inline-flex min-h-11 items-center gap-2 justify-self-start text-body-sm text-primary-text";

type Answer = "ACCEPTED" | "REJECTED";

/** One worker asking to join, with their profile and the owner's answer. */
function Request({ request: r }: { request: JoinRequest }) {
  const { worker: w, shop } = r;
  const name = `${w.first_name} ${w.last_name}`;
  // Held by the row, so a refusal still shows once the reload drops the request.
  const answer = useFetcher<{ error: string | null }>();
  const sending = answer.state === "idle" ? null : answer.formData?.get("status");
  // "kept" is the first pair again, with focus back on Decline.
  const [step, setStep] = useState<"answer" | "confirm" | "kept">("answer");
  // A settled fetcher no longer holds what it sent, so the row keeps it.
  const [sent, setSent] = useState<Answer | null>(null);
  const answered = answer.state === "idle" && answer.data?.error === null ? sent : null;

  return (
    <li className="grid gap-3 py-4 first:pt-0 last:pb-0">
      <div className="min-w-0 break-words">
        <p className="text-body-sm font-medium text-ink">{name}</p>
        <p className="text-caption text-ink-muted">Wants to join {shop.name}</p>
        {w.bio && <p className="mt-2 text-body-sm text-ink-secondary">{w.bio}</p>}
      </div>
      {(w.public_phone || w.public_email) && (
        <div className="grid">
          {w.public_phone && (
            <a href={`tel:${w.public_phone}`} className={CONTACT_LINK}>
              <IconPhone className="size-4 shrink-0" />
              {w.public_phone}
            </a>
          )}
          {w.public_email && (
            <a href={`mailto:${w.public_email}`} className={`${CONTACT_LINK} break-all`}>
              <IconMail className="size-4 shrink-0" />
              {w.public_email}
            </a>
          )}
        </div>
      )}
      {answered ? (
        <p className="flex flex-wrap items-center gap-2 text-body-sm text-ink-secondary">
          <span className={`inline-block rounded-sm px-2 py-1 text-eyebrow ${STATUS[answered].chip}`}>
            {answered === "ACCEPTED" ? "Accepted" : "Declined"}
          </span>
          {answered === "ACCEPTED" ? `${w.first_name} joined ${shop.name}` : `${w.first_name} can ask again`}
        </p>
      ) : (
        <answer.Form method="post" className="grid grid-cols-2 gap-2">
          <input type="hidden" name="intent" value={JOIN_ANSWER_FORM} />
          <input type="hidden" name="chair" value={r.id} />
          {/* Keyed, so each pair mounts fresh and autoFocus lands; nothing is focused on the first render. */}
          {step === "confirm" ? (
            <>
              <button
                key="keep"
                type="button"
                autoFocus
                disabled={!!sending}
                onClick={() => setStep("kept")}
                aria-label={`Keep the request from ${name}`}
                className={REJECT}
              >
                Keep
              </button>
              <button
                key="decline-request"
                type="submit"
                name="status"
                value="REJECTED"
                onClick={() => setSent("REJECTED")}
                aria-busy={sending === "REJECTED" || undefined}
                aria-label={`Decline the request from ${name}`}
                className={`relative ${CONFIRM} ${sending ? "pointer-events-none" : ""}`}
              >
                <Label text="Decline request" sending={sending === "REJECTED"} status="Declining…" />
              </button>
            </>
          ) : (
            <>
              <button
                key="accept"
                type="submit"
                name="status"
                value="ACCEPTED"
                onClick={() => setSent("ACCEPTED")}
                aria-busy={sending === "ACCEPTED" || undefined}
                aria-label={`Accept ${name} at ${shop.name}`}
                className={`relative ${ACCEPT} ${sending ? "pointer-events-none" : ""}`}
              >
                <Label text="Accept" sending={sending === "ACCEPTED"} status="Accepting…" />
              </button>
              <button
                key="decline"
                type="button"
                autoFocus={step === "kept"}
                disabled={!!sending}
                onClick={() => setStep("confirm")}
                aria-label={`Decline ${name} at ${shop.name}`}
                className={REJECT}
              >
                Decline
              </button>
            </>
          )}
        </answer.Form>
      )}
      {answer.data?.error && (
        <p role="alert" className="text-body-sm text-danger-text">
          {answer.data.error}
        </p>
      )}
    </li>
  );
}

export function Inbox({
  requests,
}: {
  /** The requests still waiting, oldest first. */
  requests: JoinRequest[];
}) {
  // Every request seen since the inbox opened. An answered one leaves `requests`
  // on the next reload, but its row stays to show what became of it.
  const [seen, setSeen] = useState(requests);
  const added = requests.filter((r) => !seen.some((s) => s.id === r.id));
  if (added.length) setSeen([...seen, ...added]);

  return (
    <Sheet
      title="Inbox"
      footer={(close) => (
        <button
          type="button"
          onClick={close}
          className={`${SHEET_BUTTON} col-span-2 border border-border-input bg-surface text-ink hover:bg-hover-wash active:bg-press-wash`}
        >
          Done
        </button>
      )}
    >
      {seen.length ? (
        <ul className="divide-y divide-hairline">
          {seen.map((r) => (
            <Request key={r.id} request={r} />
          ))}
        </ul>
      ) : (
        <div className="grid place-items-center gap-3 rounded-xl bg-canvas-soft px-6 py-12 text-center">
          <span className="grid size-12 place-items-center rounded-lg bg-accent-indigo-tint text-accent-indigo">
            <IconInbox />
          </span>
          <h3 className="text-heading-3 text-ink">Nothing waiting</h3>
          <p className="max-w-sm text-body-sm text-ink-muted">
            When someone asks to join your shop, their request shows up here.
          </p>
        </div>
      )}
    </Sheet>
  );
}
