// @vitest-environment node
import { renderToString } from "react-dom/server";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";
import Home from "~/routes/home";
import WaitListRoute from "~/routes/waitlist";
import LogInRoute from "~/routes/login";
import SignUpRoute from "~/routes/signup";
import { Onboarding } from "~/pages/Onboarding";
import { Dashboard } from "~/pages/Dashboard";

// Every first visit is server-rendered, so a page that reads window or
// document during render breaks here even though `npm run build` passes.
describe("server rendering", () => {
  it("renders the landing page without a browser", () => {
    const Stub = createRoutesStub([{ path: "/", Component: Home }]);
    const html = renderToString(<Stub initialEntries={["/"]} />);

    expect(html).toContain("<main");
    expect(html).toContain("<h1");
  });

  // NOTE: change when removing waitlist
  it("renders the waitlist page without a browser", () => {
    const Stub = createRoutesStub([{ path: "/waitlist", Component: WaitListRoute }]);
    const html = renderToString(<Stub initialEntries={["/waitlist"]} />);

    expect(html).toContain("<main");
    expect(html).toContain("<h1");
  });

  it("renders the login page without a browser", () => {
    const Stub = createRoutesStub([{ path: "/login", Component: LogInRoute }]);
    const html = renderToString(<Stub initialEntries={["/login"]} />);

    expect(html).toContain("<main");
    expect(html).toContain("<h1");
  });

  it("renders the sign-up page without a browser", () => {
    const Stub = createRoutesStub([{ path: "/signup", Component: SignUpRoute }]);
    const html = renderToString(<Stub initialEntries={["/signup"]} />);

    expect(html).toContain("<main");
    expect(html).toContain("<h1");
  });

  // The page itself, since a loader would not run inside renderToString.
  const profile = {
    slug: "ada-lovelace",
    first_name: "Ada",
    last_name: "Lovelace",
    bio: "",
    public_email: null,
    public_phone: null,
  };

  it("renders the onboarding page without a browser", () => {
    const Stub = createRoutesStub([
      {
        path: "/onboarding",
        Component: () => (
          <Onboarding
            step="profile"
            profile={profile}
            chairs={[]}
            chair={null}
            services={[]}
            live={false}
            error={null}
          />
        ),
      },
    ]);
    const html = renderToString(<Stub initialEntries={["/onboarding"]} />);

    expect(html).toContain("<main");
    expect(html).toContain("<h1");
  });

  // The booking link's origin comes from the browser, so the server renders the link without it.
  it("renders the done screen without a browser", () => {
    const chair = {
      id: "0000000c-0000-4000-8000-000000000001",
      shop: { slug: "krusty-fadez", name: "Krusty Fadez" },
      is_active: true,
      schedule_days: [],
    };
    const Stub = createRoutesStub([
      {
        path: "/onboarding",
        Component: () => (
          <Onboarding
            step="live"
            profile={profile}
            chairs={[chair]}
            chair={chair}
            services={[]}
            live
            error={null}
          />
        ),
      },
    ]);
    const html = renderToString(<Stub initialEntries={["/onboarding"]} />);

    expect(html).toContain("/view-services/ada-lovelace");
  });

  it("renders the dashboard with an edit dialog open without a browser", () => {
    const me = {
      first_name: "Ada",
      last_name: "Lovelace",
      email: null,
      has_worker_profile: true,
      has_shop: true,
      is_live: true,
    };
    const chair = {
      id: "0000000c-0000-4000-8000-000000000001",
      shop: { slug: "krusty-fadez", name: "Krusty Fadez" },
      is_active: true,
      schedule_days: [],
    };
    const Stub = createRoutesStub([
      {
        path: "/dashboard",
        Component: () => (
          <Dashboard me={me} editing={{ edit: "schedule", chairs: [chair], chair }} error={null} />
        ),
      },
    ]);
    const html = renderToString(<Stub initialEntries={["/dashboard?edit=schedule"]} />);

    expect(html).toContain("<dialog");
    expect(html).toContain('form="worker-hours"');
  });
});
