import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";
import { SiteHeader } from "~/widgets/siteHeader";

function renderHeader(props: ComponentProps<typeof SiteHeader> = { company: true }) {
  const Stub = createRoutesStub([{ path: "/", Component: () => <SiteHeader {...props} /> }]);
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

    expect(items(screen.getByRole("navigation", { name: "Primary" }))).toEqual(WORKER_LINKS);
    // The wordmark is the only link, and it leads back to the dashboard.
    expect(screen.getAllByRole("link")).toEqual([screen.getByRole("link", { name: /dashboard/ })]);
    expect(screen.getByRole("link", { name: /dashboard/ })).toHaveAttribute("href", "/dashboard");
    // One in the bar, one in the menu.
    expect(screen.getAllByRole("button", { name: "Log out" })).toHaveLength(2);
  });

  it("lists the same links and Log out in a worker's menu", async () => {
    const user = renderHeader({ shop: true });
    await user.click(menuButton());

    expect(items(within(menu()).getByRole("navigation", { name: "Mobile" }))).toEqual(WORKER_LINKS);
    expect(within(menu()).getByRole("button", { name: "Log out" })).toBeInTheDocument();
  });

  // `npm run typecheck` is what checks this one: the props refuse both at once.
  it("won't take company and shop together", () => {
    // @ts-expect-error company and shop are never both on
    expect(<SiteHeader company shop />).toBeTruthy();
  });
});
