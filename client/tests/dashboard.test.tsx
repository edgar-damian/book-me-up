import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRoutesStub, data, redirect } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Me } from "~/models/auth";
import type { MyChair, MyService, MyWorkerProfile } from "~/models/dashboard";
import DashboardRoute, { action, loader } from "~/routes/dashboard";
import { commitSession, getSession } from "~/sessions.server";
import type { Editing } from "~/widgets/Dashboard/editDialog";

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
    const fetchMock = stubApi({ "/auth/me": { status: 200, body: ME } });

    const result = await load(await cookie(3600));

    expect(result.data).toEqual({ me: ME, editing: null });
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

    expect(result.data).toEqual({ me: waiting, editing: null });
  });

  /** What the API holds for a live worker: a profile, a service, and these chairs. */
  const saved = (chairs: MyChair[]) => ({
    "/auth/me": { status: 200, body: ME },
    "/dashboard/profile": { status: 200, body: PROFILE },
    "/dashboard/chairs": { status: 200, body: chairs },
    "/dashboard/services": { status: 200, body: [SKIN_FADE] },
  });

  it("opens the hours at the shop the worker has joined, over a request still waiting", async () => {
    stubApi(saved([WAITING, JOINED]));

    const result = await load(await cookie(3600), "?edit=schedule");

    expect(result.data.editing).toEqual({ edit: "schedule", chairs: [WAITING, JOINED], chair: JOINED });
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

    expect(result.data).toEqual({ me: ME, editing: null });
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

  /** The real action, called the way the dialog's Save would call it. */
  const post = async (fields: Record<string, string>) =>
    action({
      request: new Request("http://localhost/dashboard", {
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

  /** The real route component, with a stand-in loader that follows the URL and a stand-in action. */
  function renderPage(url = "/dashboard", { chairs = [JOINED], refusal }: { chairs?: MyChair[]; refusal?: string } = {}) {
    const posted: FormData[] = [];
    const pageAction = vi.fn(async ({ request }: { request: Request }) => {
      posted.push(await request.formData());
      return refusal ? data({ error: refusal }, { status: 409 }) : redirect("/dashboard");
    });
    const Stub = createRoutesStub([
      {
        path: "/dashboard",
        Component: DashboardRoute,
        loader: ({ request }: { request: Request }) => ({ me: ME, editing: editingAt(request.url, chairs) }),
        action: pageAction,
      },
    ]);
    render(<Stub initialEntries={[url]} />);
    return { user: userEvent.setup(), posted };
  }

  const opened = (name: string) => screen.findByRole("dialog", { name });

  it("greets the user by first name", async () => {
    renderPage();

    expect(await screen.findByText("Hi, Ada. You're logged in.")).toBeInTheDocument();
  });

  it("uses the worker header, whose wordmark stays on the dashboard", async () => {
    renderPage();

    expect(await screen.findByRole("link", { name: /dashboard/ })).toHaveAttribute("href", "/dashboard");
  });

  it("opens no dialog without ?edit=", async () => {
    renderPage();

    await screen.findByText("Hi, Ada. You're logged in.");
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
