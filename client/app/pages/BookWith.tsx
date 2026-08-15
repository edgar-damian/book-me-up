import { Link } from "react-router";
import {
  Container,
  IconChevronDown,
  IconChevronRight,
  IconMail,
  IconPhone,
  IconScissors,
  IconStorefront,
  ImageTile,
  Reveal,
  WordmarkBar,
} from "~/widgets/kit";
import { groupScheduleDays, tzLabel, type ScheduleDay } from "~/widgets/format";
import { ServiceCard, type Service } from "~/widgets/ServiceCard";


export type Barber = {
  id: string;
  slug: string;
  first_name: string;
  last_name: string;
  bio: string;
  public_email: string | null;
  public_phone: string | null;
  image: string | null;
  is_active: boolean;
  hold_expiry_hours: number;
  auto_accept: boolean;
  min_lead_time_min: number;
  max_advance_days: number;
  cancellation_cutoff_min: number;
  services: Service[];
  chairs: Chair[];
};


export type Chair = {
  id: string;
  establishment: {
    id: string;
    slug: string;
    name: string;
    city: string;
    timezone: string;
  };
  schedule_days: ScheduleDay[];
};


function BarberHeader({ barber, chairs }: { barber: Barber; chairs: Chair[] }) {

  const cities = [...new Set(chairs.map((chair) => chair.establishment.city))];
  const eyebrow =
    cities.length === 0
      ? "Barber"
      : cities.length <= 2
        ? cities.join(" & ")
        : `${cities.length} locations`;

  return (
    <section className="pt-16 pb-12 md:pt-24 lg:pt-32">
      <Container>
        <ImageTile
          src={barber.image}
          alt={`${barber.first_name} ${barber.last_name}`}
          className="size-24 rounded-pill border border-hairline"
          fallback={<IconScissors className="size-10 text-ink-faint" />}
        />

        <p className="mt-6 text-eyebrow uppercase text-ink-muted">{eyebrow}</p>
        <h1 className="mt-3 max-w-4xl font-display text-display-1 text-ink">
          {barber.first_name} {barber.last_name}
        </h1>
        <p className="mt-6 max-w-2xl text-body-md text-ink-secondary">
          {barber.bio}
        </p>
      </Container>
    </section>
  );
}


function ContactSection({ barber }: { barber: Barber }) {
  if (barber.public_email === null && barber.public_phone === null) return null;

  return (
    <section className="pb-16 md:pb-24">
      <Container>
        <h2 className="text-heading-2 text-ink">Contact me</h2>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          {barber.public_phone !== null && (
            <ContactRow
              href={`tel:${barber.public_phone}`}
              label="Phone"
              value={barber.public_phone}
              icon={<IconPhone className="size-6" />}
              tint="bg-accent-jade-tint text-accent-jade"
            />
          )}
          {barber.public_email !== null && (
            <ContactRow
              href={`mailto:${barber.public_email}`}
              label="Email"
              value={barber.public_email}
              icon={<IconMail className="size-6" />}
              tint="bg-accent-indigo-tint text-accent-indigo"
            />
          )}
        </div>
      </Container>
    </section>
  );
}

function ContactRow({
  href,
  label,
  value,
  icon,
  tint,
}: {
  href: string;
  label: string;
  value: string;
  icon: React.ReactNode;
  tint: string;
}) {
  return (
    <a
      href={href}
      className="flex min-h-11 flex-1 items-center gap-4 rounded-lg border border-hairline bg-surface p-4 transition-colors duration-120 ease-standard hover:bg-hover-wash active:bg-press-wash"
    >
      <span
        className={`grid size-12 shrink-0 place-items-center rounded-lg ${tint}`}
        aria-hidden="true"
      >
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-eyebrow uppercase text-ink-muted">
          {label}
        </span>
        <span className="block break-all text-body-sm text-primary-text">
          {value}
        </span>
      </span>
    </a>
  );
}

