import { Container, IconMapPin, Reveal, WordmarkBar } from "~/widgets/kit";
import { ServiceCard } from "~/widgets/WorkerPage/serviceCard";
import type { 
    DatesAvailable,
    TimesAvailable,
    ValidSlot,
    BookingStatus,
    BookAppointment,
    Client,
    AppointmentBooked,
} from "~/models/bookingFlow";




export function BookingFlow({
  worker,
}: {
  worker: WorkerLandingPage;
}) {
  return (
    <p>Hello World</p>
  );
}