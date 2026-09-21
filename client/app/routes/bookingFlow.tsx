import { data } from "react-router";
import type { Route } from "./+types/bookingFlow";
import { BookingFlow } from "../pages/BookingFlow";
import type {
  DatesAvailable,
  TimesAvailable,
  AppointmentBooked,
  BookAppointment,
} from "~/models/bookingFlow";


const bookingBase = (p: { establishmentId: string; workerId: string; serviceId: string }) =>
  `${process.env.API_URL}/booking/establishment/${p.establishmentId}` +
  `/worker/${p.workerId}/service/${p.serviceId}`;


export async function loader({ params, request }: Route.LoaderArgs) {
  const url = new URL(request.url);

  const datesRes = await fetch(`${bookingBase(params)}/dates`);
  if (!datesRes.ok) throw new Response("Not found", { status: datesRes.status });
  const dates: DatesAvailable = await datesRes.json();

  // A hand-edited or stale URL steps back instead of erroring: a day that is
  // not open is step 1, a slot no longer offered is step 2. The latter is also
  // what lands a lost race on a fresh list, since an action revalidates this.
  const wanted = url.searchParams.get("day");
  const day = wanted !== null && dates.dates.includes(wanted) ? wanted : null;

  let times: TimesAvailable | null = null;
  if (day) {
    const timesRes = await fetch(`${bookingBase(params)}/times?day=${day}`);
    if (!timesRes.ok) throw new Response("Not found", { status: timesRes.status });
    times = await timesRes.json();
  }

  const slot = url.searchParams.get("slot");
  const offered = times?.valid_slots.some((s) => s.start_time === slot) ?? false;

  return { dates, times, day, slot: offered ? slot : null };
}


export async function action({ params, request }: Route.ActionArgs) {
  const fd = await request.formData();

  const body: BookAppointment = {
    client: {
      first_name: String(fd.get("first_name") ?? ""),
      last_name: String(fd.get("last_name") ?? ""),
      phone: String(fd.get("phone") ?? ""),
      email: String(fd.get("email") ?? "") || null,
    },
    starts_at: String(fd.get("starts_at") ?? ""),
    notes: String(fd.get("notes") ?? "") || null,
    service_id: params.serviceId,
    worker_id: params.workerId,
    establishment_id: params.establishmentId,
  };

  const res = await fetch(`${process.env.API_URL}/booking/appointments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    return data(
      {
        booked: null,
        error:
          res.status === 409
            ? "That time was just booked, please pick another"
            : "Could not book, please try again",
      },
      { status: res.status },
    );
  }

  const booked: AppointmentBooked = await res.json();
  return { booked, error: null };
}


export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [{ title: "Book an appointment" }];
  return [{ title: `Book ${loaderData.dates.service_title} with ${loaderData.dates.worker_name}` }];
}


export default function BookingFlowRoute({ loaderData, actionData }: Route.ComponentProps) {
  return (
    <BookingFlow
      dates={loaderData.dates}
      times={loaderData.times}
      day={loaderData.day}
      slot={loaderData.slot}
      booked={actionData?.booked ?? null}
      error={actionData?.error ?? null}
    />
  );
}
