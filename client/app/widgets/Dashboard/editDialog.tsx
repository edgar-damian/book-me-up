import { useId, useLayoutEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { Spinner } from "~/widgets/kit";
import { STEPS } from "~/widgets/Dashboard/onboarding";
import { ShopSwitcher } from "~/widgets/Dashboard/shopSwitcher";
import { PROFILE_FORM, WorkerProfileForm } from "~/widgets/Dashboard/workerProfile";
import { HOURS_FORM, WorkerHoursForm } from "~/widgets/Dashboard/schedule";
import { SERVICES_FORM, ServicesForm } from "~/widgets/Dashboard/services";
import type { MyChair, MyService, SaveWorkerProfile } from "~/models/dashboard";

/* One part of a worker's setup, reopened from the dashboard: a bottom sheet on a
   phone, a centered card from md up. The forms are the onboarding steps' own,
   and Save submits the open one by id, like the wizard's Next. Which part is
   open comes from ?edit=, so closing is a navigation. */

/** The part being edited, with only what its form needs. */
export type Editing =
  | { edit: "profile"; profile: SaveWorkerProfile }
  | {
      edit: "schedule";
      /** Every shop the worker works at, or has asked to join. */
      chairs: MyChair[];
      /** The shop whose hours are open. */
      chair: MyChair;
    }
  | { edit: "services"; services: MyService[] };

// The form each part's Save submits.
const FORMS: Record<Editing["edit"], string> = {
  profile: PROFILE_FORM,
  schedule: HOURS_FORM,
  services: SERVICES_FORM,
};

// How far the handle has to be pulled down before letting go closes the sheet.
const DISMISS_PX = 96;

const BUTTON =
  "inline-flex min-h-11 w-full items-center justify-center rounded-md px-4 py-2 text-button " +
  "transition-colors duration-120 ease-standard disabled:pointer-events-none disabled:opacity-50";

function EditBody({ editing, error }: { editing: Editing; error: string | null }) {
  if (editing.edit === "profile") return <WorkerProfileForm profile={editing.profile} error={error} />;
  if (editing.edit === "services") return <ServicesForm services={editing.services} error={error} />;
  return (
    <>
      {/* A worker at two shops can set the hours at each. */}
      {editing.chairs.length > 1 && (
        <ShopSwitcher
          chairs={editing.chairs}
          chair={editing.chair}
          to={(c) => `?edit=schedule&chair=${c.id}`}
          replace
          className="mb-4"
        />
      )}
      {/* Keyed by chair, so another shop's form starts from that shop's hours. */}
      <WorkerHoursForm key={editing.chair.id} chair={editing.chair} error={error} />
    </>
  );
}

export function EditDialog({
  editing,
  error,
  busy,
}: {
  editing: Editing;
  /** Form-level failure from the last save, shown at the end of the form. */
  error: string | null;
  /** True from Save until the redirect that closes the dialog lands. */
  busy: boolean;
}) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const titleId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const pressedOutside = useRef(false);
  const dragFrom = useRef<number | null>(null);

  // A layout effect's cleanup runs while the dialog is still in the page, so
  // close() can return focus to whatever opened it. The title takes focus
  // rather than the first field, which would raise a phone's keyboard.
  useLayoutEffect(() => {
    const dialog = dialogRef.current!;
    dialog.showModal();
    titleRef.current!.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      dialog.close();
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  // Shuts at once instead of waiting on the dashboard's loader, and keeps the
  // shop ?chair= names.
  function close() {
    if (busy) return;
    dialogRef.current?.close();
    const chair = params.get("chair");
    navigate(chair ? `/dashboard?chair=${encodeURIComponent(chair)}` : "/dashboard", {
      preventScrollReset: true,
    });
  }

  // Only a press that starts and ends on the scrim closes the dialog: a text
  // selection dragged out of a field also ends in a click there.
  const outside = (e: React.SyntheticEvent) => !panelRef.current?.contains(e.target as Node);

  function grab(e: React.PointerEvent<HTMLDivElement>) {
    if (busy) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragFrom.current = e.clientY;
    panelRef.current!.style.transition = "none";
  }

  function pull(e: React.PointerEvent<HTMLDivElement>) {
    if (dragFrom.current === null) return;
    panelRef.current!.style.transform = `translateY(${Math.max(0, e.clientY - dragFrom.current)}px)`;
  }

  // Past DISMISS_PX the sheet closes; short of it, it springs back.
  function letGo(e: React.PointerEvent<HTMLDivElement>) {
    if (dragFrom.current === null) return;
    const far = e.type === "pointerup" && e.clientY - dragFrom.current > DISMISS_PX;
    dragFrom.current = null;
    panelRef.current!.style.transition = "";
    if (far) close();
    else panelRef.current!.style.transform = "";
  }

  // overflow-clip: a dialog scrolls by default, and moving focus to the title
  // would scroll the sheet into place before it slides in.
  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onPointerDown={(e) => {
        pressedOutside.current = outside(e);
      }}
      onClick={(e) => {
        if (pressedOutside.current && outside(e)) close();
      }}
      className="edit-dialog fixed inset-0 m-0 size-full max-h-none max-w-none overflow-clip bg-ink/40 p-0 backdrop:bg-transparent"
    >
      <div className="flex h-full flex-col justify-end pt-16 md:items-center md:justify-center md:p-6">
        <div
          ref={panelRef}
          className="edit-enter flex max-h-full w-full flex-col rounded-t-2xl bg-surface shadow-elevated transition-transform duration-200 ease-standard md:max-w-lg md:rounded-xl"
        >
          {/* The grab handle. Pulling it down does what Cancel does, so
              assistive tech is pointed at Cancel instead. */}
          <div
            aria-hidden="true"
            onPointerDown={grab}
            onPointerMove={pull}
            onPointerUp={letGo}
            onPointerCancel={letGo}
            className="flex shrink-0 touch-none justify-center py-3 md:hidden"
          >
            <span className="h-1 w-10 rounded-pill bg-border-input" />
          </div>
          <h2 ref={titleRef} id={titleId} tabIndex={-1} className="mx-6 shrink-0 text-heading-3 text-ink md:mt-6">
            {STEPS.find((s) => s.key === editing.edit)!.title}
          </h2>
          <div className="min-h-0 overflow-y-auto p-6">
            <EditBody editing={editing} error={error} />
          </div>
          <div className="grid shrink-0 grid-cols-2 gap-3 border-t border-hairline px-6 py-4">
            <button
              type="button"
              onClick={close}
              disabled={busy}
              className={`${BUTTON} border border-border-input bg-surface text-ink hover:bg-hover-wash active:bg-press-wash`}
            >
              Cancel
            </button>
            <button
              type="submit"
              form={FORMS[editing.edit]}
              aria-busy={busy || undefined}
              className={`${BUTTON} bg-primary text-on-primary hover:bg-primary-hover active:bg-primary-active ${
                busy ? "pointer-events-none" : ""
              }`}
            >
              {busy ? <Spinner label="Saving…" /> : "Save"}
            </button>
          </div>
        </div>
      </div>
    </dialog>
  );
}
