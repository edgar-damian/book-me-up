import type { Route } from "./+types/bookingFlow";
import { BookingFlow } from "../pages/BookingFlow";
import type { 
    DatesAvailable,
    TimesAvailable,
    AppointmentBooked,
    BookAppointment
} from "~/models/bookingFlow";

export async function loader({ params }: Route.LoaderArgs) {
  const res = await fetch(`${process.env.API_URL}/workers/${params.slug}`);
  if (!res.ok) throw new Response("Not found", { status: res.status });
  const worker: WorkerLandingPage = await res.json();
  return worker;
}


export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [{ title: "Barber not found" }];
  return [
    { title: `Book with ${loaderData.first_name} ${loaderData.last_name}` },
    { name: "description", content: loaderData.bio },
  ];
}


export default function BookingFlow({ loaderData }: Route.ComponentProps) {
  return <WorkerPage worker={loaderData} />;
}
