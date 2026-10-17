// NOTE: change when removing waitlist
import { render, screen, waitFor } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { createRoutesStub } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import WaitListRoute, { action as waitlistAction } from "~/routes/waitlist";
import { expectHeadingOutline } from "./helpers";

const VALID = {
  "First name": "Siobhán",
  "Last name": "O'Brien-Núñez",
  Phone: "(512) 555-0100",
  Email: "ada@example.com",
};

const PHONE_ERROR = "Enter a phone number with area code";
const EMAIL_ERROR = "Enter an email address";

/** The real route component with a stand-in action, so no test depends on the API. */
function renderWaitlist(respond: () => unknown = () => ({ joined: true })) {
  const posted: Record<string, FormDataEntryValue>[] = [];
  const action = vi.fn(async ({ request }: { request: Request }) => {
    posted.push(Object.fromEntries(await request.formData()));
    return respond();
  });
  const Stub = createRoutesStub([{ path: "/waitlist", Component: WaitListRoute, action }]);
  render(<Stub initialEntries={["/waitlist"]} />);
  return { user: userEvent.setup(), action, posted };
}

async function fill(user: UserEvent, fields: Partial<typeof VALID>) {
  for (const [label, value] of Object.entries(fields)) {
    await user.type(screen.getByLabelText(label), value);
  }
}

const field = (label: string) => screen.getByLabelText(label);
const submitButton = () => screen.getByRole("button", { name: "Join the waitlist" });
const confirmation = () => screen.findByRole("heading", { name: "You're on the list" });

describe("waitlist page", () => {
  it("flags all four fields on an empty submit and posts nothing", async () => {
    const { user, action } = renderWaitlist();
    await user.click(submitButton());

    const errors = {
      "First name": "Enter your first name",
      "Last name": "Enter your last name",
      Phone: PHONE_ERROR,
      Email: EMAIL_ERROR,
    };
    for (const [label, message] of Object.entries(errors)) {
      expect(field(label)).toHaveAttribute("aria-invalid", "true");
      expect(field(label)).toHaveAccessibleDescription(message);
    }
    expect(field("First name")).toHaveFocus();
    expect(action).not.toHaveBeenCalled();
  });

  it("moves focus to the first field that still needs fixing", async () => {
    const { user, action } = renderWaitlist();
    await fill(user, { "First name": VALID["First name"], "Last name": VALID["Last name"], Phone: "555-0100" });
    await user.click(submitButton());

    expect(field("Phone")).toHaveFocus();
    expect(action).not.toHaveBeenCalled();
  });

  it("treats a name of only spaces as blank", async () => {
    const { user } = renderWaitlist();
    await user.type(field("First name"), "   ");
    await user.tab();

    expect(field("First name")).toHaveAccessibleDescription("Enter your first name");
  });

  it.each([
    ["(512) 555-0100", "+15125550100"],
    ["512.555.0100", "+15125550100"],
    ["1 512 555 0100", "+15125550100"],
    ["+44 20 7946 0958", "+442079460958"],
  ])("rewrites the phone %j to %s on blur", async (typed, e164) => {
    const { user } = renderWaitlist();
    await user.type(field("Phone"), typed);
    await user.tab();

    expect(field("Phone")).toHaveValue(e164);
    expect(field("Phone")).not.toHaveAttribute("aria-invalid");
  });

  it.each([
    ["555-0100", "no area code"],
    ["2 512 555 0100", "11 digits without a leading 1"],
    ["+0 512 555 0100", "a country code starting with 0"],
    ["+1 512 555 0100 00000", "more than 15 digits"],
    ["call me", "no digits"],
  ])("flags the phone %j (%s) and leaves it as typed", async (typed) => {
    const { user } = renderWaitlist();
    await user.type(field("Phone"), typed);
    await user.tab();

    expect(field("Phone")).toHaveValue(typed);
    expect(field("Phone")).toHaveAccessibleDescription(PHONE_ERROR);
  });

  // From the email cases in server/tests/test_clean.py.
  it.each(["Pearl@Krusty.TEST", "  pearl@krusty.test  ", "o'brien@example.com", "pearl+booking@krusty.test"])(
    "accepts the email %j",
    async (typed) => {
      const { user } = renderWaitlist();
      await user.type(field("Email"), typed);
      await user.tab();

      expect(field("Email")).not.toHaveAttribute("aria-invalid");
    },
  );

  it.each(["not-an-email", "pearl@krusty@test.com", "pearl@localhost", "@krusty.test"])(
    "rejects the email %j",
    async (typed) => {
      const { user } = renderWaitlist();
      await user.type(field("Email"), typed);
      await user.tab();

      expect(field("Email")).toHaveAccessibleDescription(EMAIL_ERROR);
    },
  );

  it("clears a field's error once it is fixed", async () => {
    const { user } = renderWaitlist();
    await user.type(field("Phone"), "555-0100");
    await user.tab();
    expect(field("Phone")).toHaveAttribute("aria-invalid", "true");

    await user.clear(field("Phone"));
    await user.type(field("Phone"), VALID.Phone);
    await user.tab();

    expect(field("Phone")).not.toHaveAttribute("aria-invalid");
    expect(screen.queryByText(PHONE_ERROR)).not.toBeInTheDocument();
  });

  it("posts exactly the four fields and shows the confirmation", async () => {
    const { user, posted } = renderWaitlist();
    await fill(user, VALID);
    await user.click(submitButton());

    expect(await confirmation()).toBeInTheDocument();
    expect(posted).toEqual([
      {
        first_name: "Siobhán",
        last_name: "O'Brien-Núñez",
        phone: "+15125550100",
        email: "ada@example.com",
      },
    ]);
    expect(screen.queryByRole("button", { name: "Join the waitlist" })).not.toBeInTheDocument();
  });

  it("posts the phone as E.164 when Enter submits from the phone field", async () => {
    const { user, posted } = renderWaitlist();
    await fill(user, { "First name": VALID["First name"], "Last name": VALID["Last name"], Email: VALID.Email });
    await user.type(field("Phone"), `${VALID.Phone}{Enter}`);

    await confirmation();
    expect(posted[0].phone).toBe("+15125550100");
  });

  it("marks the button busy while the signup is sent", async () => {
    let finish!: () => void;
    const held = new Promise((resolve) => {
      finish = () => resolve({ joined: true });
    });
    const { user } = renderWaitlist(() => held);
    await fill(user, VALID);
    const button = submitButton();
    await user.click(button);

    await waitFor(() => expect(button).toHaveAttribute("aria-busy", "true"));
    finish();
    expect(await confirmation()).toBeInTheDocument();
  });

  it("has one h1 and no skipped heading levels", () => {
    renderWaitlist();
    expectHeadingOutline();
  });
});

