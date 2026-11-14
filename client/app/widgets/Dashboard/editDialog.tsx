import { Spinner } from "~/widgets/kit";
import { STEPS } from "~/widgets/Dashboard/onboarding";
import { SHEET_BUTTON, Sheet } from "~/widgets/Dashboard/sheet";
import { ShopSwitcher } from "~/widgets/Dashboard/shopSwitcher";
import { PROFILE_FORM, WorkerProfileForm } from "~/widgets/Dashboard/workerProfile";
import { HOURS_FORM, WorkerHoursForm } from "~/widgets/Dashboard/schedule";
import { SERVICES_FORM, ServicesForm } from "~/widgets/Dashboard/services";
import { TIME_OFF_FORM, TimeOffConflicts, TimeOffForm } from "~/widgets/Dashboard/timeOff";
import type { MyChair, MyService, MyTimeOff, SaveWorkerProfile, TimeOffConflict } from "~/models/dashboard";

/* One part of a worker's setup, reopened from the dashboard in a Sheet. The
   forms are the onboarding steps' own, and Save submits the open one by id,
   like the wizard's Next. Which part is open comes from ?edit=. */

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
  | { edit: "services"; services: MyService[] }
  | {
      edit: "time-off";
      /** The shop whose calendar the days are on. */
      chair: MyChair;
      timeOff: MyTimeOff;
    };

// The form each part's Save submits.
const FORMS: Record<Editing["edit"], string> = {
  profile: PROFILE_FORM,
  schedule: HOURS_FORM,
  services: SERVICES_FORM,
  "time-off": TIME_OFF_FORM,
};

function EditBody({
  editing,
  error,
  conflicts,
}: {
  editing: Editing;
  error: string | null;
  conflicts: TimeOffConflict[] | null;
}) {
  if (editing.edit === "profile") return <WorkerProfileForm profile={editing.profile} error={error} />;
  if (editing.edit === "services") return <ServicesForm services={editing.services} error={error} />;
  if (editing.edit === "time-off") {
    return conflicts ? (
      <TimeOffConflicts conflicts={conflicts} chair={editing.chair} timezone={editing.timeOff.timezone} />
    ) : (
      <TimeOffForm chair={editing.chair} timeOff={editing.timeOff} error={error} />
    );
  }
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
  conflicts,
  busy,
}: {
  editing: Editing;
  /** Form-level failure from the last save, shown at the end of the form. */
  error: string | null;
  /**
   * The bookings that time off just saved falls on. While there are any, the
   * dialog lists them in place of the form, with Done in place of Cancel and Save.
   */
  conflicts: TimeOffConflict[] | null;
  /** True from Save until the redirect that closes the dialog lands. */
  busy: boolean;
}) {
  const saved = editing.edit === "time-off" && conflicts?.length ? conflicts : null;

  return (
    <Sheet
      title={STEPS.find((s) => s.key === editing.edit)?.title ?? "Your time off"}
      busy={busy}
      footer={(close) =>
        saved ? (
          // Keyed, so it mounts fresh instead of taking over Cancel's button, and autoFocus lands.
          <button
            key="done"
            type="button"
            autoFocus
            onClick={close}
            className={`${SHEET_BUTTON} col-span-2 bg-primary text-on-primary hover:bg-primary-hover active:bg-primary-active`}
          >
            Done
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={close}
              disabled={busy}
              className={`${SHEET_BUTTON} border border-border-input bg-surface text-ink hover:bg-hover-wash active:bg-press-wash`}
            >
              Cancel
            </button>
            <button
              type="submit"
              form={FORMS[editing.edit]}
              aria-busy={busy || undefined}
              className={`${SHEET_BUTTON} bg-primary text-on-primary hover:bg-primary-hover active:bg-primary-active ${
                busy ? "pointer-events-none" : ""
              }`}
            >
              {busy ? <Spinner label="Saving…" /> : "Save"}
            </button>
          </>
        )
      }
    >
      <EditBody editing={editing} error={error} conflicts={saved} />
    </Sheet>
  );
}
