import { data, redirect } from "react-router";
import type { Route } from "./+types/login";
import { LogIn } from "../pages/LogIn";
import type { LoggedIn, LogIn as Credentials } from "~/models/auth";
import { commitSession, getSession } from "~/sessions.server";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Log in" }];
}

export async function action({ request }: Route.ActionArgs) {
  const fd = await request.formData();

  const body: Credentials = {
    email: String(fd.get("email") ?? ""),
    password: String(fd.get("password") ?? ""),
  };

  const res = await fetch(`${process.env.API_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    return data(
      {
        error:
          res.status === 401
            ? "Invalid email or password"
            : "Could not log in, please try again",
      },
      { status: res.status },
    );
  }

  const tokens: LoggedIn = await res.json();
  const session = await getSession(request.headers.get("Cookie"));
  session.set("access_token", tokens.access_token);
  session.set("refresh_token", tokens.refresh_token);
  session.set("expires_at", tokens.expires_at);
  return redirect("/dashboard", { headers: { "Set-Cookie": await commitSession(session) } });
}

export default function LogInRoute({ actionData }: Route.ComponentProps) {
  return <LogIn error={actionData?.error ?? null} />;
}
