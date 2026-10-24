import { redirect } from "react-router";
import type { LoggedIn, RefreshSession } from "~/models/auth";
import { commitSession, destroySession, getSession } from "~/sessions.server";

// Seconds. Renewing a little early means a token can't expire between this
// check and the API call that uses it.
const REFRESH_MARGIN = 60;

/** A redirect to /login that also clears the cookie the visitor came with. */
export async function toLogin(request: Request) {
  const session = await getSession(request.headers.get("Cookie"));
  return redirect("/login", { headers: { "Set-Cookie": await destroySession(session) } });
}

/**
 * The access token for a loader's API call, renewed first when it has under a
 * minute left. setCookie is only set after a renewal, and the loader has to send
 * it back: Supabase refresh tokens are single use, so the old cookie is dead.
 * Throws a redirect to /login when there is no session or it can't be renewed.
 */
export async function authorize(request: Request): Promise<{ token: string; setCookie?: string }> {
  const session = await getSession(request.headers.get("Cookie"));
  const accessToken = session.get("access_token");
  const refreshToken = session.get("refresh_token");
  const expiresAt = session.get("expires_at");
  if (!accessToken || !refreshToken || !expiresAt) throw redirect("/login");

  if (expiresAt - Date.now() / 1000 > REFRESH_MARGIN) return { token: accessToken };

  const body: RefreshSession = { refresh_token: refreshToken };
  const res = await fetch(`${process.env.API_URL}/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.status === 401) throw await toLogin(request);
  if (!res.ok) throw new Response("Service temporarily unavailable", { status: 503 });

  const tokens: LoggedIn = await res.json();
  session.set("access_token", tokens.access_token);
  session.set("refresh_token", tokens.refresh_token);
  session.set("expires_at", tokens.expires_at);
  return { token: tokens.access_token, setCookie: await commitSession(session) };
}
