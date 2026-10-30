import { data, redirect } from "react-router";
import type { Route } from "./+types/onboarding";
import { Onboarding } from "../pages/Onboarding";
import type { Me } from "~/models/auth";
import type { SaveWorkerProfile } from "~/models/dashboard";
import { authorize } from "~/auth.server";
import { apiGet, loadSetup, requestShop, saveProfile, saveSchedule, saveServices } from "~/dashboard.server";
import { STEPS } from "~/widgets/Dashboard/onboarding";
import { PROFILE_FORM } from "~/widgets/Dashboard/workerProfile";
import { SHOP_FORM } from "~/widgets/Dashboard/connectShop";
import { HOURS_FORM } from "~/widgets/Dashboard/schedule";
import { SERVICES_FORM } from "~/widgets/Dashboard/services";
import { toSlug } from "~/widgets/kit";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Set up your page" }];
}

/** A first profile starts from the account's name, and a link made from it. */
async function firstProfile(request: Request, token: string): Promise<SaveWorkerProfile> {
  const me = await apiGet<Me>(request, token, "/auth/me");
  const first_name = me?.first_name ?? "";
  const last_name = me?.last_name ?? "";
  return {
    slug: toSlug(`${first_name} ${last_name}`),
    first_name,
    last_name,
    bio: "",
    public_email: null,
    public_phone: null,
  };
}

// Every response passes setCookie on: authorize may have renewed the session,
// and the refresh token in the old cookie is already spent.
export async function loader({ request }: Route.LoaderArgs) {
  const { token, setCookie } = await authorize(request);
  const headers = setCookie ? { "Set-Cookie": setCookie } : undefined;

  // A live worker still lands here, on the last step, to see their link.
  const { profile, chairs, chair, services, live, reached } = await loadSetup(request, token);

  // A ?step= past the furthest step reached falls back to it.
  const wanted = STEPS.findIndex((s) => s.key === new URL(request.url).searchParams.get("step"));
  const step = STEPS[wanted >= 0 && wanted <= reached ? wanted : reached].key;

  return data(
    {
      step,
      profile: profile ?? (await firstProfile(request, token)),
      chairs: chairs ?? [],
      chair,
      services: services ?? [],
      live,
    },
    headers ? { headers } : undefined,
  );
}

/** What saves each step's form, named by its intent, and the step to open after it. */
function stepFor(intent: FormDataEntryValue | null) {
  switch (intent) {
    case PROFILE_FORM:
      return { save: saveProfile, next: "shop" };
    case SHOP_FORM:
      return { save: requestShop, next: "schedule" };
    case HOURS_FORM:
      return { save: saveSchedule, next: "services" };
    case SERVICES_FORM:
      return { save: saveServices, next: "live" };
    default:
      return null;
  }
}

export async function action({ request }: Route.ActionArgs) {
  const { token, setCookie } = await authorize(request);
  const headers = setCookie ? { "Set-Cookie": setCookie } : undefined;

  const fd = await request.formData();
  const step = stepFor(fd.get("intent"));
  if (!step) throw new Response("Unknown form", { status: 400 });

  const refused = await step.save(request, token, fd);
  if (refused) return data({ error: refused.error }, { status: refused.status, headers });
  return redirect(`/onboarding?step=${step.next}`, { headers });
}

export default function OnboardingRoute({ loaderData, actionData }: Route.ComponentProps) {
  return (
    <Onboarding
      step={loaderData.step}
      profile={loaderData.profile}
      chairs={loaderData.chairs}
      chair={loaderData.chair}
      services={loaderData.services}
      live={loaderData.live}
      error={actionData?.error ?? null}
    />
  );
}
