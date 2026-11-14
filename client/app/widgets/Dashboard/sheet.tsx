import { useId, useLayoutEffect, useRef, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router";

/* A dashboard pop-up: a bottom sheet on a phone, a centered card from md up.
   What it holds comes from the URL, so closing is a navigation back to the
   dashboard, keeping the shop ?chair= names. */

// How far the handle has to be pulled down before letting go closes the sheet.
const DISMISS_PX = 96;

/** The chrome of a footer button. Each one adds its own colors. */
export const SHEET_BUTTON =
  "inline-flex min-h-11 w-full items-center justify-center rounded-md px-4 py-2 text-button " +
  "transition-colors duration-120 ease-standard disabled:pointer-events-none disabled:opacity-50";

export function Sheet({
  title,
  busy = false,
  footer,
  children,
}: {
  title: string;
  /** True while a save is on its way. The sheet stays open until it lands. */
  busy?: boolean;
  /** The buttons along the bottom, two to a row, given what closes the sheet. */
  footer: (close: () => void) => ReactNode;
  children: ReactNode;
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
          {/* The grab handle. Pulling it down does what the footer's close does,
              so assistive tech is pointed at that instead. */}
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
            {title}
          </h2>
          <div className="min-h-0 overflow-y-auto p-6">{children}</div>
          <div className="grid shrink-0 grid-cols-2 gap-3 border-t border-hairline px-6 py-4">{footer(close)}</div>
        </div>
      </div>
    </dialog>
  );
}
