import * as React from "react";
import { cn } from "~/lib/utils";
import { IconStorefront } from "~/widgets/kit";
import type { Chair } from "~/models/workerPage";

export function EstablishmentSelector({
  chairs,
  onSelect,
  prompting = false,
}: {
  chairs: Chair[];
  onSelect?: (chair: Chair | null) => void;
  prompting?: boolean;
}) {
  const locked = chairs.length === 1;
  const [chosenId, setChosenId] = React.useState<string | null>(null);
  const selectedId = locked ? chairs[0].id : chosenId;

  React.useEffect(() => {
    onSelect?.(chairs.find((c) => c.id === selectedId) ?? null);
  }, [selectedId]);

  function toggle(id: string) {
    if (locked) return;
    setChosenId((cur) => (cur === id ? null : id));
  }

  if (chairs.length === 0) return null;

  return (
    <div>

      <h2 className="text-heading-2 text-ink">{locked ? "Works at" :
          prompting ? "Pick a shop to continue" : "Select a shop to book" } </h2>


      <ul className="mt-3 flex gap-6">
        {chairs.map((chair) => {
          const isSelected = chair.id === selectedId;

          const collapsed = selectedId !== null && !isSelected;
          return (
            <li
              key={chair.id}
              role="button"
              tabIndex={0}
              aria-pressed={isSelected}
              onClick={() => toggle(chair.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  toggle(chair.id);
                }
              }}
              className={cn(
                "relative h-11 rounded-full flex items-center transition-all duration-320 group shadow-soft",
                collapsed ? "w-11 hover:w-40" : "w-40",
                isSelected ? "bg-primary text-on-primary" : "bg-surface text-ink",
                locked ? "cursor-default" : "cursor-pointer"
              )}
            >
              {/* Blur glow */}
              <span className="absolute top-2.5 inset-x-0 h-full rounded-full bg-primary blur-lg opacity-0 -z-10 transition-all duration-320 group-hover:opacity-50"></span>

              {/* Icon — stands in for the name while another shop is selected */}
              <span
                className={cn(
                  "absolute inset-0 flex items-center justify-center transition-all duration-320",
                  collapsed ? "scale-100 group-hover:scale-0" : "scale-0"
                )}
              >
                <IconStorefront className="size-5" />
              </span>

              {/* Name */}
              <span
                className={cn(
                  "px-4 w-full text-center truncate text-eyebrow uppercase transition-all duration-320",
                  collapsed ? "scale-0 group-hover:scale-100" : "scale-100"
                )}
              >
                {chair.establishment.name}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
