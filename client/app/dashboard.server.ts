import { toLogin } from "~/auth.server";
import type {
  AnswerRequest,
  JoinShop,
  MyChair,
  MyService,
  MyWorkerProfile,
  SaveSchedule,
  SaveService,
  SaveServices,
  SaveWorkerProfile,
} from "~/models/dashboard";
import { toCents, toMinutes } from "~/widgets/kit";

/**
 * GETs one API path as the signed-in user. null when the API has no such row.
 * Throws a redirect to /login when the token is refused, and a 503 for any
 * other failure.
 */
export async function apiGet<T>(request: Request, token: string, path: string): Promise<T | null> {
  const res = await fetch(`${process.env.API_URL}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) throw await toLogin(request);
  if (res.status === 404) return null;
  if (!res.ok) throw new Response("Service temporarily unavailable", { status: 503 });
  return res.json();
}

/**
 * What the worker has set up so far, and `reached`: the index of the first
 * onboarding step with nothing saved, or of the last step once every other is.
 */
export async function loadSetup(request: Request, token: string) {
  const [profile, chairs, services] = await Promise.all([
    apiGet<MyWorkerProfile>(request, token, "/dashboard/profile"),
    apiGet<MyChair[]>(request, token, "/dashboard/chairs"),
    apiGet<MyService[]>(request, token, "/dashboard/services"),
  ]);
  // The database turns a page live once the shop has approved a finished worker.
  const live = profile?.is_active ?? false;

  // Hours belong to one chair: the request still waiting, else the first chair held.
  const chair = chairs?.find((c) => !c.is_active) ?? chairs?.[0] ?? null;

  const reached = live
    ? 4
    : !profile ? 0 : !chair ? 1 : !chair.schedule_days.length ? 2 : !services?.length ? 3 : 4;
  return { profile, chairs, chair, services, live, reached };
}

/** PUTs a JSON body as the signed-in user. Throws a redirect to /login when the token is refused. */
async function apiPut(request: Request, token: string, path: string, body: unknown) {
  const res = await fetch(`${process.env.API_URL}${path}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.status === 401) throw await toLogin(request);
  return res;
}

/**
 * The message for a refused PUT: the one listed for its status, else the API's
 * own sentence on a 422, else `invalid` for FastAPI's list of field errors,
 * else the fallback.
 */
async function refusal(
  res: Response,
  messages: Record<number, string>,
  fallback: string,
  invalid = "Check your details, then try again",
) {
  if (messages[res.status]) return messages[res.status];
  if (res.status === 422) {
    // The API's own refusals carry a sentence; FastAPI's validation errors carry a list.
    const detail = await res.json().then(
      (body) => body?.detail,
      () => undefined,
    );
    return typeof detail === "string" ? detail : invalid;
  }
  return fallback;
}

/**
 * Sends the profile form to PUT /dashboard/profile, blank optional fields as
 * null. Returns null once saved, or the message to show with the API's status.
 * Throws a redirect to /login when the token is refused.
 */
export async function saveProfile(request: Request, token: string, fd: FormData) {
  const text = (name: string) => String(fd.get(name) ?? "");
  const body: SaveWorkerProfile = {
    slug: text("slug"),
    first_name: text("first_name"),
    last_name: text("last_name"),
    bio: text("bio"),
    public_email: text("public_email").trim() || null,
    public_phone: text("public_phone").trim() || null,
  };

  const res = await apiPut(request, token, "/dashboard/profile", body);
  if (res.ok) return null;
  return {
    status: res.status,
    error: await refusal(res, { 409: "That link is taken, try another" }, "Could not save, please try again"),
  };
}

/**
 * Sends the shop form to PUT /dashboard/join-request. Returns null once the
 * request is sent, or the message to show with the API's status. Throws a
 * redirect to /login when the token is refused.
 */
