import { createCookieSessionStorage, type Session } from "react-router";
import type { LoggedIn } from "~/models/auth";

// One day, in seconds. Every commitSession restarts the clock.
const MAX_AGE = 60 * 60 * 24;

// Built per call, so a missing SESSION_SECRET breaks login rather than the whole
// site, and tests can stub it the same way they stub API_URL.
function storage() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is not set");
  return createCookieSessionStorage<LoggedIn>({
    cookie: {
      name: "__session",
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: MAX_AGE,
      secrets: [secret],
    },
  });
}

export function getSession(cookieHeader: string | null) {
  return storage().getSession(cookieHeader);
}

export function commitSession(session: Session<LoggedIn>) {
  return storage().commitSession(session);
}

export function destroySession(session: Session<LoggedIn>) {
  return storage().destroySession(session);
}
