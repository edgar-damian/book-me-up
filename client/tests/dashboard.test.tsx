import { render, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Me } from "~/models/auth";
import DashboardRoute, { loader } from "~/routes/dashboard";
import { commitSession, getSession } from "~/sessions.server";

const API_URL = "http://api.test";
const NOW = 1_800_000_000; // unix seconds
const ME: Me = {
  first_name: "Ada",
  last_name: "Lovelace",
  email: "ada@example.com",
  has_worker_profile: true,
  has_shop: true,
  is_live: true,
};
const RENEWED = { access_token: "access-2", refresh_token: "refresh-2", expires_at: NOW + 3600 };

beforeEach(() => {
  vi.stubEnv("SESSION_SECRET", "test-secret");
  vi.stubEnv("API_URL", API_URL);
  vi.spyOn(Date, "now").mockReturnValue(NOW * 1000);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** The cookie a logged-in visitor sends, holding a token that expires in `expiresIn` seconds. */
async function cookie(expiresIn: number) {
  const session = await getSession(null);
  session.set("access_token", "access-1");
  session.set("refresh_token", "refresh-1");
  session.set("expires_at", NOW + expiresIn);
  return (await commitSession(session)).split(";")[0];
}

/** fetch answering each API path with its status, and its body as JSON when given. */
function stubApi(answers: Record<string, { status: number; body?: unknown }>) {
  const fetchMock = vi.fn<typeof fetch>(async (input) => {
    const { status, body } = answers[String(input).replace(API_URL, "")];
    return new Response(body === undefined ? null : JSON.stringify(body), { status });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const load = (cookieHeader?: string) =>
  loader({
    request: new Request("http://localhost/dashboard", {
      headers: cookieHeader ? { Cookie: cookieHeader } : {},
    }),
  } as Parameters<typeof loader>[0]);

/** What a loader threw, as the Response it should be. */
async function thrown(promise: Promise<unknown>) {
  const error = await promise.catch((e: unknown) => e);
  expect(error).toBeInstanceOf(Response);
  return error as Response;
}

describe("dashboard loader", () => {
  it("sends a visitor without the cookie to /login", async () => {
    const response = await thrown(load());

    expect(response.headers.get("Location")).toBe("/login");
  });

  it("asks /auth/me with the token, and leaves a fresh cookie alone", async () => {
    const fetchMock = stubApi({ "/auth/me": { status: 200, body: ME } });

    const result = await load(await cookie(3600));

    expect(result.data).toEqual(ME);
    expect(result.init).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${API_URL}/auth/me`);
    expect(init?.headers).toEqual({ Authorization: "Bearer access-1" });
  });

  it("renews a token with under a minute left before asking /auth/me", async () => {
    const fetchMock = stubApi({
      "/auth/refresh": { status: 200, body: RENEWED },
      "/auth/me": { status: 200, body: ME },
    });

    const result = await load(await cookie(30));

    const [[refreshUrl, refreshInit], [meUrl, meInit]] = fetchMock.mock.calls;
    expect(refreshUrl).toBe(`${API_URL}/auth/refresh`);
    expect(refreshInit?.method).toBe("POST");
    expect(JSON.parse(String(refreshInit?.body))).toEqual({ refresh_token: "refresh-1" });
    expect(meUrl).toBe(`${API_URL}/auth/me`);
    expect(meInit?.headers).toEqual({ Authorization: "Bearer access-2" });

    const setCookie = new Headers(result.init?.headers).get("Set-Cookie") ?? "";
    expect((await getSession(setCookie.split(";")[0])).data).toEqual(RENEWED);
  });

  it("logs the visitor out when the refresh token can't be traded", async () => {
    const fetchMock = stubApi({ "/auth/refresh": { status: 401 } });

    const response = await thrown(load(await cookie(30)));

    expect(response.headers.get("Location")).toBe("/login");
    expect(response.headers.get("Set-Cookie")).toContain("Expires=Thu, 01 Jan 1970");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("logs the visitor out when /auth/me rejects the token", async () => {
    stubApi({ "/auth/me": { status: 401 } });

    const response = await thrown(load(await cookie(3600)));

    expect(response.headers.get("Location")).toBe("/login");
    expect(response.headers.get("Set-Cookie")).toContain("Expires=Thu, 01 Jan 1970");
  });

  it("is a 503 when the API is unavailable", async () => {
    stubApi({ "/auth/me": { status: 503 } });

    const response = await thrown(load(await cookie(3600)));

    expect(response.status).toBe(503);
  });

  it("sends a worker who hasn't finished setup to /onboarding, keeping a renewed cookie", async () => {
    stubApi({
      "/auth/refresh": { status: 200, body: RENEWED },
      "/auth/me": { status: 200, body: { ...ME, is_live: false } },
      "/dashboard/profile": { status: 404 },
      "/dashboard/chairs": { status: 200, body: [] },
      "/dashboard/services": { status: 200, body: [] },
    });

    const response = await thrown(load(await cookie(30)));

    expect(response.headers.get("Location")).toBe("/onboarding");
    const setCookie = response.headers.get("Set-Cookie") ?? "";
    expect((await getSession(setCookie.split(";")[0])).data).toEqual(RENEWED);
  });

  it("lets in a worker waiting on their shop", async () => {
    const waiting = { ...ME, is_live: false };
    stubApi({
      "/auth/me": { status: 200, body: waiting },
      "/dashboard/profile": {
        status: 200,
        body: {
          slug: "ada-lovelace",
          first_name: "Ada",
          last_name: "Lovelace",
          bio: "",
          public_email: null,
          public_phone: null,
          is_active: false,
        },
      },
      "/dashboard/chairs": {
        status: 200,
        body: [
          {
            id: "0000000c-0000-4000-8000-000000000001",
            shop: { slug: "krusty-fadez", name: "Krusty Fadez" },
            is_active: false,
            schedule_days: [
              {
                day_of_week: 1,
                start_minute: 540,
                end_minute: 1020,
                break_start_minute: null,
                break_end_minute: null,
              },
            ],
          },
        ],
      },
      "/dashboard/services": {
        status: 200,
        body: [
          {
            id: "0000000d-0000-4000-8000-000000000001",
            title: "Skin fade",
            description: "",
            price_cents: 3500,
            duration_min: 45,
            buffer_after_min: 0,
          },
        ],
      },
    });

    const result = await load(await cookie(3600));

    expect(result.data).toEqual(waiting);
  });
});

describe("dashboard page", () => {
  it("greets the user by first name", async () => {
    const Stub = createRoutesStub([{ path: "/dashboard", Component: DashboardRoute, loader: () => ME }]);
    render(<Stub initialEntries={["/dashboard"]} />);

    expect(await screen.findByText("Hi, Ada. You're logged in.")).toBeInTheDocument();
  });

  it("uses the worker header, whose wordmark stays on the dashboard", async () => {
    const Stub = createRoutesStub([{ path: "/dashboard", Component: DashboardRoute, loader: () => ME }]);
    render(<Stub initialEntries={["/dashboard"]} />);

    expect(await screen.findByRole("link", { name: /dashboard/ })).toHaveAttribute("href", "/dashboard");
  });
});
