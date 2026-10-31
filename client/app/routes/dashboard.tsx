import { data, redirect } from "react-router";
import type { Route } from "./+types/dashboard";
import { Dashboard } from "../pages/Dashboard";
import type { Me } from "~/models/auth";
import type { MyChair, MyWeek } from "~/models/dashboard";
import { authorize, toLogin } from "~/auth.server";
import { answerRequest, apiGet, loadSetup, saveProfile, saveSchedule, saveServices } from "~/dashboard.server";
import { ANSWER_FORM } from "~/widgets/Dashboard/appointments";
import { STEPS } from "~/widgets/Dashboard/onboarding";
import type { Editing } from "~/widgets/Dashboard/editDialog";
import { PROFILE_FORM } from "~/widgets/Dashboard/workerProfile";
import { HOURS_FORM } from "~/widgets/Dashboard/schedule";
import { SERVICES_FORM } from "~/widgets/Dashboard/services";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Dashboard" }];
}

/**
 * The part of the setup ?edit= opens, or null when it names none or that part
 * has nothing to edit. Hours open at the shop ?chair= names, else the one the
 * worker has joined, else their waiting request.
 */
function editingFor(
  edit: string | null,
  chairId: string | null,
  { profile, chairs, services }: Awaited<ReturnType<typeof loadSetup>>,
): Editing | null {
  if (edit === "profile") return profile ? { edit, profile } : null;
  if (edit === "services") return { edit, services: services ?? [] };
  if (edit !== "schedule" || !chairs) return null;
  const chair = chairs.find((c) => c.id === chairId) ?? chairs.find((c) => c.is_active) ?? chairs[0];
  return chair ? { edit, chairs, chair } : null;
}

// authorize has already renewed a token that was about to expire, so a 401 here
// means the session itself is gone.
export async function loader({ request }: Route.LoaderArgs) {
  const { token, setCookie } = await authorize(request);

  const res = await fetch(`${process.env.API_URL}/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) throw await toLogin(request);
  if (!res.ok) throw new Response("Service temporarily unavailable", { status: 503 });

  const me: Me = await res.json();
  const headers = setCookie ? { "Set-Cookie": setCookie } : undefined;
  const params = new URL(request.url).searchParams;
  const edit = params.get("edit");
  const setup = !me.is_live || edit ? await loadSetup(request, token) : null;
  // A worker with steps left goes back to them. One waiting on their shop has
  // nothing left to do there, so they get the dashboard too.
  if (!me.is_live && setup && setup.reached < STEPS.length - 1) {
    throw redirect("/onboarding", { headers });
  }
  const editing = setup && editingFor(edit, params.get("chair"), setup);

  // The week is at the shop ?chair= names, else the first one the worker has joined.
  const chairs = setup ? (setup.chairs ?? []) : ((await apiGet<MyChair[]>(request, token, "/dashboard/chairs")) ?? []);
  const shops = chairs.filter((c) => c.is_active);
  const chair = shops.find((c) => c.id === params.get("chair")) ?? shops.at(0) ?? null;
  const week = chair
    ? await apiGet<MyWeek>(request, token, `/dashboard/chairs/${encodeURIComponent(chair.id)}/appointments`)
    : null;
  return data({ editing, chairs, chair, week }, headers ? { headers } : undefined);
}

/** What saves each form the edit dialog holds, named by its intent. */
function saverFor(intent: FormDataEntryValue | null) {
  switch (intent) {
    case PROFILE_FORM:
      return saveProfile;
    case HOURS_FORM:
      return saveSchedule;
    case SERVICES_FORM:
      return saveServices;
    default:
      return null;
  }
}

// Every response passes setCookie on: authorize may have renewed the session,
// and the refresh token in the old cookie is already spent.
export async function action({ request }: Route.ActionArgs) {
  const { token, setCookie } = await authorize(request);
  const headers = setCookie ? { "Set-Cookie": setCookie } : undefined;

  const fd = await request.formData();
  // An answer posts from its row and leaves the page where it is. A refusal goes back
  // without an error status, so the week still reloads and shows what became of the booking.
  if (fd.get("intent") === ANSWER_FORM) {
    const refused = await answerRequest(request, token, fd);
    return data({ error: refused?.error ?? null }, { headers });
  }

  const save = saverFor(fd.get("intent"));
  if (!save) throw new Response("Unknown form", { status: 400 });

  // A refusal leaves the dialog open, since the form posted to its own ?edit= URL.
  // That URL also holds the shop the dashboard was showing, which the redirect keeps.
  const refused = await save(request, token, fd);
  if (refused) return data({ error: refused.error }, { status: refused.status, headers });
  const chair = new URL(request.url).searchParams.get("chair");
  return redirect(chair ? `/dashboard?chair=${encodeURIComponent(chair)}` : "/dashboard", { headers });
}

export default function DashboardRoute({ loaderData, actionData }: Route.ComponentProps) {
  return (
    <Dashboard
      chairs={loaderData.chairs}
      chair={loaderData.chair}
      week={loaderData.week}
      editing={loaderData.editing}
      error={actionData?.error ?? null}
    />
  );
}
