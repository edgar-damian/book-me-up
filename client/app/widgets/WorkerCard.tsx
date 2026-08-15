import { Link } from "react-router";
import { IconChevronRight, IconScissors, ImageTile } from "~/widgets/kit";

export type Worker = {
  id: string;
  slug: string;
  first_name: string;
  last_name: string;
  bio: string;
  image: string | null;
  is_active: boolean;
};

export function WorkerCard({ worker }: { worker: Worker }) {
  return (
    <Link
      to={`/book-with/${worker.slug}`}
      className="flex items-start gap-4 rounded-lg border border-hairline bg-surface p-4 transition-colors duration-120 ease-standard hover:bg-hover-wash active:bg-press-wash"
    >
      <ImageTile
        src={worker.image}
        className="size-16 rounded-lg"
        // Stands in for a headshot nobody uploaded, and catches a URL that
        // does not load. Neutral rather than tinted on purpose — the accent
        // tiles are the landing page's move, and this section already has one.
        fallback={<IconScissors className="size-7 text-ink-faint" />}
      />

      <span className="min-w-0 flex-1">
        <h3 className="text-heading-3 text-ink">
          {worker.first_name} {worker.last_name}
        </h3>
        <p className="mt-1 line-clamp-3 text-body-sm text-ink-muted">
          {worker.bio}
        </p>
      </span>

      {/* Carries the whole "this card goes somewhere" signal on a phone, where
          the hover wash never fires. */}
      <IconChevronRight className="mt-1 size-5 shrink-0 text-ink-faint" />
    </Link>
  );
}
