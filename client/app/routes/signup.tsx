import { data, redirect } from "react-router";
import type { Route } from "./+types/signup";
import { SignUp } from "../pages/SignUp";
import type { LoggedIn, NewAppUser } from "~/models/auth";
import { commitSession, getSession } from "~/sessions.server";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Sign up" }];
}

/** The message for each way the API can refuse a sign-up. */
async function refusal(res: Response) {
  if (res.status === 409) return "An account already uses this email";
  if (res.status === 403) return "Sign-ups are closed right now";
  if (res.status === 422) {
    // The API's own refusals carry a sentence; FastAPI's validation errors carry a list.
    const detail = await res.json().then(
      (body) => body?.detail,
      () => undefined,
    );
    return typeof detail === "string" ? detail : "Check your details, then try again";
  }
  return "Could not sign up, please try again";
}

export async function action({ request }: Route.ActionArgs) {
  const fd = await request.formData();

  // The page checks this before submitting. Checked again for a browser without
  // JavaScript, which would otherwise create an account nobody confirmed the password for.
  const password = String(fd.get("password") ?? "");
  if (password !== String(fd.get("confirm_password") ?? "")) {
    return data({ error: "Passwords don't match" }, { status: 422 });
  }

  const body: NewAppUser = {
    first_name: String(fd.get("first_name") ?? ""),
    last_name: String(fd.get("last_name") ?? ""),
    email: String(fd.get("email") ?? ""),
    phone: String(fd.get("phone") ?? ""),
    password,
  };

  const res = await fetch(`${process.env.API_URL}/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    return data({ error: await refusal(res) }, { status: res.status });
  }

  const tokens: LoggedIn = await res.json();
  const session = await getSession(request.headers.get("Cookie"));
  session.set("access_token", tokens.access_token);
  session.set("refresh_token", tokens.refresh_token);
  session.set("expires_at", tokens.expires_at);
  return redirect("/onboarding", { headers: { "Set-Cookie": await commitSession(session) } });
}

export default function SignUpRoute({ actionData }: Route.ComponentProps) {
  return <SignUp error={actionData?.error ?? null} />;
}
