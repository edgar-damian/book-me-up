import { redirect } from "react-router";
import type { Route } from "./+types/logout";
import { authorize, toLogin } from "~/auth.server";

// A GET ends nothing, so no link or prefetch can log anyone out.
export function loader() {
  return redirect("/dashboard");
}

/**
` * Ends the Supabase session, so a copy of the cookie stops working too, then
 * clears the cookie and goes to /login. The cookie goes even when the session
 * can't be ended, so a logout never fails.`
 */
export async function action({ request }: Route.ActionArgs) {
  try {
    // Renewed first: the cookie outlives its access token, and the API refuses an expired one.
    const { token } = await authorize(request);
    await fetch(`${process.env.API_URL}/auth/logout`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    // authorize throws a redirect or a 503, and fetch throws when the API can't be reached.
  }
  return toLogin(request);
}
