// @vitest-environment node
import { renderToString } from "react-dom/server";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";
import Home from "~/routes/home";
import WaitListRoute from "~/routes/waitlist";
import LogInRoute from "~/routes/login";

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
});