export async function requestShop(request: Request, token: string, fd: FormData) {
  const body: JoinShop = { slug: String(fd.get("slug") ?? "") };

  const res = await apiPut(request, token, "/dashboard/join-request", body);
  if (res.ok) return null;
  // A link that can't be a slug can't be a shop either, so a 422 reads like a 404.
  const missing = "That's not an existing shop";
  return {
    status: res.status,
    error: await refusal(
      res,
      { 404: missing, 409: "Set up your profile first", 422: missing },
      "Could not send your request, please try again",
    ),
  };
}

/**
 * Sends the hours form to PUT /dashboard/chairs/{chair}/schedule: one entry per
 * day switched on, in minutes after the shop's midnight. Returns null once
 * saved, or the message to show with the API's status. Throws a redirect to
 * /login when the token is refused.
 */
export async function saveSchedule(request: Request, token: string, fd: FormData) {
  const text = (name: string) => String(fd.get(name) ?? "");
  const body: SaveSchedule = {
    days: [0, 1, 2, 3, 4, 5, 6]
      .filter((d) => fd.has(`open-${d}`))
      .map((d) => ({
        day_of_week: d,
        // A start or end that didn't parse goes as null, which the API refuses.
        start_minute: toMinutes(text(`start-${d}`)) ?? Number.NaN,
        end_minute: toMinutes(text(`end-${d}`), true) ?? Number.NaN,
        break_start_minute: toMinutes(text(`break-start-${d}`)),
        break_end_minute: toMinutes(text(`break-end-${d}`)),
      })),
  };

  const chair = encodeURIComponent(text("chair"));
  const res = await apiPut(request, token, `/dashboard/chairs/${chair}/schedule`, body);
  if (res.ok) return null;
  return {
    status: res.status,
    error: await refusal(
      res,
      { 404: "Choose your shop first" },
      "Could not save your hours, please try again",
      "Check your hours, then try again",
    ),
  };
}

/**
 * Sends the services form to PUT /dashboard/services as the whole menu, in the
 * order the rows were posted. A new row left blank is skipped. Returns null
 * once saved, or the message to show with the API's status. Throws a redirect
 * to /login when the token is refused.
 */
export async function saveServices(request: Request, token: string, fd: FormData) {
  const text = (name: string) => String(fd.get(name) ?? "");
  const blank = (key: string) =>
    !text(`id-${key}`) && ["title", "price", "duration"].every((f) => !text(`${f}-${key}`).trim());
  const services: SaveService[] = fd
    .getAll("service")
    .map(String)
    .filter((key) => !blank(key))
    .map((key) => ({
      id: text(`id-${key}`) || null,
      title: text(`title-${key}`),
      description: text(`description-${key}`),
      // A price or length that didn't parse goes as null, which the API refuses.
      price_cents: toCents(text(`price-${key}`)) ?? Number.NaN,
      duration_min: Number(text(`duration-${key}`) || Number.NaN),
      buffer_after_min: Number(text(`buffer-${key}`) || 0),
    }));
  const body: SaveServices = { services };

  const res = await apiPut(request, token, "/dashboard/services", body);
  if (res.ok) return null;
  return {
    status: res.status,
    error: await refusal(
      res,
      { 409: "Set up your profile first" },
      "Could not save your services, please try again",
      "Check your services, then try again",
    ),
  };
}

/**
 * Sends a request's answer to PUT /dashboard/appointments/{id}/status. Returns
 * null once answered, or the message to show with the API's status. Throws a
 * redirect to /login when the token is refused.
 */
export async function answerRequest(request: Request, token: string, fd: FormData) {
  // Anything but ACCEPTED or REJECTED goes as posted, which the API refuses.
  const body = { status: String(fd.get("status") ?? "") } as AnswerRequest;
  const appointment = encodeURIComponent(String(fd.get("appointment") ?? ""));

  const res = await apiPut(request, token, `/dashboard/appointments/${appointment}/status`, body);
  if (res.ok) return null;
  return {
    status: res.status,
    error: await refusal(
      res,
      { 409: "This request was already answered" },
      "Could not send your answer, please try again",
    ),
  };
}
