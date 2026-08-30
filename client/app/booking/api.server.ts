/** Every booking call to FastAPI. Server only — the .server suffix is
    load-bearing, since API_URL has no VITE_ prefix and must never reach a
    client bundle. Nothing throws; failures come back as renderable data. */

import {
  createUrl,
  datesUrl,
  timesUrl,
  type AvailabilityResult,
  type BookingActionData,
  type BookingConfirmation,
  type BookingRequest,
  type BookingTarget,
  type DatesAvailable,
  type TimesAvailable,
} from "./contract";
import { todayIn } from "./format";

/** Shared by the resource route and book.tsx's prefetch, so both paths stamp
    `today` identically. */
function stamp<T extends { timezone: string }>(data: T) {
  return { ...data, today: todayIn(data.timezone) };
}

export async function readAvailability(
  kind: "dates" | "times",
  target: BookingTarget,
  day?: string,
): Promise<AvailabilityResult> {
  if (!target.establishmentId || !target.workerId || !target.serviceId) {
    return { kind, ok: false, message: "Missing booking details." };
  }
  if (kind === "times" && !day) {
    return { kind, ok: false, message: "Missing the chosen day." };
  }

  const base = process.env.API_URL as string;
  const endpoint =
    kind === "dates" ? datesUrl(base, target) : timesUrl(base, target, day!);

  let response: Response;
  try {
    response = await fetch(endpoint);
  } catch {
    return { kind, ok: false, message: "Couldn't reach the booking service." };
  }

  if (!response.ok) {
    return {
      kind,
      ok: false,
      message:
        response.status === 404
          ? "This barber isn't taking bookings for that service here."
          : "Couldn't load availability just now.",
    };
  }

  try {
    return kind === "dates"
      ? { kind: "dates", ok: true, data: stamp((await response.json()) as DatesAvailable) }
      : { kind: "times", ok: true, data: stamp((await response.json()) as TimesAvailable) };
  } catch {
    return { kind, ok: false, message: "Couldn't read the availability response." };
  }
}

/** Create the appointment. A 409 is ordinary traffic: the server raises
    SlotTaken for any stale slot, not just a lost race. */
export async function createBooking(body: BookingRequest): Promise<BookingActionData> {
  const base = process.env.API_URL as string;

  let response: Response;
  try {
    response = await fetch(createUrl(base), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    return {
      ok: false,
      kind: "error",
      message: "Couldn't reach the booking service. Your details are still here — try again.",
    };
  }

  if (response.ok) {
    try {
      return { ok: true, booking: (await response.json()) as BookingConfirmation };
    } catch {
      // Possibly booked but unconfirmable. Deliberately does not invite a
      // retry, which could double-book.
      return {
        ok: false,
        kind: "error",
        message:
          "Your booking may have gone through, but we couldn't read the confirmation. Call the shop before booking again.",
      };
    }
  }

  if (response.status === 409) return { ok: false, kind: "slot_taken" };
  if (response.status === 422) {
    return { ok: false, kind: "fields", fields: await fieldErrors(response) };
  }

  // 404 covers two things the server cannot tell apart for us: no active
  // chair/service, and details it refused (injection scanners, or a name or
  // phone left unusable after cleaning). The details are what the client can
  // act on, so the copy points there and the form keeps everything typed.
  return {
    ok: false,
    kind: "error",
    message:
      response.status === 404
        ? "We couldn't accept these details. Check your name and phone number, then try again."
        : "Couldn't complete your booking just now. Your details are still here — try again.",
  };
}

/** FastAPI's 422 body, reduced to { field: message }. */
async function fieldErrors(response: Response): Promise<Record<string, string>> {
  try {
    const body = (await response.json()) as {
      detail?: { loc?: (string | number)[]; msg?: string }[];
    };

    const fields: Record<string, string> = {};
    for (const item of body.detail ?? []) {
      const name = item.loc?.[item.loc.length - 1];
      if (typeof name === "string" && item.msg) fields[name] = item.msg;
    }
    return Object.keys(fields).length > 0 ? fields : { phone: "Check the details above." };
  } catch {
    return { phone: "Check the details above." };
  }
}
