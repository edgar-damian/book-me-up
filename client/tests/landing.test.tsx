import { render, screen } from "@testing-library/react";
import { createRoutesStub, matchRoutes, type RouteObject } from "react-router";
import { describe, expect, it } from "vitest";
import routes from "~/routes";
import Home from "~/routes/home";
import { expectHeadingOutline } from "./helpers";

// Pages not built yet.
const PLACEHOLDERS = [
  "#login", // NOTE: change when removing waitlist
  "/#about",
  "/#contact",
  "/#privacy",
  "/#terms",
];

function renderLanding() {
  const Stub = createRoutesStub([{ path: "/", Component: Home }]);
  render(<Stub initialEntries={["/"]} />);
}

/** A route in app/routes.ts, and a matching id when the link targets a section of this page. */
function resolves(href: string) {
  if (!href) return false;
  const url = new URL(href, "http://localhost/");
  if (!matchRoutes(routes as RouteObject[], url.pathname)) return false;
  if (url.pathname !== "/" || !url.hash) return true;
  return document.getElementById(url.hash.slice(1)) !== null;
}

describe("landing page", () => {
  // NOTE: change when removing waitlist
  it("sends every sign-up CTA to the waitlist", () => {
    renderLanding();
    const ctas = [
      screen.getByRole("link", { name: "Create my booking link" }),
      screen.getByRole("link", { name: "Start my 3 free months" }),
      ...screen.getAllByRole("link", { name: "Join a waitlist" }),
    ];
    for (const cta of ctas) expect(cta).toHaveAttribute("href", "/waitlist");
  });

  it("links only to routes that exist and to sections on the page", () => {
    renderLanding();
    const dead = [...document.querySelectorAll("a")]
      .map((a) => a.getAttribute("href") ?? "")
      .filter((href) => !PLACEHOLDERS.includes(href) && !resolves(href));
    expect(dead).toEqual([]);
  });

  it("has one h1 and no skipped heading levels", () => {
    renderLanding();
    expectHeadingOutline();
  });
});
