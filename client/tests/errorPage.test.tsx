import { render, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";
import { ErrorBoundary } from "~/root";
import { expectHeadingOutline } from "./helpers";

function renderError(thrown: unknown) {
  const Stub = createRoutesStub([
    {
      path: "/",
      Component: () => null,
      ErrorBoundary,
      loader: () => {
        throw thrown;
      },
    },
  ]);
  render(<Stub initialEntries={["/"]} />);
}

const title = (name: string) => screen.findByRole("heading", { level: 1, name });

describe("root error page", () => {
  it("reads a 404 as not found", async () => {
    renderError(new Response("Not found", { status: 404 }));
    expect(await title("Page not found")).toBeInTheDocument();
  });

  it("reads a malformed link's 422 as not found", async () => {
    renderError(new Response("Not found", { status: 422 }));
    expect(await title("Page not found")).toBeInTheDocument();
  });

  it("does not read an outage as not found, whatever the response says", async () => {
    renderError(new Response("Not found", { status: 503 }));
    expect(await title("Something went wrong")).toBeInTheDocument();
    expect(screen.queryByText(/can't find that page/)).not.toBeInTheDocument();
  });

  it("has the company header and footer and a link home", async () => {
    renderError(new Response("Not found", { status: 404 }));
    await title("Page not found");
    expect(screen.getAllByRole("link", { name: "Log in" }).length).toBeGreaterThan(0);
    expect(screen.getByRole("contentinfo")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go home" })).toHaveAttribute("href", "/");
  });

  it("has one h1 and no skipped heading levels", async () => {
    renderError(new Response("Not found", { status: 404 }));
    await title("Page not found");
    expectHeadingOutline();
  });

  it("hides a thrown error's message", async () => {
    renderError(new Error("query blew up"));
    await title("Something went wrong");
    expect(screen.queryByText(/query blew up/)).not.toBeInTheDocument();
  });
});
