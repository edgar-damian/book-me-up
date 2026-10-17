import { data } from "react-router";
import type { Route } from "./+types/waitlist";
import { WaitList } from "../pages/WaitList";
import type { JoinWaitlist } from "~/models/waitlist";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Waitlist" }];
}

export async function action({ request }: Route.ActionArgs) {
  const fd = await request.formData();

  const body: JoinWaitlist = {
    first_name: String(fd.get("first_name") ?? ""),
    last_name: String(fd.get("last_name") ?? ""),
    phone: String(fd.get("phone") ?? ""),
    email: String(fd.get("email") ?? ""),
  };

  const res = await fetch(`${process.env.API_URL}/waitlist`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    return data(
      {
        joined: false,
        error:
          res.status === 422
            ? "Check your name, phone, and email, then try again"
            : "Could not join the waitlist, please try again",
      },
      { status: res.status },
    );
  }

  return { joined: true, error: null };
}

export default function WaitListRoute({ actionData }: Route.ComponentProps) {
  return <WaitList joined={actionData?.joined ?? false} error={actionData?.error ?? null} />;
}
