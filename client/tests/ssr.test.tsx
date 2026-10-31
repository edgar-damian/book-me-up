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

  const chair = {
    id: "0000000c-0000-4000-8000-000000000001",
    shop: { slug: "krusty-fadez", name: "Krusty Fadez" },
    is_active: true,
    schedule_days: [],
  };

  it("renders the dashboard with an edit dialog open without a browser", () => {
    const Stub = createRoutesStub([
      {
        path: "/dashboard",
        Component: () => (
          <Dashboard
            chairs={[chair]}
            chair={chair}
            week={null}
            editing={{ edit: "schedule", chairs: [chair], chair }}
            error={null}
          />
        ),
      },
    ]);
    const html = renderToString(<Stub initialEntries={["/dashboard?edit=schedule"]} />);

    expect(html).toContain("<dialog");
    expect(html).toContain('form="worker-hours"');
  });

  it("renders the week on the shop's clock without a browser", () => {
    const week = {
      timezone: "Pacific/Kwajalein",
      days: [
        {
          day: "2026-10-31",
          day_off: false,
          appointments: [
            {
              id: "00000007-0000-4000-8000-000000000001",
              // 9:00 on Saturday morning in Kwajalein, still Friday in UTC.
              starts_at: "2026-10-30T21:00:00Z",
              duration_min: 45,
              client_name: "Pearl Krabs",
              service_title: "The Bubble Fade",
              price_cents: 2500,
              status: "PENDING" as const,
            },
          ],
        },
      ],
    };
    const Stub = createRoutesStub([
      {
        path: "/dashboard",
        Component: () => <Dashboard chairs={[chair]} chair={chair} week={week} editing={null} error={null} />,
      },
    ]);
    const html = renderToString(<Stub initialEntries={["/dashboard"]} />);

    expect(html).toContain("Saturday, October 31");
    expect(html).toMatch(/>9:00\sAM</);
    expect(html).toContain("Pearl Krabs");
  });
});
