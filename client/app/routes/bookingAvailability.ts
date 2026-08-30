/** Resource route, no component. The flow reads availability through here
    because API_URL is server-only and the browser cannot call FastAPI. */

import type { Route } from "./+types/bookingAvailability";
import { readAvailability } from "~/booking/api.server";
import type { BookingTarget } from "~/booking/contract";

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);

  const target: BookingTarget = {
    establishmentId: url.searchParams.get("e") ?? "",
    workerId: url.searchParams.get("w") ?? "",
    serviceId: url.searchParams.get("s") ?? "",
  };

  return readAvailability(
    url.searchParams.get("kind") === "times" ? "times" : "dates",
    target,
    url.searchParams.get("day") ?? undefined,
  );
}
