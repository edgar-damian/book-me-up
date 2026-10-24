import type { Route } from "./+types/signup";
import { SignUp } from "../pages/SignUp";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Sign up" }];
}

// No action until the API has a sign-up endpoint, so there is never an error to show.
export default function SignUpRoute() {
  return <SignUp error={null} />;
}
