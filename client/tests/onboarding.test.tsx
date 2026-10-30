import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLayoutEffect } from "react";
import { createRoutesStub } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Me } from "~/models/auth";
import type { MyChair, MyService, MyWorkerProfile, SaveWorkerProfile } from "~/models/dashboard";
import OnboardingRoute, { action, loader } from "~/routes/onboarding";
import { commitSession, getSession } from "~/sessions.server";
import { GoLive } from "~/widgets/Dashboard/goLive";
import type { StepKey } from "~/widgets/Dashboard/onboarding";
import { expectHeadingOutline } from "./helpers";

const API_URL = "http://api.test";
const NOW = 1_800_000_000; // unix seconds
const ME: Me = {
  first_name: "Ada",
  last_name: "Lovelace",
  email: "ada@example.com",
  has_worker_profile: false,
  has_shop: false,
  is_live: false,
};
const PROFILE: MyWorkerProfile = {
  slug: "ada-cuts",
  first_name: "Ada",
  last_name: "Lovelace",
  bio: "Fades and beard work.",
  public_email: "ada@example.com",
  public_phone: "+15125550100",
  is_active: false,
};
/** Where a new worker's form starts: their account's name, and a link made from it. */
const FIRST: SaveWorkerProfile = {
  slug: "ada-lovelace",
  first_name: "Ada",
  last_name: "Lovelace",
  bio: "",
  public_email: null,
  public_phone: null,
};
/** Monday, 9:00 to 17:00 with a break from 12:00 to 13:00. */
const MONDAY = {
  day_of_week: 1,
  start_minute: 540,
  end_minute: 1020,
  break_start_minute: 720,
  break_end_minute: 780,
};
const WAITING: MyChair = {
  id: "0000000c-0000-4000-8000-000000000001",
  shop: { slug: "krusty-fadez", name: "Krusty Fadez" },
  is_active: false,
  schedule_days: [],
};
const WITH_HOURS: MyChair = { ...WAITING, schedule_days: [MONDAY] };
const JOINED: MyChair = {
  id: "0000000c-0000-4000-8000-000000000002",
  shop: { slug: "regular-cutz", name: "Regular Cutz" },
  is_active: true,
  schedule_days: [MONDAY],
};
const SKIN_FADE: MyService = {
  id: "0000000d-0000-4000-8000-000000000001",
  title: "Skin fade",
  description: "Includes lineup.",
  price_cents: 3500,
  duration_min: 45,
  buffer_after_min: 10,
};
const BEARD_TRIM: MyService = {
  id: "0000000d-0000-4000-8000-000000000002",
  title: "Beard trim",
  description: "",
  price_cents: 2000,
  duration_min: 20,
  buffer_after_min: 0,
};
const RENEWED = { access_token: "access-2", refresh_token: "refresh-2", expires_at: NOW + 3600 };

