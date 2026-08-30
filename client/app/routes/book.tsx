/** /book/:workerSlug/:serviceId — the whole booking flow at one URL. Steps
    swap inside the page, so availability is read through a resource route and
    the create POST is submitted with a fetcher rather than a <Form>. */

import type { ShouldRevalidateFunctionArgs } from "react-router";
import type { Route } from "./+types/book";
import { BookingFlow } from "~/pages/BookingFlow";
import type { Barber } from "~/pages/BookWith";
import { createBooking, readAvailability } from "~/booking/api.server";
import { E164, normalizePhone } from "~/booking/format";
import type { BookingActionData } from "~/booking/contract";

export async function loader({ params }: Route.LoaderArgs) {
  const response = await fetch(`${process.env.API_URL}/book-with/${params.workerSlug}`);
  if (!response.ok) throw new Response("Not found", { status: response.status });

  const barber: Barber = await response.json();

  // The service must belong to this barber and still be active, or a stale URL
  // opens a flow the availability endpoints will refuse.
  const service = barber.services.find(
    (candidate) => candidate.id === params.serviceId && candidate.is_active,
  );
  if (!service) throw new Response("Not found", { status: 404 });

  const chairs = [...barber.chairs].sort((a, b) =>
    a.establishment.name.localeCompare(b.establishment.name),
  );

  // One chair means no shop question, so the calendar can arrive with the
  // document. With two or more, the shop picker shows first — nothing to
  // prefetch.
  const dates =
    chairs.length === 1
      ? await readAvailability("dates", {
          establishmentId: chairs[0].establishment.id,
          workerId: barber.id,
          serviceId: service.id,
        })
      : null;

  return { barber, service, chairs, dates };
}

export async function action({ request }: Route.ActionArgs): Promise<BookingActionData> {
  const form = await request.formData();
  const field = (name: string) => String(form.get(name) ?? "").trim();

  // Re-derived here in case the hidden field never got filled in. Client.phone
  // carries a Pydantic pattern, so a malformed number is a 422 rather than a
  // silent failure.
  const phone = E164.test(field("phone"))
    ? field("phone")
    : normalizePhone(field("phone_display") || field("phone"));

  const missing: Record<string, string> = {};
  if (field("first_name") === "") missing.first_name = "Enter your first name.";
  if (field("last_name") === "") missing.last_name = "Enter your last name.";
  if (!phone) missing.phone = "Enter a phone number the shop can reach you on.";
  if (field("starts_at") === "") missing.starts_at = "Pick a time before booking.";
  if (Object.keys(missing).length > 0) {
    return { ok: false, kind: "fields", fields: missing };
  }

  const email = field("email");
  const notes = field("notes");

  return createBooking({
    client: {
      first_name: field("first_name"),
      last_name: field("last_name"),
      phone: phone!,
      // null, not "", so an untouched optional field lands as NULL.
      email: email === "" ? null : email,
    },
    starts_at: field("starts_at"),
    notes: notes === "" ? null : notes,
    service_id: field("service_id"),
    worker_id: field("worker_id"),
    establishment_id: field("establishment_id"),
  });
}

/** A fetcher submission revalidates every loader by default, which here would
    re-fetch the barber mid-booking and flicker the spotlight. */
export function shouldRevalidate({
  currentParams,
  nextParams,
}: ShouldRevalidateFunctionArgs) {
  return (
    currentParams.workerSlug !== nextParams.workerSlug ||
    currentParams.serviceId !== nextParams.serviceId
  );
}

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [{ title: "Booking not found · book-me-up" }];

  const { barber, service } = loaderData;
  return [
    {
      title: `Book ${service.title} with ${barber.first_name} ${barber.last_name} · book-me-up`,
    },
    { name: "robots", content: "noindex" },
  ];
}

export default function BookRoute({ loaderData }: Route.ComponentProps) {
  return (
    <BookingFlow
      barber={loaderData.barber}
      service={loaderData.service}
      chairs={loaderData.chairs}
      prefetchedDates={loaderData.dates}
    />
  );
}