const API_URL = "http://api.test";

/** The real route, action included, with fetch answering every request with `status`. */
function renderWithApi(status: number) {
  vi.stubEnv("API_URL", API_URL);
  const fetchMock = vi.fn<typeof fetch>(async () => new Response(null, { status }));
  vi.stubGlobal("fetch", fetchMock);
  const Stub = createRoutesStub([{ path: "/waitlist", Component: WaitListRoute, action: waitlistAction }]);
  render(<Stub initialEntries={["/waitlist"]} />);
  return { user: userEvent.setup(), fetchMock };
}

describe("waitlist action", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("sends the four fields to POST /waitlist as JSON and confirms on 204", async () => {
    const { user, fetchMock } = renderWithApi(204);
    await fill(user, VALID);
    await user.click(submitButton());

    expect(await confirmation()).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${API_URL}/waitlist`);
    expect(init?.method).toBe("POST");
    expect(init?.headers).toEqual({ "Content-Type": "application/json" });
    expect(JSON.parse(String(init?.body))).toEqual({
      first_name: "Siobhán",
      last_name: "O'Brien-Núñez",
      phone: "+15125550100",
      email: "ada@example.com",
    });
  });

  it("keeps what was typed and asks for a fix when the API answers 422", async () => {
    const { user } = renderWithApi(422);
    await fill(user, VALID);
    await user.click(submitButton());

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Check your name, phone, and email, then try again",
    );
    expect(field("First name")).toHaveValue("Siobhán");
    expect(field("Phone")).toHaveValue("+15125550100");
    expect(field("Email")).toHaveValue("ada@example.com");
  });

  it("offers a retry when the API is unavailable", async () => {
    const { user } = renderWithApi(503);
    await fill(user, VALID);
    await user.click(submitButton());

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not join the waitlist, please try again",
    );
    expect(submitButton()).toBeInTheDocument();
  });
});
