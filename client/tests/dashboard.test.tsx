import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRoutesStub, data, redirect } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Me } from "~/models/auth";
import type { MyAppointment, MyChair, MyDay, MyService, MyWeek, MyWorkerProfile } from "~/models/dashboard";
import DashboardRoute, { action, loader } from "~/routes/dashboard";
import { commitSession, getSession } from "~/sessions.server";
import type { Editing } from "~/widgets/Dashboard/editDialog";
import { expectHeadingOutline } from "./helpers";

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
const PROFILE: MyWorkerProfile = {
  slug: "ada-cuts",
  first_name: "Ada",
  last_name: "Lovelace",
  bio: "Fades and beard work.",
  public_email: "ada@example.com",
  public_phone: "+15125550100",
  is_active: true,
};
/** Monday, 9:00 to 17:00. */
const MONDAY = { day_of_week: 1, start_minute: 540, end_minute: 1020, break_start_minute: null, break_end_minute: null };
const JOINED: MyChair = {
  id: "0000000c-0000-4000-8000-000000000002",
  shop: { slug: "regular-cutz", name: "Regular Cutz" },
  is_active: true,
  schedule_days: [MONDAY],
};
const WAITING: MyChair = {
  id: "0000000c-0000-4000-8000-000000000001",
  shop: { slug: "krusty-fadez", name: "Krusty Fadez" },
  is_active: false,
  schedule_days: [],
};
/** A second shop the worker has joined. */
const FADE_LAB: MyChair = {
  id: "0000000c-0000-4000-8000-000000000003",
  shop: { slug: "fade-lab", name: "Fade Lab" },
  is_active: true,
  schedule_days: [MONDAY],
};

/** A booking at Regular Cutz, which keeps Los Angeles time. */
const booking = (id: number, fields: Omit<MyAppointment, "id">): MyAppointment => ({
  id: `00000007-0000-4000-8000-00000000000${id}`,
  ...fields,
});
const DANIEL = booking(1, {
  starts_at: "2026-10-30T16:00:00Z", // 9:00 AM in Los Angeles
  duration_min: 45,
  client_name: "Daniel Kim",
  service_title: "Skin fade",
  price_cents: 3500,
  status: "ACCEPTED",
});
const CHRIS = booking(2, {
  starts_at: "2026-10-30T17:00:00Z", // 10:00 AM
  duration_min: 60,
  client_name: "Chris Alvarez",
  service_title: "Haircut + beard trim",
  price_cents: 5000,
  status: "PENDING",
});
const SAM = booking(3, {
  starts_at: "2026-10-30T20:00:00Z", // 1:00 PM
  duration_min: 45,
  client_name: "Sam Whitaker",
  service_title: "Hot towel shave",
  price_cents: 4500,
  status: "REJECTED",
});
const ETHAN = booking(4, {
  starts_at: "2026-11-02T17:30:00Z", // 9:30 AM, after the clocks go back
  duration_min: 20,
  client_name: "Ethan Brooks",
  service_title: "Buzz cut",
  price_cents: 2500,
  status: "PENDING",
});
const day = (date: string, appointments: MyAppointment[] = [], day_off = false): MyDay => ({
  day: date,
  day_off,
  appointments,
});
/** Friday, October 30 to Thursday, November 5, closed on Sundays and Thursdays. */
const WEEK: MyWeek = {
  timezone: "America/Los_Angeles",
  days: [
    day("2026-10-30", [DANIEL, CHRIS, SAM]),
    day("2026-10-31"),
    day("2026-11-01", [], true),
    day("2026-11-02", [ETHAN]),
    day("2026-11-03"),
    day("2026-11-04"),
    day("2026-11-05", [], true),
  ],
};
const SKIN_FADE: MyService = {
  id: "0000000d-0000-4000-8000-000000000001",
  title: "Skin fade",
  description: "Includes lineup.",
  price_cents: 3500,
  duration_min: 45,
  buffer_after_min: 10,
};

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

