import { render, screen } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { createRoutesStub } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Me } from "~/models/auth";
import DashboardRoute from "~/routes/dashboard";
import LogInRoute, { action as loginAction } from "~/routes/login";
import { getSession } from "~/sessions.server";

const API_URL = "http://api.test";
const TOKENS = { access_token: "access", refresh_token: "refresh", expires_at: 1_800_000_000 };
const ME: Me = {
  first_name: "Ana",
  last_name: "Lopez",
  email: "ana@example.com",
  has_worker_profile: false,
  has_shop: false,
  is_live: true,
};

beforeEach(() => {
  vi.stubEnv("SESSION_SECRET", "test-secret");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

/** fetch answering every request with `status`, and with `body` as JSON when given. */
function stubApi(status: number, body?: unknown) {
  vi.stubEnv("API_URL", API_URL);
  const fetchMock = vi.fn<typeof fetch>(
    async () => new Response(body === undefined ? null : JSON.stringify(body), { status }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** The real login route and action. The stub keeps no cookies, so the dashboard's loader is a stand-in. */
function renderLogin() {
  const Stub = createRoutesStub([
    { path: "/login", Component: LogInRoute, action: loginAction },
    { path: "/dashboard", Component: DashboardRoute, loader: () => ME },
  ]);
  render(<Stub initialEntries={["/login"]} />);
  return userEvent.setup();
}

async function logIn(user: UserEvent) {
  await user.type(screen.getByLabelText("Email"), "ana@example.com");
  await user.type(screen.getByLabelText("Password"), "hunter2");
  await user.click(screen.getByRole("button", { name: "Log in" }));
}

describe("login action", () => {
  it("sends the email and password to POST /auth/login as JSON and opens the dashboard", async () => {
    const fetchMock = stubApi(200, TOKENS);
    await logIn(renderLogin());

    expect(await screen.findByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${API_URL}/auth/login`);
    expect(init?.method).toBe("POST");
    expect(init?.headers).toEqual({ "Content-Type": "application/json" });
    expect(JSON.parse(String(init?.body))).toEqual({ email: "ana@example.com", password: "hunter2" });
  });

  it("keeps the tokens in an httpOnly cookie", async () => {
    stubApi(200, TOKENS);
    const request = new Request("http://localhost/login", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "email=ana%40example.com&password=hunter2",
    });
    const response = await loginAction({ request } as Parameters<typeof loginAction>[0]);

    expect(response).toBeInstanceOf(Response);
    const { headers } = response as Response;
    expect(headers.get("Location")).toBe("/dashboard");
    const cookie = headers.get("Set-Cookie") ?? "";
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect((await getSession(cookie.split(";")[0])).data).toEqual(TOKENS);
  });

  it("says the email or password is wrong when the API answers 401", async () => {
    stubApi(401);
    await logIn(renderLogin());

    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid email or password");
  });

  it("offers a retry when the API is unavailable", async () => {
    stubApi(503);
    await logIn(renderLogin());

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not log in, please try again");
  });
});