function ShopsSection({ chairs }: { chairs: Chair[] }) {
  if (chairs.length === 0) return null;

  const heading = chairs.length === 1 ? "See my shop" : "See my shops";

  return (
    <section className="pb-16 md:pb-24">
      <Container>
        <h2 className="text-heading-2 text-ink">{heading}</h2>
        <div className="mt-6 max-w-md">
          {chairs.length === 1 ? (
            <ShopLink
              chair={chairs[0]}
              className="rounded-lg border border-hairline bg-surface p-4"
            />
          ) : (
            <details className="group rounded-lg border border-hairline bg-surface">
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-lg p-4 text-body-md text-ink transition-colors duration-120 ease-standard hover:bg-hover-wash [&::-webkit-details-marker]:hidden">
                Choose a shop
                <IconChevronDown className="size-5 shrink-0 text-ink-muted transition-transform duration-320 ease-standard group-open:rotate-180" />
              </summary>
              <ul className="border-t border-hairline p-2">
                {chairs.map((chair) => (
                  <li key={chair.id}>
                    <ShopLink chair={chair} className="rounded-sm p-3" />
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      </Container>
    </section>
  );
}

function ShopLink({ chair, className }: { chair: Chair; className: string }) {
  return (
    <Link
      to={`/establishments/${chair.establishment.slug}`}
      className={`flex min-h-11 items-center gap-3 transition-colors duration-120 ease-standard hover:bg-hover-wash active:bg-press-wash ${className}`}
    >
      <IconStorefront className="size-5 shrink-0 text-ink-muted" />
      <span className="min-w-0 flex-1">
        <span className="block text-body-md text-ink">
          {chair.establishment.name}
        </span>
        <span className="block text-caption text-ink-muted">
          {chair.establishment.city}
        </span>
      </span>
      <IconChevronRight className="size-5 shrink-0 text-ink-faint" />
    </Link>
  );
}


function ServicesSection({ services }: { services: Service[] }) {
  return (
    <section className="pb-16 md:pb-24 lg:pb-32">
      <Container>
        <h2 className="text-heading-2 text-ink">What I do</h2>
        {services.length === 0 ? (
          <p className="mt-3 text-body-md text-ink-muted">
            No services listed yet.
          </p>
        ) : (
          <>
            <Reveal
              stagger
              className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
            >
              {services.map((service) => (
                <ServiceCard key={service.id} service={service} />
              ))}
            </Reveal>
          </>
        )}
      </Container>
    </section>
  );
}


function ScheduleBand({ chairs }: { chairs: Chair[] }) {
  if (chairs.length === 0) return null;

  const showTimezone =
    new Set(chairs.map((chair) => chair.establishment.timezone)).size > 1;

  return (
    <section className="bg-deep py-16 text-on-deep md:py-24 lg:py-32">
      <Container>
        <p className="text-eyebrow uppercase">When and where</p>
        <h2 className="mt-3 text-heading-2">
          {chairs.length === 1 ? "My hours" : "Where to find me each week"}
        </h2>

        <div className="mt-10 grid gap-8 sm:grid-cols-2">
          {chairs.map((chair) => {
            const rows = groupScheduleDays(chair.schedule_days);

            return (
              <div key={chair.id}>
                <h3 className="text-heading-3">
                  <Link
                    to={`/establishments/${chair.establishment.slug}`}
                    className="underline decoration-1 underline-offset-4 transition-opacity duration-120 ease-standard hover:opacity-90"
                  >
                    {chair.establishment.name}
                  </Link>
                </h3>

                {rows.length === 0 ? (
                  <p className="mt-3 text-body-md">Hours aren&rsquo;t posted yet.</p>
                ) : (
                  <dl className="mt-3 space-y-1">
                    {rows.map((row) => (
                      <div
                        key={`${row.days}-${row.hours}`}
                        className="flex flex-wrap gap-x-2 text-body-md"
                      >
                        <dt>{row.days}</dt>
                        <dd>
                          {row.hours}
                          {showTimezone && ` (${tzLabel(chair.establishment.timezone)})`}
                        </dd>
                      </div>
                    ))}
                  </dl>
                )}
              </div>
            );
          })}
        </div>
      </Container>
    </section>
  );
}


export function BookWith({ barber }: { barber: Barber }) {
  const services = barber.services.filter((service) => service.is_active);

  const chairs = [...barber.chairs].sort((a, b) =>
    a.establishment.name.localeCompare(b.establishment.name),
  );

  return (
    <div className="overflow-x-clip bg-canvas-soft text-ink">
      <WordmarkBar />
      <main>
        <BarberHeader barber={barber} chairs={chairs} />
        <ContactSection barber={barber} />
        <ShopsSection chairs={chairs} />
        <ServicesSection services={services} />
        <ScheduleBand chairs={chairs} />
      </main>
    </div>
  );
}
