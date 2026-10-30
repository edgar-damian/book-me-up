import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { action, loader } from "~/routes/logout";
import { commitSession, getSession } from "~/sessions.server";

const API_URL = "http://api.test";
const NOW = 1_800_000_000; // unix seconds
const RENEWED = { access_token: "access-2", refresh_token: "refresh-2", expires_at: NOW + 3600 };
const CLEARED = "Expires=Thu, 01 Jan 1970";

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

const logOut = (cookieHeader?: string) =>
  action({
    request: new Request("http://localhost/logout", {
      method: "POST",
      headers: cookieHeader ? { Cookie: cookieHeader } : {},
    }),
  } as Parameters<typeof action>[0]);

describe("logout action", () => {
  it("ends the session with the API, then clears the cookie and goes to /login", async () => {
    const fetchMock = stubApi({ "/auth/logout": { status: 204 } });

    const response = await logOut(await cookie(3600));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${API_URL}/auth/logout`);
    expect(init?.method).toBe("POST");
    expect(init?.headers).toEqual({ Authorization: "Bearer access-1" });
    expect(response.headers.get("Location")).toBe("/login");
    expect(response.headers.get("Set-Cookie")).toContain(CLEARED);
  });

  it("renews a token with under a minute left, so the API takes it", async () => {
    const fetchMock = stubApi({
      "/auth/refresh": { status: 200, body: RENEWED },
      "/auth/logout": { status: 204 },
    });

    const response = await logOut(await cookie(30));

    const [[refreshUrl], [logoutUrl, logoutInit]] = fetchMock.mock.calls;
    expect(refreshUrl).toBe(`${API_URL}/auth/refresh`);
    expect(logoutUrl).toBe(`${API_URL}/auth/logout`);
    expect(logoutInit?.headers).toEqual({ Authorization: "Bearer access-2" });
    expect(response.headers.get("Set-Cookie")).toContain(CLEARED);
  });

  it.each([
    ["answers 503", async () => new Response(null, { status: 503 })],
    [
      "can't be reached",
      async () => {
        throw new TypeError("fetch failed");
      },
    ],
  ])("still clears the cookie when the API %s", async (_, answer) => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(answer));

    const response = await logOut(await cookie(3600));

    expect(response.headers.get("Location")).toBe("/login");
    expect(response.headers.get("Set-Cookie")).toContain(CLEARED);
  });

  it("clears the cookie without asking the API when the refresh token is spent", async () => {
    const fetchMock = stubApi({ "/auth/refresh": { status: 401 } });

    const response = await logOut(await cookie(30));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(response.headers.get("Location")).toBe("/login");
    expect(response.headers.get("Set-Cookie")).toContain(CLEARED);
  });

  it("goes to /login without calling the API when there's no session", async () => {
    const fetchMock = stubApi({});

    const response = await logOut();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(response.headers.get("Location")).toBe("/login");
  });
});

describe("logout loader", () => {
  it("sends a GET back to the dashboard and ends nothing", () => {
    const fetchMock = stubApi({});

    const response = loader();

    expect(response.headers.get("Location")).toBe("/dashboard");
    expect(response.headers.get("Set-Cookie")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
