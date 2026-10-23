import type { Route } from "./+types/login";
import { LogIn } from "../pages/LogIn";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Log in" }];
}

// Placeholder until sign-in goes through Supabase Auth.
export function action() {
  return { error: "Logging in is not available yet" };
}

export default function LogInRoute({ actionData }: Route.ComponentProps) {
  return <LogIn error={actionData?.error ?? null} />;
}
