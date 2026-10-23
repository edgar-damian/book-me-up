import { redirect } from "react-router";
import type { Route } from "./+types/dashboard";
import { Dashboard } from "../pages/Dashboard";
import { getSession } from "~/sessions.server";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Dashboard" }];
}

// Checks the signed cookie only. The token itself is verified by the API, which this page
// doesn't call yet.
export async function loader({ request }: Route.LoaderArgs) {
  const session = await getSession(request.headers.get("Cookie"));
  if (!session.has("access_token")) throw redirect("/login");
  return null;
}

export default function DashboardRoute() {
  return <Dashboard />;
}
