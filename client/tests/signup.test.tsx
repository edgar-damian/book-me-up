import { render, screen, waitFor } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { createRoutesStub } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import OnboardingRoute from "~/routes/onboarding";
import SignUpRoute, { action as signupAction } from "~/routes/signup";
import { getSession } from "~/sessions.server";

const API_URL = "http://api.test";
const TOKENS = { access_token: "access", refresh_token: "refresh", expires_at: 1_800_000_000 };
/** What the onboarding loader gives a brand-new account. */
const FIRST_STEP = {
  step: "profile",
  profile: {
    slug: "ada-lovelace",
    first_name: "Ada",
    last_name: "Lovelace",
    bio: "",
    public_email: null,
    public_phone: null,
  },
  chairs: [],
  chair: null,
  services: [],
  live: false,
};

/** What a person types, by label. */
const VALID = {
  "First name": "Ada",
  "Last name": "Lovelace",
  Email: "ada@example.com",
  Phone: "(512) 555-0100",
  Password: "hunter2",
  "Confirm password": "hunter2",
};

/** What the form posts once the page has tidied it. */
const FORM = {
  first_name: "Ada",
  last_name: "Lovelace",
  email: "ada@example.com",
  phone: "+15125550100",
  password: "hunter2",
  confirm_password: "hunter2",
};

beforeEach(() => {
  vi.stubEnv("SESSION_SECRET", "test-secret");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const field = (label: string) => screen.getByLabelText(label);
const submitButton = () => screen.getByRole("button", { name: "Sign up" });

async function fill(user: UserEvent, fields: Partial<typeof VALID>) {
  for (const [label, value] of Object.entries(fields)) {
    await user.type(field(label), value);
  }
}

/** fetch answering every request with `status`, and with `body` as JSON when given. */
function stubApi(status: number, body?: unknown) {
  vi.stubEnv("API_URL", API_URL);
  const fetchMock = vi.fn<typeof fetch>(
    async () => new Response(body === undefined ? null : JSON.stringify(body), { status }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** The real sign-up action, called the way a form post would call it. */
const post = (fields: Record<string, string>) =>
  signupAction({
    request: new Request("http://localhost/signup", {
      method: "POST",
      body: new URLSearchParams(fields),
    }),
  } as Parameters<typeof signupAction>[0]);

describe("sign-up page", () => {
  /** The real route component with a stand-in action, so no test here depends on the API. */
  function renderPage() {
    const posted: Record<string, FormDataEntryValue>[] = [];
    const action = vi.fn(async ({ request }: { request: Request }) => {
      posted.push(Object.fromEntries(await request.formData()));
      return { error: null };
    });
    const Stub = createRoutesStub([{ path: "/signup", Component: SignUpRoute, action }]);
    render(<Stub initialEntries={["/signup"]} />);
    return { user: userEvent.setup(), action, posted };
  }

  it("flags all six fields on an empty submit and posts nothing", async () => {
    const { user, action } = renderPage();
    await user.click(submitButton());

    const errors = {
      "First name": "Enter your first name",
      "Last name": "Enter your last name",
      Email: "Enter an email address",
      Phone: "Enter a phone number with area code",
      Password: "Enter your password",
      "Confirm password": "Enter your password again",
    };
    for (const [label, message] of Object.entries(errors)) {
      expect(field(label)).toHaveAttribute("aria-invalid", "true");
      expect(field(label)).toHaveAccessibleDescription(message);
    }
    expect(field("First name")).toHaveFocus();
    expect(action).not.toHaveBeenCalled();
  });

  it("won't post a confirmation that doesn't match the password", async () => {
    const { user, action } = renderPage();
    await fill(user, { ...VALID, "Confirm password": "hunter3" });
    await user.click(submitButton());

    expect(field("Confirm password")).toHaveAccessibleDescription("Passwords don't match");
    expect(field("Confirm password")).toHaveFocus();
    expect(action).not.toHaveBeenCalled();
  });

  it("re-checks a typed confirmation when the password changes", async () => {
    const { user } = renderPage();
    await fill(user, { Password: "hunter2", "Confirm password": "hunter2" });
    await user.tab();
    expect(field("Confirm password")).not.toHaveAttribute("aria-invalid");

    await user.clear(field("Password"));
    await user.type(field("Password"), "hunter3");
    await user.tab();

    expect(field("Confirm password")).toHaveAccessibleDescription("Passwords don't match");
  });

  it("rewrites the phone as E.164 and posts every field", async () => {
    const { user, posted } = renderPage();
    await fill(user, VALID);

    expect(field("Phone")).toHaveValue("+15125550100");
    await user.click(submitButton());

    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toEqual(FORM);
  });
});

describe("sign-up action", () => {
  /** The real sign-up route and action. The stub keeps no cookies, so the onboarding loader is a stand-in. */
  function renderSignup() {
    const Stub = createRoutesStub([
      { path: "/signup", Component: SignUpRoute, action: signupAction },
      { path: "/onboarding", Component: OnboardingRoute, loader: () => FIRST_STEP },
    ]);
    render(<Stub initialEntries={["/signup"]} />);
    return userEvent.setup();
  }

  async function signUp(user: UserEvent) {
    await fill(user, VALID);
    await user.click(submitButton());
  }

  it("sends five fields to POST /auth/signup as JSON and opens onboarding", async () => {
    const fetchMock = stubApi(201, TOKENS);
    await signUp(renderSignup());

    expect(await screen.findByRole("heading", { name: "Set up your page" })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${API_URL}/auth/signup`);
    expect(init?.method).toBe("POST");
    expect(init?.headers).toEqual({ "Content-Type": "application/json" });
    const { confirm_password, ...sent } = FORM;
    expect(JSON.parse(String(init?.body))).toEqual(sent);
  });

  it("keeps the tokens in an httpOnly cookie", async () => {
    stubApi(201, TOKENS);
    const response = await post(FORM);

    expect(response).toBeInstanceOf(Response);
    const { headers } = response as Response;
    expect(headers.get("Location")).toBe("/onboarding");
    const cookie = headers.get("Set-Cookie") ?? "";
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect((await getSession(cookie.split(";")[0])).data).toEqual(TOKENS);
  });

  it.each([
    { refusal: "a taken email", status: 409, body: undefined, message: "An account already uses this email" },
    { refusal: "closed sign-ups", status: 403, body: undefined, message: "Sign-ups are closed right now" },
    {
      refusal: "a 422 with a sentence",
      status: 422,
      body: { detail: "Password should be at least 6 characters." },
      message: "Password should be at least 6 characters.",
    },
    {
      refusal: "a 422 with a validation list",
      status: 422,
      body: { detail: [{ loc: ["body", "phone"], msg: "String should match pattern" }] },
      message: "Check your details, then try again",
    },
    { refusal: "an outage", status: 503, body: undefined, message: "Could not sign up, please try again" },
  ])("explains $refusal", async ({ status, body, message }) => {
    stubApi(status, body);
    await signUp(renderSignup());

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
  });

  it("refuses mismatched passwords without calling the API", async () => {
    const fetchMock = stubApi(201, TOKENS);
    const result = await post({ ...FORM, confirm_password: "hunter3" });

    expect(result).toMatchObject({ data: { error: "Passwords don't match" }, init: { status: 422 } });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