beforeEach(() => {
  vi.stubEnv("SESSION_SECRET", "test-secret");
  vi.stubEnv("API_URL", API_URL);
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

/** What a loader or action threw, as the Response it should be. */
async function thrown(promise: Promise<unknown>) {
  const error = await promise.catch((e: unknown) => e);
  expect(error).toBeInstanceOf(Response);
  return error as Response;
}

describe("onboarding loader", () => {
  beforeEach(() => {
    vi.spyOn(Date, "now").mockReturnValue(NOW * 1000);
  });

  const load = (search: string, cookieHeader?: string) =>
    loader({
      request: new Request(`http://localhost/onboarding${search}`, {
        headers: cookieHeader ? { Cookie: cookieHeader } : {},
      }),
    } as Parameters<typeof loader>[0]);

  /** What the API holds for this worker. */
  const saved = (profile: MyWorkerProfile | null, chairs: MyChair[] = [], services: MyService[] = []) => ({
    "/dashboard/profile": profile ? { status: 200, body: profile } : { status: 404 },
    "/dashboard/chairs": { status: 200, body: chairs },
    "/dashboard/services": { status: 200, body: services },
  });

  it("sends a visitor without the cookie to /login", async () => {
    const response = await thrown(load(""));

    expect(response.headers.get("Location")).toBe("/login");
  });

  it("starts a new worker on the profile step, filled in from their account", async () => {
    const fetchMock = stubApi({ ...saved(null), "/auth/me": { status: 200, body: ME } });

    const result = await load("", await cookie(3600));

    expect(result.data).toEqual({
      step: "profile",
      profile: FIRST,
      chairs: [],
      chair: null,
      services: [],
      live: false,
    });
    expect(result.init).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(4);
    for (const [, init] of fetchMock.mock.calls) {
      expect(init?.headers).toEqual({ Authorization: "Bearer access-1" });
    }
  });

  it("keeps a new worker on the profile step whatever ?step= asks for", async () => {
    stubApi({ ...saved(null), "/auth/me": { status: 200, body: ME } });

    const result = await load("?step=services", await cookie(3600));

    expect(result.data.step).toBe("profile");
  });

  it("doesn't ask /auth/me once a profile is saved", async () => {
    const fetchMock = stubApi(saved(PROFILE));

    const result = await load("", await cookie(3600));

    expect(result.data).toEqual({
      step: "shop",
      profile: PROFILE,
      chairs: [],
      chair: null,
      services: [],
      live: false,
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("waits on the last step until the shop approves", async () => {
    stubApi(saved(PROFILE, [WITH_HOURS], [SKIN_FADE]));

    const result = await load("", await cookie(3600));

    expect(result.data.step).toBe("live");
    expect(result.data.live).toBe(false);
  });

  it.each([
    { saved: "a shop request", chairs: [WAITING], services: [], step: "schedule" },
    { saved: "hours", chairs: [WITH_HOURS], services: [], step: "services" },
    { saved: "services", chairs: [WITH_HOURS], services: [SKIN_FADE], step: "live" },
  ])("opens the step after $saved", async ({ chairs, services, step }) => {
    stubApi(saved(PROFILE, chairs, services));

    const result = await load("", await cookie(3600));

    expect(result.data.step).toBe(step);
  });

  it.each([
    { held: "a joined chair and a waiting request", chairs: [JOINED, WAITING], chair: WAITING },
    { held: "only a joined chair", chairs: [JOINED], chair: JOINED },
  ])("gives the hours step the request still waiting, holding $held", async ({ chairs, chair }) => {
    stubApi(saved(PROFILE, chairs));

    const result = await load("", await cookie(3600));

    expect(result.data.chair).toEqual(chair);
  });

  it.each([
    { step: "profile", chairs: [], services: [] },
    { step: "shop", chairs: [WAITING], services: [] },
    { step: "schedule", chairs: [WITH_HOURS], services: [] },
    { step: "services", chairs: [WITH_HOURS], services: [SKIN_FADE] },
  ])("lets a worker go back to the $step step once it's done", async ({ step, chairs, services }) => {
    stubApi(saved(PROFILE, chairs, services));

    const result = await load(`?step=${step}`, await cookie(3600));

    expect(result.data.step).toBe(step);
  });

  it("shows a live worker the last step, keeping a renewed cookie", async () => {
    stubApi({
      "/auth/refresh": { status: 200, body: RENEWED },
      ...saved({ ...PROFILE, is_active: true }, [JOINED], [SKIN_FADE]),
    });

    const result = await load("", await cookie(30));

    expect(result.data.step).toBe("live");
    expect(result.data.live).toBe(true);
    const setCookie = new Headers(result.init?.headers).get("Set-Cookie") ?? "";
    expect((await getSession(setCookie.split(";")[0])).data).toEqual(RENEWED);
  });

  it("lets a live worker go back to edit any step", async () => {
    stubApi(saved({ ...PROFILE, is_active: true }, [JOINED], [SKIN_FADE]));

    const result = await load("?step=services", await cookie(3600));

    expect(result.data.step).toBe("services");
  });

  it("logs the visitor out when the API rejects the token", async () => {
    stubApi({ ...saved(null), "/dashboard/profile": { status: 401 } });

    const response = await thrown(load("", await cookie(3600)));

    expect(response.headers.get("Location")).toBe("/login");
    expect(response.headers.get("Set-Cookie")).toContain("Expires=Thu, 01 Jan 1970");
  });

  it("is a 503 when the API is unavailable", async () => {
    stubApi({ ...saved(PROFILE), "/dashboard/services": { status: 503 } });

    const response = await thrown(load("", await cookie(3600)));

    expect(response.status).toBe(503);
  });
});

describe("onboarding action", () => {
  beforeEach(() => {
    vi.spyOn(Date, "now").mockReturnValue(NOW * 1000);
  });

  /** What the profile form posts. */
  const PROFILE_FORM = {
    intent: "worker-profile",
    slug: "ada-cuts",
    first_name: "Ada",
    last_name: "Lovelace",
    bio: "Fades and beard work.",
    public_email: "",
    public_phone: "+15125550100",
  };
  /** What the shop form posts. */
  const SHOP_FORM = { intent: "connect-shop", slug: "krusty-fadez" };
  /** What the hours form posts with Monday and Friday on. */
  const HOURS_FORM = {
    intent: "worker-hours",
    chair: WAITING.id,
    "open-1": "on",
    "start-1": "09:00",
    "end-1": "00:00",
    "break-start-1": "12:00",
    "break-end-1": "13:00",
    "open-5": "on",
    "start-5": "10:00",
    "end-5": "18:30",
    "break-start-5": "",
    "break-end-5": "",
  };
  const HOURS_URL = `/dashboard/chairs/${WAITING.id}/schedule`;

  /** One row of the services form, as the page posts it. */
  const serviceRow = (key: string, id: string, title: string, price: string, minutes: string) => [
    ["service", key],
    [`id-${key}`, id],
    [`title-${key}`, title],
    [`description-${key}`, ""],
    [`price-${key}`, price],
    [`duration-${key}`, minutes],
    [`buffer-${key}`, "0"],
  ];
  /** What the services form posts: a saved service, a new one, and a blank new row. */
  const SERVICES_FORM = [
    ["intent", "worker-services"],
    ...serviceRow(SKIN_FADE.id, SKIN_FADE.id, "Skin fade", "35.00", "45"),
    ...serviceRow("new-1", "", "Kids cut", "$25", "30"),
    ...serviceRow("new-2", "", "", "", ""),
  ];

  /** The real action, called the way a form post would call it. */
  const post = async (fields: Record<string, string> | string[][]) =>
    action({
      request: new Request("http://localhost/onboarding", {
        method: "POST",
        headers: { Cookie: await cookie(3600) },
        body: new URLSearchParams(fields),
      }),
    } as Parameters<typeof action>[0]);

  /** The one call the action made, as the API saw it. */
  function sent(fetchMock: ReturnType<typeof stubApi>) {
    const [url, init] = fetchMock.mock.calls[0];
    expect(init?.method).toBe("PUT");
    expect(init?.headers).toEqual({
      Authorization: "Bearer access-1",
      "Content-Type": "application/json",
    });
    return { url, body: JSON.parse(String(init?.body)) };
  }

  it("PUTs the profile as the user, blank fields as null, then opens the shop step", async () => {
    const fetchMock = stubApi({ "/dashboard/profile": { status: 200, body: PROFILE } });

    const response = await post(PROFILE_FORM);

    expect(response).toBeInstanceOf(Response);
    expect((response as Response).headers.get("Location")).toBe("/onboarding?step=shop");
    const { url, body } = sent(fetchMock);
    expect(url).toBe(`${API_URL}/dashboard/profile`);
    const { intent, ...fields } = PROFILE_FORM;
    expect(body).toEqual({ ...fields, public_email: null });
  });

  it("asks the shop by its link, then opens the hours step", async () => {
    const fetchMock = stubApi({ "/dashboard/join-request": { status: 200, body: WAITING } });

    const response = await post(SHOP_FORM);

    expect((response as Response).headers.get("Location")).toBe("/onboarding?step=schedule");
    const { url, body } = sent(fetchMock);
    expect(url).toBe(`${API_URL}/dashboard/join-request`);
    expect(body).toEqual({ slug: "krusty-fadez" });
  });

  it("PUTs the days switched on, in minutes, then opens the services step", async () => {
    const fetchMock = stubApi({ [HOURS_URL]: { status: 200, body: [MONDAY] } });

    const response = await post(HOURS_FORM);

    expect((response as Response).headers.get("Location")).toBe("/onboarding?step=services");
    const { url, body } = sent(fetchMock);
    expect(url).toBe(`${API_URL}${HOURS_URL}`);
    // Monday ends at 00:00, which is midnight at the close of the day.
    expect(body).toEqual({
      days: [
        { day_of_week: 1, start_minute: 540, end_minute: 1440, break_start_minute: 720, break_end_minute: 780 },
        { day_of_week: 5, start_minute: 600, end_minute: 1110, break_start_minute: null, break_end_minute: null },
      ],
    });
  });

  it("PUTs every service but the blank row, price in cents, then opens the go-live step", async () => {
    const fetchMock = stubApi({ "/dashboard/services": { status: 200, body: [SKIN_FADE] } });

    const response = await post(SERVICES_FORM);

    expect((response as Response).headers.get("Location")).toBe("/onboarding?step=live");
    const { url, body } = sent(fetchMock);
    expect(url).toBe(`${API_URL}/dashboard/services`);
    expect(body).toEqual({
      services: [
        { ...SKIN_FADE, description: "", buffer_after_min: 0 },
        { id: null, title: "Kids cut", description: "", price_cents: 2500, duration_min: 30, buffer_after_min: 0 },
      ],
    });
  });

  const LIST = { detail: [{ loc: ["body", "x"], msg: "Value error" }] };

  it.each([
    { form: "profile", status: 409, body: undefined, message: "That link is taken, try another" },
    {
      form: "profile",
      status: 422,
      body: { detail: "Enter a valid email address" },
      message: "Enter a valid email address",
    },
    { form: "profile", status: 422, body: LIST, message: "Check your details, then try again" },
    { form: "profile", status: 503, body: undefined, message: "Could not save, please try again" },
    { form: "shop", status: 404, body: undefined, message: "That's not an existing shop" },
    { form: "shop", status: 422, body: LIST, message: "That's not an existing shop" },
    { form: "shop", status: 409, body: undefined, message: "Set up your profile first" },
    { form: "shop", status: 503, body: undefined, message: "Could not send your request, please try again" },
    { form: "hours", status: 404, body: undefined, message: "Choose your shop first" },
    { form: "hours", status: 422, body: LIST, message: "Check your hours, then try again" },
    { form: "hours", status: 503, body: undefined, message: "Could not save your hours, please try again" },
    { form: "services", status: 409, body: undefined, message: "Set up your profile first" },
    {
      form: "services",
      status: 422,
      body: { detail: "Every service needs a name" },
      message: "Every service needs a name",
    },
    { form: "services", status: 422, body: LIST, message: "Check your services, then try again" },
    {
      form: "services",
      status: 503,
      body: undefined,
      message: "Could not save your services, please try again",
    },
  ])("explains a $status from the $form form", async ({ form, status, body, message }) => {
    const forms = {
      profile: { path: "/dashboard/profile", fields: PROFILE_FORM },
      shop: { path: "/dashboard/join-request", fields: SHOP_FORM },
      hours: { path: HOURS_URL, fields: HOURS_FORM },
      services: { path: "/dashboard/services", fields: SERVICES_FORM },
    } as const;
    const { path, fields } = forms[form as keyof typeof forms];
    stubApi({ [path]: { status, body } });

    const result = await post(fields as Record<string, string> | string[][]);

    expect(result).toMatchObject({ data: { error: message }, init: { status } });
  });

  it("logs the visitor out when the API rejects the token", async () => {
    stubApi({ "/dashboard/profile": { status: 401 } });

    const response = await thrown(post(PROFILE_FORM));

    expect(response.headers.get("Location")).toBe("/login");
  });

  it("refuses a form it doesn't know without calling the API", async () => {
    const fetchMock = stubApi({});

    const response = await thrown(post({ intent: "go-live", slug: "krusty-fadez" }));

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("onboarding page", () => {
  type Saved = {
    profile?: SaveWorkerProfile;
    chairs?: MyChair[];
    chair?: MyChair | null;
    services?: MyService[];
    live?: boolean;
  };

  /** The real route component with stand-in data and action, so no test here depends on the API. */
  function renderPage(step: StepKey = "profile", saved: Saved = {}) {
    const data = { step, profile: FIRST, chairs: [], chair: null, services: [], live: false, ...saved };
    const posted: FormData[] = [];
    const pageAction = vi.fn(async ({ request }: { request: Request }) => {
      posted.push(await request.formData());
      return { error: null };
    });
    const Stub = createRoutesStub([
      { path: "/onboarding", Component: OnboardingRoute, loader: () => data, action: pageAction },
    ]);
    render(<Stub initialEntries={["/onboarding"]} />);
    return { user: userEvent.setup(), action: pageAction, posted };
  }

  /** The hours step, for a worker waiting on Krusty Fadez. */
  const HOURS = { profile: PROFILE, chairs: [WAITING], chair: WAITING };
  /** The services step, once the hours are set. */
  const SERVICES = { profile: PROFILE, chairs: [WITH_HOURS], chair: WITH_HOURS };

  const field = (label: string) => screen.getByLabelText(label);
  const textbox = (name: string) => screen.getByRole("textbox", { name });
  const next = () => screen.getByRole("button", { name: "Next" });
  const day = (name: string) => screen.getByRole("group", { name });

  it("opens on step 1 of 5 with nowhere to go back to", async () => {
    renderPage();

    expect(await screen.findByText("Step 1 of 5")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Your profile" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    expectHeadingOutline();
  });

  it("starts from the values the loader gave it", async () => {
    renderPage();

    expect(await screen.findByLabelText("Your link")).toHaveValue("ada-lovelace");
    expect(field("First name")).toHaveValue("Ada");
    expect(field("Last name")).toHaveValue("Lovelace");
    expect(field("Email for clients (optional)")).toHaveValue("");
  });

  it("flags the empty required fields on Next and posts nothing", async () => {
    const { user, action: pageAction } = renderPage("profile", {
      profile: { ...FIRST, slug: "", first_name: "", last_name: "" },
    });
    await user.click(await screen.findByRole("button", { name: "Next" }));

    const errors = {
      "Your link": "Enter a link for your page",
      "First name": "Enter your first name",
      "Last name": "Enter your last name",
    };
    for (const [label, message] of Object.entries(errors)) {
      expect(field(label)).toHaveAttribute("aria-invalid", "true");
      expect(field(label)).toHaveAccessibleDescription(message);
    }
    expect(field("Your link")).toHaveFocus();
    expect(pageAction).not.toHaveBeenCalled();
  });

  it("flags a malformed optional field, but not an empty one", async () => {
    const { user, action: pageAction } = renderPage();
    await user.type(await screen.findByLabelText("Email for clients (optional)"), "ada@");
    await user.click(next());

    expect(field("Email for clients (optional)")).toHaveAccessibleDescription("Enter an email address");
    expect(field("Phone for clients (optional)")).not.toHaveAttribute("aria-invalid");
    expect(pageAction).not.toHaveBeenCalled();
  });

  it("tidies the link and the phone when they are left", async () => {
    const { user } = renderPage();
    const link = await screen.findByLabelText("Your link");
    await user.clear(link);
    await user.type(link, "Ada's Fades");
    await user.type(field("Phone for clients (optional)"), "(512) 555-0100");
    await user.tab();

    expect(link).toHaveValue("ada-s-fades");
    expect(field("Phone for clients (optional)")).toHaveValue("+15125550100");
  });

  it("posts every profile field, named by its intent, when Next is pressed", async () => {
    const { user, posted } = renderPage();
    await user.click(await screen.findByRole("button", { name: "Next" }));

    await waitFor(() => expect(posted).toHaveLength(1));
    expect(Object.fromEntries(posted[0])).toEqual({
      intent: "worker-profile",
      slug: "ada-lovelace",
      first_name: "Ada",
      last_name: "Lovelace",
      bio: "",
      public_email: "",
      public_phone: "",
    });
  });

  it("shows a waiting request on the shop step, its link ready to send again", async () => {
    renderPage("shop", { profile: PROFILE, chairs: [WAITING] });

    expect(await screen.findByText("Step 2 of 5")).toBeInTheDocument();
    expect(screen.getByText("Krusty Fadez")).toBeInTheDocument();
    expect(screen.getByText("Waiting")).toBeInTheDocument();
    expect(field("Shop link")).toHaveValue("krusty-fadez");
    expect(screen.getByRole("link", { name: "Previous" })).toHaveAttribute(
      "href",
      "/onboarding?step=profile",
    );
  });

  it("flags an empty shop link on Next and posts nothing", async () => {
    const { user, action: pageAction } = renderPage("shop", { profile: PROFILE });
    await user.click(await screen.findByRole("button", { name: "Next" }));

    expect(field("Shop link")).toHaveAttribute("aria-invalid", "true");
    expect(field("Shop link")).toHaveAccessibleDescription("Enter your shop's link");
    expect(field("Shop link")).toHaveFocus();
    expect(pageAction).not.toHaveBeenCalled();
  });

  it("tidies the shop link and posts it, named by its intent", async () => {
    const { user, posted } = renderPage("shop", { profile: PROFILE });
    await user.type(await screen.findByLabelText("Shop link"), "Krusty Fadez");
    await user.click(next());

    await waitFor(() => expect(posted).toHaveLength(1));
    expect(Object.fromEntries(posted[0])).toEqual({ intent: "connect-shop", slug: "krusty-fadez" });
  });

  it("shows a day's hours, 9 to 5 to start, once it's switched on", async () => {
    const { user } = renderPage("schedule", HOURS);
    expect(
      await screen.findByText("Your hours at Krusty Fadez. Times are the shop's local time."),
    ).toBeInTheDocument();
    const monday = screen.getByRole("switch", { name: "Monday" });
    expect(monday).not.toBeChecked();
    expect(within(day("Monday")).queryByLabelText("Start")).not.toBeInTheDocument();

    await user.click(monday);

    expect(monday).toBeChecked();
    expect(within(day("Monday")).getByLabelText("Start")).toHaveValue("09:00");
    expect(within(day("Monday")).getByLabelText("End")).toHaveValue("17:00");
    expect(within(day("Monday")).getByLabelText("Break start")).toHaveValue("");
  });

  it("starts from the hours already saved", async () => {
    renderPage("schedule", { ...HOURS, chairs: [WITH_HOURS], chair: WITH_HOURS });

    expect(await screen.findByRole("switch", { name: "Monday" })).toBeChecked();
    expect(screen.getByRole("switch", { name: "Tuesday" })).not.toBeChecked();
    expect(within(day("Monday")).getByLabelText("Break start")).toHaveValue("12:00");
    expect(within(day("Monday")).getByLabelText("Break end")).toHaveValue("13:00");
  });

  it("asks for at least one day on, and posts nothing", async () => {
    const { user, action: pageAction } = renderPage("schedule", HOURS);
    await user.click(await screen.findByRole("button", { name: "Next" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Turn on at least one day you work.");
    expect(pageAction).not.toHaveBeenCalled();
  });

  it.each([
    { problem: "an end before the start", values: { End: "08:00" }, field: "End", message: "End after the start" },
    {
      problem: "half a break",
      values: { "Break start": "12:00" },
      field: "Break end",
      message: "Enter both break times",
    },
    {
      problem: "a break outside the hours",
      values: { "Break start": "08:00", "Break end": "09:30" },
      field: "Break start",
      message: "Keep the break inside your hours",
    },
    {
      problem: "a break that ends before it starts",
      values: { "Break start": "13:00", "Break end": "12:00" },
      field: "Break end",
      message: "End the break after it starts",
    },
  ])("flags $problem and posts nothing", async ({ values, field: label, message }) => {
    const { user, action: pageAction } = renderPage("schedule", HOURS);
    await user.click(await screen.findByRole("switch", { name: "Monday" }));
    for (const [name, value] of Object.entries(values)) {
      fireEvent.change(within(day("Monday")).getByLabelText(name), { target: { value } });
    }
    await user.click(next());

    const input = within(day("Monday")).getByLabelText(label);
    expect(input).toHaveAccessibleDescription(message);
    expect(input).toHaveFocus();
    expect(pageAction).not.toHaveBeenCalled();
  });

  it("posts the days switched on with their hours, named by its intent", async () => {
    const { user, posted } = renderPage("schedule", HOURS);
    await user.click(await screen.findByRole("switch", { name: "Monday" }));
    await user.click(screen.getByRole("switch", { name: "Wednesday" }));
    fireEvent.change(within(day("Wednesday")).getByLabelText("Start"), { target: { value: "10:00" } });
    await user.click(next());

    await waitFor(() => expect(posted).toHaveLength(1));
    expect(Object.fromEntries(posted[0])).toEqual({
      intent: "worker-hours",
      chair: WAITING.id,
      "open-1": "on",
      "start-1": "09:00",
      "end-1": "17:00",
      "break-start-1": "",
      "break-end-1": "",
      "open-3": "on",
      "start-3": "10:00",
      "end-3": "17:00",
      "break-start-3": "",
      "break-end-3": "",
    });
  });

  it("opens a blank service on the first visit", async () => {
    renderPage("services", SERVICES);

    expect(await screen.findByText("Step 4 of 5")).toBeInTheDocument();
    expect(textbox("Name")).toHaveValue("");
    expect(screen.queryByRole("button", { name: /^Edit/ })).not.toBeInTheDocument();
  });

  it("collapses a finished service to a row on Add more, and opens a new one", async () => {
    const { user } = renderPage("services", SERVICES);
    await user.type(await screen.findByRole("textbox", { name: "Name" }), "Skin fade");
    await user.type(textbox("Price ($)"), "35");
    await user.type(screen.getByRole("spinbutton", { name: "Duration (min)" }), "45");
    await user.click(screen.getByRole("button", { name: "Add more" }));

    expect(screen.getByText("Skin fade")).toBeInTheDocument();
    expect(screen.getByText("$35.00 · 45 min")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit Skin fade" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete Skin fade" })).toBeInTheDocument();
    expect(textbox("Name")).toHaveValue("");
    expect(textbox("Name")).toHaveFocus();
  });

  it("won't collapse a service until it's finished", async () => {
    const { user } = renderPage("services", SERVICES);
    await user.type(await screen.findByRole("textbox", { name: "Name" }), "Skin fade");
    await user.click(screen.getByRole("button", { name: "Add more" }));

    expect(textbox("Price ($)")).toHaveAccessibleDescription("Enter a price, like 35 or 35.50");
    expect(textbox("Price ($)")).toHaveFocus();
    expect(screen.queryByRole("button", { name: "Edit Skin fade" })).not.toBeInTheDocument();
  });

  it("reopens a saved service with Edit", async () => {
    const { user } = renderPage("services", { ...SERVICES, services: [SKIN_FADE, BEARD_TRIM] });
    await user.click(await screen.findByRole("button", { name: "Edit Beard trim" }));

    expect(textbox("Name")).toHaveValue("Beard trim");
    expect(textbox("Price ($)")).toHaveValue("20.00");
    expect(textbox("Name")).toHaveFocus();
    expect(screen.getByRole("button", { name: "Edit Skin fade" })).toBeInTheDocument();
  });

  it("drops a new row nobody typed into when another is edited", async () => {
    const { user } = renderPage("services", { ...SERVICES, services: [SKIN_FADE] });
    await user.click(await screen.findByRole("button", { name: "Add more" }));
    await user.click(screen.getByRole("button", { name: "Edit Skin fade" }));

    expect(screen.getAllByRole("textbox", { name: "Name" })).toHaveLength(1);
    expect(textbox("Name")).toHaveValue("Skin fade");
  });

  it("deletes a service from the list", async () => {
    const { user } = renderPage("services", { ...SERVICES, services: [SKIN_FADE, BEARD_TRIM] });
    await user.click(await screen.findByRole("button", { name: "Delete Beard trim" }));

    expect(screen.queryByText("Beard trim")).not.toBeInTheDocument();
    expect(screen.getByText("Skin fade")).toBeInTheDocument();
  });

  it("asks for a first service when Next is pressed with nothing typed", async () => {
    const { user, action: pageAction } = renderPage("services", SERVICES);
    await user.click(await screen.findByRole("button", { name: "Next" }));

    expect(textbox("Name")).toHaveAccessibleDescription("Enter a name");
    expect(textbox("Name")).toHaveFocus();
    expect(pageAction).not.toHaveBeenCalled();
  });

  it("posts every row, in order, when Next is pressed", async () => {
    const { user, posted } = renderPage("services", { ...SERVICES, services: [SKIN_FADE] });
    await user.click(await screen.findByRole("button", { name: "Add more" }));
    await user.type(textbox("Name"), "Kids cut");
    await user.type(textbox("Price ($)"), "25");
    await user.type(screen.getByRole("spinbutton", { name: "Duration (min)" }), "30");
    await user.click(next());

    await waitFor(() => expect(posted).toHaveLength(1));
    const form = posted[0];
    expect(form.get("intent")).toBe("worker-services");
    expect(form.getAll("service")).toEqual([SKIN_FADE.id, "new-1"]);
    expect(form.get(`id-${SKIN_FADE.id}`)).toBe(SKIN_FADE.id);
    expect(form.get(`title-${SKIN_FADE.id}`)).toBe("Skin fade");
    expect(form.get(`price-${SKIN_FADE.id}`)).toBe("35.00");
    expect(form.get("id-new-1")).toBe("");
    expect(form.get("title-new-1")).toBe("Kids cut");
    expect(form.get("price-new-1")).toBe("25");
    expect(form.get("duration-new-1")).toBe("30");
    expect(form.get("buffer-new-1")).toBe("0");
  });

  it("tells a worker the shop still has to approve them, and that nothing else is needed", async () => {
    renderPage("live", { ...SERVICES, services: [SKIN_FADE] });

    expect(await screen.findByText("Step 5 of 5")).toBeInTheDocument();
    expect(screen.getByText("Waiting")).toBeInTheDocument();
    expect(screen.getByText("We're waiting for Krusty Fadez to approve you.")).toBeInTheDocument();
    expect(screen.getByText(/No further steps are needed/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to dashboard" })).toHaveAttribute("href", "/dashboard");
    expect(screen.getByRole("link", { name: "Check again" })).toHaveAttribute("href", "/onboarding?step=live");
    expect(screen.getByRole("link", { name: "Previous" })).toHaveAttribute(
      "href",
      "/onboarding?step=services",
    );
    expect(screen.queryByRole("button", { name: "Next" })).not.toBeInTheDocument();
  });

  it("shows a live worker their shop, their services and their booking link", async () => {
    renderPage("live", {
      profile: PROFILE,
      chairs: [JOINED],
      chair: JOINED,
      services: [SKIN_FADE, BEARD_TRIM],
      live: true,
    });

    expect(await screen.findByText("Live")).toBeInTheDocument();
    expect(screen.getByText("Your booking page is live.")).toBeInTheDocument();
    expect(screen.getByText("You're set up at Regular Cutz with these services:")).toBeInTheDocument();
    expect(screen.getByText("Skin fade")).toBeInTheDocument();
    expect(screen.getByText("$35.00 · 45 min")).toBeInTheDocument();
    expect(screen.getByText("$20.00 · 20 min")).toBeInTheDocument();
    const link = screen.getByText(/\/view-services\/ada-cuts$/);
    expect(link).toHaveAttribute("href", "/view-services/ada-cuts");
    expect(link.textContent).toBe(`${window.location.origin}/view-services/ada-cuts`);
    expect(screen.getByRole("link", { name: "See your page" })).toHaveAttribute(
      "href",
      "/view-services/ada-cuts",
    );
    expect(screen.getByRole("link", { name: "Go to dashboard" })).toHaveAttribute("href", "/dashboard");
    expect(screen.queryByRole("button", { name: "Next" })).not.toBeInTheDocument();
  });

  // A layout effect runs in the first commit, before any effect, so this reads the
  // link as the first render left it. An origin filled in by an effect fails here
  // every time, rather than only on a slow machine.
  it("has the whole booking link on the first render", () => {
    let first: string | null = null;
    function FirstCommit() {
      useLayoutEffect(() => {
        first = screen.getByText(/\/view-services\/ada-cuts$/).textContent;
      }, []);
      return null;
    }
    const Stub = createRoutesStub([
      {
        path: "/onboarding",
        Component: () => (
          <>
            <GoLive live chairs={[JOINED]} chair={JOINED} services={[SKIN_FADE]} slug="ada-cuts" />
            <FirstCommit />
          </>
        ),
      },
    ]);
    render(<Stub initialEntries={["/onboarding"]} />);

    expect(first).toBe(`${window.location.origin}/view-services/ada-cuts`);
  });
});