const load = (cookieHeader?: string, search = "") =>
  loader({
    request: new Request(`http://localhost/dashboard${search}`, {
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
    const fetchMock = stubApi({
      "/auth/me": { status: 200, body: ME },
      "/dashboard/chairs": { status: 200, body: [] },
    });

    const result = await load(await cookie(3600));

    expect(result.init).toBeNull();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${API_URL}/auth/me`);
    expect(init?.headers).toEqual({ Authorization: "Bearer access-1" });
  });

  it("shows the week at the first shop the worker has joined, as the worker", async () => {
    const fetchMock = stubApi({
      "/auth/me": { status: 200, body: ME },
      "/dashboard/chairs": { status: 200, body: [WAITING, JOINED] },
      [`/dashboard/chairs/${JOINED.id}/appointments`]: { status: 200, body: WEEK },
    });

    const result = await load(await cookie(3600));

    expect(result.data).toEqual({ editing: null, chairs: [WAITING, JOINED], chair: JOINED, week: WEEK });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    for (const [, init] of fetchMock.mock.calls) {
      expect(init?.headers).toEqual({ Authorization: "Bearer access-1" });
    }
  });

  it("shows the week at the shop ?chair= names", async () => {
    stubApi({
      "/auth/me": { status: 200, body: ME },
      "/dashboard/chairs": { status: 200, body: [JOINED, FADE_LAB] },
      [`/dashboard/chairs/${FADE_LAB.id}/appointments`]: { status: 200, body: WEEK },
    });

    const result = await load(await cookie(3600), `?chair=${FADE_LAB.id}`);

    expect(result.data).toMatchObject({ chair: FADE_LAB, week: WEEK });
  });

  it("shows the first shop when ?chair= names a request still waiting", async () => {
    stubApi({
      "/auth/me": { status: 200, body: ME },
      "/dashboard/chairs": { status: 200, body: [WAITING, JOINED] },
      [`/dashboard/chairs/${JOINED.id}/appointments`]: { status: 200, body: WEEK },
    });

    const result = await load(await cookie(3600), `?chair=${WAITING.id}`);

    expect(result.data).toMatchObject({ chair: JOINED, week: WEEK });
  });

  it("logs the visitor out when the API rejects the token for the week", async () => {
    stubApi({
      "/auth/me": { status: 200, body: ME },
      "/dashboard/chairs": { status: 200, body: [JOINED] },
      [`/dashboard/chairs/${JOINED.id}/appointments`]: { status: 401 },
    });

    const response = await thrown(load(await cookie(3600)));

    expect(response.headers.get("Location")).toBe("/login");
  });

  it("renews a token with under a minute left before asking /auth/me", async () => {
    const fetchMock = stubApi({
      "/auth/refresh": { status: 200, body: RENEWED },
      "/auth/me": { status: 200, body: ME },
      "/dashboard/chairs": { status: 200, body: [] },
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

    // No shop has accepted them yet, so there is no week to ask for.
    expect(result.data).toMatchObject({ editing: null, chair: null, week: null });
  });

  /** What the API holds for a live worker: a profile, a service, and these chairs, each with WEEK. */
  const saved = (chairs: MyChair[]) => ({
    "/auth/me": { status: 200, body: ME },
    "/dashboard/profile": { status: 200, body: PROFILE },
    "/dashboard/chairs": { status: 200, body: chairs },
    "/dashboard/services": { status: 200, body: [SKIN_FADE] },
    ...Object.fromEntries(
      chairs.map((c) => [`/dashboard/chairs/${c.id}/appointments`, { status: 200, body: WEEK }]),
    ),
  });

  it("opens the hours at the shop the worker has joined, over a request still waiting", async () => {
    const fetchMock = stubApi(saved([WAITING, JOINED]));

    const result = await load(await cookie(3600), "?edit=schedule");

    expect(result.data.editing).toEqual({ edit: "schedule", chairs: [WAITING, JOINED], chair: JOINED });
    // The chairs the setup read serve the week too.
    expect(fetchMock.mock.calls.filter(([url]) => url === `${API_URL}/dashboard/chairs`)).toHaveLength(1);
  });

  it("opens the hours at the shop ?chair= names", async () => {
    stubApi(saved([WAITING, JOINED]));

    const result = await load(await cookie(3600), `?edit=schedule&chair=${WAITING.id}`);

    expect(result.data.editing).toMatchObject({ edit: "schedule", chair: WAITING });
  });

  it.each([
    { edit: "profile", editing: { edit: "profile", profile: PROFILE } },
    { edit: "services", editing: { edit: "services", services: [SKIN_FADE] } },
  ])("opens the $edit", async ({ edit, editing }) => {
    stubApi(saved([JOINED]));

    const result = await load(await cookie(3600), `?edit=${edit}`);

    expect(result.data.editing).toEqual(editing);
  });

  it.each([
    { what: "a part it doesn't know, like time off", search: "?edit=time-off", chairs: [JOINED] },
    { what: "hours without a current chair", search: "?edit=schedule", chairs: [] },
  ])("opens nothing for $what", async ({ search, chairs }) => {
    stubApi(saved(chairs));

    const result = await load(await cookie(3600), search);

    expect(result.data.editing).toBeNull();
  });
});

describe("dashboard action", () => {
  /** What the profile form posts. */
  const PROFILE_FORM = {
    intent: "worker-profile",
    slug: "ada-cuts",
    first_name: "Ada",
    last_name: "Lovelace",
    bio: "Fades and beard work.",
    public_email: "ada@example.com",
    public_phone: "+15125550100",
  };
  /** What the hours form posts with Monday on. */
  const HOURS_FORM = {
    intent: "worker-hours",
    chair: JOINED.id,
    "open-1": "on",
    "start-1": "09:00",
    "end-1": "17:00",
    "break-start-1": "",
    "break-end-1": "",
  };
  /** What the services form posts with one saved service. */
  const SERVICES_FORM = {
    intent: "worker-services",
    service: SKIN_FADE.id,
    [`id-${SKIN_FADE.id}`]: SKIN_FADE.id,
    [`title-${SKIN_FADE.id}`]: "Skin fade",
    [`description-${SKIN_FADE.id}`]: "Includes lineup.",
    [`price-${SKIN_FADE.id}`]: "35.00",
    [`duration-${SKIN_FADE.id}`]: "45",
    [`buffer-${SKIN_FADE.id}`]: "10",
  };

  /** The real action, called the way the dialog's Save would call it from `search`. */
  const post = async (fields: Record<string, string>, search = "") =>
    action({
      request: new Request(`http://localhost/dashboard${search}`, {
        method: "POST",
        headers: { Cookie: await cookie(3600) },
        body: new URLSearchParams(fields),
      }),
    } as Parameters<typeof action>[0]);

  it.each([
    { form: "profile", fields: PROFILE_FORM, path: "/dashboard/profile", body: PROFILE },
    { form: "hours", fields: HOURS_FORM, path: `/dashboard/chairs/${JOINED.id}/schedule`, body: [MONDAY] },
    { form: "services", fields: SERVICES_FORM, path: "/dashboard/services", body: [SKIN_FADE] },
  ])("PUTs the $form form as the user, then closes the dialog", async ({ fields, path, body }) => {
    const fetchMock = stubApi({ [path]: { status: 200, body } });

    const response = await post(fields);

    expect((response as Response).headers.get("Location")).toBe("/dashboard");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${API_URL}${path}`);
    expect(init?.method).toBe("PUT");
    expect(init?.headers).toEqual({ Authorization: "Bearer access-1", "Content-Type": "application/json" });
  });

  it("closes the dialog onto the shop the dashboard was showing", async () => {
    stubApi({ "/dashboard/profile": { status: 200, body: PROFILE } });

    const response = await post(PROFILE_FORM, `?edit=profile&chair=${FADE_LAB.id}`);

    expect((response as Response).headers.get("Location")).toBe(`/dashboard?chair=${FADE_LAB.id}`);
  });

  it("keeps the dialog open with the API's refusal", async () => {
    stubApi({ "/dashboard/profile": { status: 409 } });

    const result = await post(PROFILE_FORM);

    expect(result).toMatchObject({ data: { error: "That link is taken, try another" }, init: { status: 409 } });
  });

  it.each(["connect-shop", "go-live"])("refuses the %s form without calling the API", async (intent) => {
    const fetchMock = stubApi({});

    const response = await thrown(post({ intent, slug: "krusty-fadez" }));

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("logs the visitor out when the API rejects the token", async () => {
    stubApi({ "/dashboard/profile": { status: 401 } });

    const response = await thrown(post(PROFILE_FORM));

    expect(response.headers.get("Location")).toBe("/login");
  });
});

describe("dashboard page", () => {
  /** What the stand-in loader opens for ?edit= and ?chair=, the first chair by default. */
  function editingAt(url: string, chairs: MyChair[]): Editing | null {
    const params = new URL(url).searchParams;
    const chair = chairs.find((c) => c.id === params.get("chair")) ?? chairs[0];
    switch (params.get("edit")) {
      case "profile":
        return { edit: "profile", profile: PROFILE };
      case "schedule":
        return { edit: "schedule", chairs, chair };
      case "services":
        return { edit: "services", services: [SKIN_FADE] };
      default:
        return null;
    }
  }

  /**
   * The real route component, with a stand-in action and a stand-in loader that
   * follows the URL: the week is at the shop ?chair= names, else the first joined.
   */
  function renderPage(
    url = "/dashboard",
    { chairs = [JOINED], week = WEEK, refusal }: { chairs?: MyChair[]; week?: MyWeek; refusal?: string } = {},
  ) {
    const posted: FormData[] = [];
    const pageAction = vi.fn(async ({ request }: { request: Request }) => {
      posted.push(await request.formData());
      return refusal ? data({ error: refusal }, { status: 409 }) : redirect("/dashboard");
    });
    const Stub = createRoutesStub([
      {
        path: "/dashboard",
        Component: DashboardRoute,
        loader: ({ request }: { request: Request }) => {
          const shops = chairs.filter((c) => c.is_active);
          const named = new URL(request.url).searchParams.get("chair");
          const chair = shops.find((c) => c.id === named) ?? shops.at(0) ?? null;
          return { editing: editingAt(request.url, chairs), chairs, chair, week: chair && week };
        },
        action: pageAction,
      },
    ]);
    render(<Stub initialEntries={[url]} />);
    return { user: userEvent.setup(), posted };
  }

  const opened = (name: string) => screen.findByRole("dialog", { name });
  /** The day card whose heading starts with `title`. */
  const card = async (title: string) =>
    (await screen.findByRole("heading", { level: 2, name: new RegExp(`^${title}`) })).closest("section")!;

  it("lists the week under Upcoming appointments, with the requests waiting", async () => {
    renderPage();

    expect(await screen.findByRole("heading", { level: 1, name: "Upcoming appointments" })).toBeInTheDocument();
    expect(screen.getByText(/your response/)).toHaveTextContent("2 requests need your response.");
    const days = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(days.slice(0, 7)).toEqual([
      "Today Friday, October 30",
      "Tomorrow Saturday, October 31",
      "Sunday November 1",
      "Monday November 2",
      "Tuesday November 3",
      "Wednesday November 4",
      "Thursday November 5",
    ]);
    expectHeadingOutline();
  });

  it("shows each booking's time, length, client, service, price, and status on the shop's clock", async () => {
    renderPage();
    const today = await card("Today");

    expect(within(today).getByText("3 appointments")).toBeInTheDocument();
    const rows = within(today).getAllByRole("listitem");
    expect(rows).toHaveLength(3);
    const daniel = within(rows[0]);
    // ICU puts a narrow no-break space before AM and PM.
    expect(daniel.getByText(/^9:00\sAM$/)).toBeInTheDocument();
    expect(daniel.getByText("45 min")).toBeInTheDocument();
    expect(daniel.getByText("Daniel Kim")).toBeInTheDocument();
    expect(daniel.getByText("Skin fade")).toBeInTheDocument();
    expect(daniel.getByText("$35.00")).toBeInTheDocument();
    expect(daniel.getByText("Accepted")).toBeInTheDocument();
    expect(within(rows[2]).getByText("Rejected")).toBeInTheDocument();
    // Monday is after the clocks go back, and still reads as 9:30.
    expect(within(await card("Monday")).getByText(/^9:30\sAM$/)).toBeInTheDocument();
  });

  it("offers Accept and Reject on requests only, and neither does anything yet", async () => {
    const { user, posted } = renderPage();
    const today = await card("Today");

    const accept = within(today).getByRole("button", { name: /^Accept Chris Alvarez at 10:00\sAM$/ });
    expect(within(today).getByRole("button", { name: /^Reject Chris Alvarez at 10:00\sAM$/ })).toBeInTheDocument();
    expect(within(today).getAllByRole("button")).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: /^Accept / })).toHaveLength(2);
    expect(screen.queryByRole("button", { name: /cancel/i })).not.toBeInTheDocument();

    await user.click(accept);

    expect(posted).toHaveLength(0);
    expect(within(today).getByText("Pending")).toBeInTheDocument();
  });

  it("says when a day has nothing booked yet, and when it's a day off", async () => {
    renderPage();

    expect(within(await card("Tomorrow")).getByText("No appointments yet")).toBeInTheDocument();
    const sunday = await card("Sunday");
    expect(within(sunday).getByText("Day off")).toBeInTheDocument();
    expect(within(sunday).queryByRole("list")).not.toBeInTheDocument();
  });

  it("says when nothing is booked today, and still lists bookings on a day off", async () => {
    const saturday = { ...DANIEL, starts_at: "2026-10-31T16:00:00Z" };
    renderPage("/dashboard", {
      week: { ...WEEK, days: [day("2026-10-30"), day("2026-10-31", [saturday], true), ...WEEK.days.slice(2)] },
    });

    expect(within(await card("Today")).getByText("No appointments today yet")).toBeInTheDocument();
    const tomorrow = await card("Tomorrow");
    expect(within(tomorrow).getByText("Daniel Kim")).toBeInTheDocument();
    expect(within(tomorrow).queryByText("Day off")).not.toBeInTheDocument();
  });

  it("counts a single request in the singular", async () => {
    renderPage("/dashboard", { week: { ...WEEK, days: [day("2026-10-30", [DANIEL, CHRIS])] } });

    expect(await screen.findByText(/your response/)).toHaveTextContent("1 request needs your response.");
  });

  it("leaves out the request line when nothing is waiting on the worker", async () => {
    renderPage("/dashboard", { week: { ...WEEK, days: [day("2026-10-30", [DANIEL, SAM])] } });

    await screen.findByRole("heading", { level: 1, name: "Upcoming appointments" });
    expect(screen.queryByText(/your response/)).not.toBeInTheDocument();
  });

  it("links each shop for a worker at more than one, and marks the one showing", async () => {
    const { user } = renderPage("/dashboard", { chairs: [JOINED, FADE_LAB, WAITING] });
    const shops = await screen.findByRole("navigation", { name: "Shops" });

    // A request still waiting isn't a shop with a week yet.
    expect(within(shops).getAllByRole("link").map((l) => l.textContent)).toEqual(["Regular Cutz", "Fade Lab"]);
    expect(within(shops).getByRole("link", { name: "Regular Cutz" })).toHaveAttribute("aria-current", "true");

    await user.click(within(shops).getByRole("link", { name: "Fade Lab" }));

    await waitFor(() =>
      expect(within(shops).getByRole("link", { name: "Fade Lab" })).toHaveAttribute("aria-current", "true"),
    );
    const nav = screen.getByRole("navigation", { name: "Primary" });
    expect(within(nav).getByRole("link", { name: "Hours" })).toHaveAttribute(
      "href",
      `/dashboard?edit=schedule&chair=${FADE_LAB.id}`,
    );
  });

  it("shows no shop links for a worker at one shop", async () => {
    renderPage();

    await screen.findByRole("heading", { level: 1, name: "Upcoming appointments" });
    expect(screen.queryByRole("navigation", { name: "Shops" })).not.toBeInTheDocument();
  });

  it("keeps the shop showing when a dialog closes", async () => {
    const { user } = renderPage(`/dashboard?chair=${FADE_LAB.id}&edit=profile`, { chairs: [JOINED, FADE_LAB] });
    const profile = await opened("Your profile");

    await user.click(within(profile).getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(profile).not.toBeInTheDocument());
    const shops = screen.getByRole("navigation", { name: "Shops" });
    expect(within(shops).getByRole("link", { name: "Fade Lab" })).toHaveAttribute("aria-current", "true");
  });

  it("tells a worker still waiting on their shop", async () => {
    renderPage("/dashboard", { chairs: [WAITING] });

    expect(await screen.findByText("We're waiting for Krusty Fadez to approve you.")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 2, name: /^Today/ })).not.toBeInTheDocument();
  });

  it("uses the worker header, whose wordmark stays on the dashboard", async () => {
    renderPage();

    expect(await screen.findByRole("link", { name: /dashboard/ })).toHaveAttribute("href", "/dashboard");
  });

  it("opens no dialog without ?edit=", async () => {
    renderPage();

    await screen.findByRole("heading", { level: 1, name: "Upcoming appointments" });
    expect(screen.queryByRole("dialog", { name: /^Your/ })).not.toBeInTheDocument();
  });

  it("opens Hours from the header, with Cancel and Save and none of the wizard", async () => {
    const { user } = renderPage();
    const nav = await screen.findByRole("navigation", { name: "Primary" });

    await user.click(within(nav).getByRole("link", { name: "Hours" }));

    const hours = await opened("Your hours");
    expect(within(hours).getByText("Your hours at Regular Cutz. Times are the shop's local time.")).toBeInTheDocument();
    expect(within(hours).getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(within(hours).getByRole("button", { name: "Save" })).toBeInTheDocument();
    expect(within(hours).queryByText("Next")).not.toBeInTheDocument();
    expect(within(hours).queryByText("Previous")).not.toBeInTheDocument();
    expect(within(hours).queryByRole("list", { name: "Setup progress" })).not.toBeInTheDocument();
    // One shop, so there is nothing to switch between.
    expect(within(hours).queryByRole("navigation", { name: "Shops" })).not.toBeInTheDocument();
  });

  it("opens the profile, starting from what's saved", async () => {
    renderPage("/dashboard?edit=profile");

    const profile = await opened("Your profile");
    expect(within(profile).getByRole("textbox", { name: "Your link" })).toHaveValue("ada-cuts");
  });

  it("opens the services, listing what's saved", async () => {
    renderPage("/dashboard?edit=services");

    const services = await opened("Your services");
    expect(within(services).getByRole("button", { name: "Edit Skin fade" })).toBeInTheDocument();
  });

  it("posts the open form on Save, named by its intent, then closes", async () => {
    const { user, posted } = renderPage("/dashboard?edit=schedule");
    const hours = await opened("Your hours");

    await user.click(within(hours).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(hours).not.toBeInTheDocument());
    expect(posted).toHaveLength(1);
    expect(posted[0].get("intent")).toBe("worker-hours");
    expect(posted[0].get("chair")).toBe(JOINED.id);
  });

  it("shows a refused save inside the dialog, which stays open", async () => {
    const { user } = renderPage("/dashboard?edit=profile", { refusal: "That link is taken, try another" });
    const profile = await opened("Your profile");

    await user.click(within(profile).getByRole("button", { name: "Save" }));

    expect(await within(profile).findByRole("alert")).toHaveTextContent("That link is taken, try another");
    expect(profile).toHaveAttribute("open");
  });

  it("closes on Cancel", async () => {
    const { user } = renderPage("/dashboard?edit=schedule");
    const hours = await opened("Your hours");

    await user.click(within(hours).getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(hours).not.toBeInTheDocument());
  });

  it("closes on Escape", async () => {
    renderPage("/dashboard?edit=schedule");
    const hours = await opened("Your hours");

    // jsdom doesn't turn Escape into the cancel event a browser fires at the dialog.
    fireEvent(hours, new Event("cancel", { cancelable: true }));

    await waitFor(() => expect(hours).not.toBeInTheDocument());
  });

  it("closes on a tap on the scrim, but not on one inside the sheet", async () => {
    const { user } = renderPage("/dashboard?edit=schedule");
    const hours = await opened("Your hours");

    await user.click(within(hours).getByRole("heading", { name: "Your hours" }));
    expect(hours).toHaveAttribute("open");

    await user.click(hours);

    await waitFor(() => expect(hours).not.toBeInTheDocument());
  });

  it("closes when the handle is pulled down far enough, and springs back when it isn't", async () => {
    renderPage("/dashboard?edit=schedule");
    const hours = await opened("Your hours");
    // The grab handle sits just above the title, hidden from assistive tech.
    const handle = within(hours).getByRole("heading", { name: "Your hours" }).previousElementSibling!;
    const pull = (to: number) => {
      fireEvent.pointerDown(handle, { pointerId: 1, clientY: 100 });
      fireEvent.pointerMove(handle, { pointerId: 1, clientY: to });
      fireEvent.pointerUp(handle, { pointerId: 1, clientY: to });
    };

    pull(150);
    expect(hours).toHaveAttribute("open");
    expect((handle.parentElement as HTMLElement).style.transform).toBe("");

    pull(300);

    await waitFor(() => expect(hours).not.toBeInTheDocument());
  });

  it("switches the hours between shops for a worker at more than one", async () => {
    const { user } = renderPage("/dashboard?edit=schedule", { chairs: [JOINED, WAITING] });
    const hours = await opened("Your hours");
    const shops = within(hours).getByRole("navigation", { name: "Shops" });
    expect(within(shops).getByRole("link", { name: "Regular Cutz" })).toHaveAttribute("aria-current", "true");

    await user.click(within(shops).getByRole("link", { name: "Krusty Fadez" }));

    expect(
      await within(hours).findByText("Your hours at Krusty Fadez. Times are the shop's local time."),
    ).toBeInTheDocument();
    expect(within(shops).getByRole("link", { name: "Krusty Fadez" })).toHaveAttribute("aria-current", "true");
  });
});
