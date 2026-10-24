import { data } from "react-router";
import type { Route } from "./+types/dashboard";
import { Dashboard } from "../pages/Dashboard";
import type { Me } from "~/models/auth";
import { authorize, toLogin } from "~/auth.server";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Dashboard" }];
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
  return data(me, setCookie ? { headers: { "Set-Cookie": setCookie } } : undefined);
}

export default function DashboardRoute({ loaderData }: Route.ComponentProps) {
  return <Dashboard firstName={loaderData.first_name} />;
}
