import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { createRoutesStub, redirect } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { SiteHeader } from "~/widgets/siteHeader";

function renderHeader(props: ComponentProps<typeof SiteHeader> = { company: true }) {
  const Stub = createRoutesStub([{ path: "/", Component: () => <SiteHeader {...props} /> }]);
  render(<Stub initialEntries={["/"]} />);
  return userEvent.setup();
}

/** The worker header, with a stand-in /logout action and a /login page to land on. */
function renderWorkerHeader(logout: (args: { request: Request }) => Promise<unknown>) {
  const Stub = createRoutesStub([
    { path: "/", Component: () => <SiteHeader shop /> },
    { path: "/logout", action: logout },
    { path: "/login", Component: () => <h1>Log in</h1> },
  ]);
  render(<Stub initialEntries={["/"]} />);
  return userEvent.setup();
}

const menuButton = () => screen.getByRole("button", { name: "Open menu" });
const menu = () => screen.getByRole("dialog", { name: "Menu" });
const closeButton = () => within(menu()).getByRole("button", { name: "Close menu" });
const items = (nav: HTMLElement) => within(nav).getAllByRole("listitem").map((li) => li.textContent);

const WORKER_LINKS = ["Time off", "Hours", "Services", "Profile"];

describe("site header", () => {
  it("keeps the closed menu inert and collapsed", () => {
    renderHeader();

    expect(menuButton()).toHaveAttribute("aria-expanded", "false");
    expect(menu()).toHaveAttribute("inert");
  });

  it("moves focus into the menu and locks page scroll when opened", async () => {
    const user = renderHeader();
    await user.click(menuButton());

    expect(menuButton()).toHaveAttribute("aria-expanded", "true");
    expect(menu()).not.toHaveAttribute("inert");
    expect(closeButton()).toHaveFocus();
    expect(document.body.style.overflow).toBe("hidden");
  });

  it("closes on Escape, unlocks scroll, and returns focus to the menu button", async () => {
    const user = renderHeader();
    await user.click(menuButton());
    await user.keyboard("{Escape}");

    expect(menuButton()).toHaveAttribute("aria-expanded", "false");
    expect(menuButton()).toHaveFocus();
    expect(document.body.style.overflow).toBe("");
  });

  it("wraps Tab and Shift+Tab inside the open menu", async () => {
    const user = renderHeader();
    await user.click(menuButton());
    const logIn = within(menu()).getByRole("link", { name: "Log in" });

    logIn.focus();
    await user.tab();
    expect(closeButton()).toHaveFocus();

    await user.tab({ shift: true });
    expect(logIn).toHaveFocus();
  });

  it("closes when a link in the menu is chosen", async () => {
    const user = renderHeader();
    await user.click(menuButton());
    await user.click(within(menu()).getByRole("link", { name: "Pricing" }));

    expect(menuButton()).toHaveAttribute("aria-expanded", "false");
  });

  it("shows only the wordmark on shop and barber pages", () => {
    renderHeader({ company: false });

    expect(screen.getByRole("link", { name: /home/ })).toHaveAttribute("href", "/");
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("gives a worker their own links and Log out, and nothing that leaves the app", () => {
    renderHeader({ shop: true });

    const nav = screen.getByRole("navigation", { name: "Primary" });
    expect(items(nav)).toEqual(WORKER_LINKS);
    // Each opens its part of the setup on the dashboard. Time off isn't built yet.
    expect(within(nav).getByRole("link", { name: "Hours" })).toHaveAttribute("href", "/dashboard?edit=schedule");
    expect(within(nav).getByRole("link", { name: "Services" })).toHaveAttribute(
      "href",
      "/dashboard?edit=services",
    );
    expect(within(nav).getByRole("link", { name: "Profile" })).toHaveAttribute("href", "/dashboard?edit=profile");
    expect(within(nav).queryByRole("link", { name: "Time off" })).not.toBeInTheDocument();
    // The wordmark leads back to the dashboard, and no link goes anywhere else.
    expect(screen.getByRole("link", { name: /dashboard/ })).toHaveAttribute("href", "/dashboard");
    for (const link of screen.getAllByRole("link")) {
      expect(link.getAttribute("href")).toMatch(/^\/dashboard(\?|$)/);
    }
    // One in the bar, one in the menu.
    expect(screen.getAllByRole("button", { name: "Log out" })).toHaveLength(2);
  });

  it("lists the same links and Log out in a worker's menu", async () => {
    const user = renderHeader({ shop: true });
    await user.click(menuButton());

    expect(items(within(menu()).getByRole("navigation", { name: "Mobile" }))).toEqual(WORKER_LINKS);
    expect(within(menu()).getByRole("button", { name: "Log out" })).toBeInTheDocument();
  });

  it("logs out with a POST to /logout and lands on the login page", async () => {
    const logout = vi.fn(async (_: { request: Request }) => redirect("/login"));
    const user = renderWorkerHeader(logout);

    await user.click(screen.getAllByRole("button", { name: "Log out" })[0]);

    expect(await screen.findByRole("heading", { name: "Log in" })).toBeInTheDocument();
    expect(logout).toHaveBeenCalledTimes(1);
    expect(logout.mock.calls[0][0].request.method).toBe("POST");
  });

  it("shows Logging out… in both buttons while the logout runs", async () => {
    const user = renderWorkerHeader(() => new Promise(() => {}));

    await user.click(screen.getAllByRole("button", { name: "Log out" })[0]);

    expect(await screen.findAllByRole("status", { name: "Logging out…" })).toHaveLength(2);
    for (const button of screen.getAllByRole("button", { name: /Logging out…/ })) {
      expect(button).toHaveAttribute("aria-busy", "true");
    }
  });

  // `npm run typecheck` is what checks this one: the props refuse both at once.
  it("won't take company and shop together", () => {
    // @ts-expect-error company and shop are never both on
    expect(<SiteHeader company shop />).toBeTruthy();
  });
});
