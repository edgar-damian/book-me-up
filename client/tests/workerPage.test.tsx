import { fireEvent, render, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { describe, expect, it, vi } from "vitest";
import type { Services, WorkerLandingPage } from "~/models/workerPage";
import { WorkerPage } from "~/pages/WorkerPage";

const WORKER: WorkerLandingPage = {
  id: "worker-1",
  slug: "sam-lee",
  first_name: "Sam",
  last_name: "Lee",
  bio: "Fades and lineups.",
  public_email: null,
  public_phone: null,
  image: null,
  is_active: true,
  hold_expiry_hours: 24,
  auto_accept: false,
  min_lead_time_min: 60,
  max_advance_days: 60,
  cancellation_cutoff_min: 120,
  services: [],
  chairs: [],
};

const PHONE = "+16925550102";
const EMAIL = "sam@example.com";
const SHOP = { address: "1 Main", city: "Reno", state: "NV", zip: "89501", lat: null, lng: null, timezone: "UTC", phone: null, email: null };
const chair = (name: string): WorkerLandingPage["chairs"][number] => ({ id: name, schedule_days: [], establishment: { ...SHOP, id: name, slug: name, name } });

function renderPage(contact: Partial<WorkerLandingPage>) {
  const Stub = createRoutesStub([{ path: "/", Component: () => <WorkerPage worker={{ ...WORKER, ...contact }} /> }]);
  render(<Stub initialEntries={["/"]} />);
}

describe("worker page contact details", () => {
  it("links a phone and an email the worker has set", () => {
    renderPage({ public_phone: PHONE, public_email: EMAIL });
    expect(screen.getByText("Have questions? Reach out:")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "(692) 555-0102" })).toHaveAttribute("href", `tel:${PHONE}`);
    expect(screen.getByRole("link", { name: EMAIL })).toHaveAttribute("href", `mailto:${EMAIL}`);
  });

  it("leaves out the email row without an email", () => {
    renderPage({ public_phone: PHONE });
    expect(screen.getByText(/Phone:/)).toBeInTheDocument();
    expect(screen.queryByText(/Email:/)).not.toBeInTheDocument();
  });

  it("leaves out the phone row without a phone", () => {
    renderPage({ public_email: EMAIL });
    expect(screen.getByText(/Email:/)).toBeInTheDocument();
    expect(screen.queryByText(/Phone:/)).not.toBeInTheDocument();
  });

  it("shows nothing without a phone or an email", () => {
    renderPage({});
    expect(screen.queryByText("Have questions? Reach out:")).not.toBeInTheDocument();
    expect(screen.queryByText(/Phone:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Email:/)).not.toBeInTheDocument();
  });

  it("keeps a number from outside the US as it is stored", () => {
    renderPage({ public_phone: "+442071838750" });
    expect(screen.getByRole("link", { name: "+442071838750" })).toHaveAttribute("href", "tel:+442071838750");
  });
});

describe("worker page services", () => {
  const FADE: Services = {
    id: "service-1",
    worker_id: "worker-1",
    title: "Zero fade",
    description: "Down to the skin.",
    image: null,
    price_cents: 9950,
    duration_min: 90,
    is_active: true,
  };
  const TRIM: Services = { ...FADE, id: "service-2", title: "Beard trim", description: "", price_cents: 2000, duration_min: 20 };

  it("shows the saved details of each service the API sends", () => {
    renderPage({ services: [FADE, TRIM] });
    expect(screen.getByRole("heading", { name: "Zero fade" })).toBeInTheDocument();
    expect(screen.getByText("Down to the skin.")).toBeInTheDocument();
    expect(screen.getByText("$99.50")).toBeInTheDocument();
    expect(screen.getByText("90 min")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Beard trim" })).toBeInTheDocument();
  });

  it("has no card for a service the API no longer sends", () => {
    renderPage({ services: [TRIM] });
    expect(screen.getByRole("heading", { name: "Beard trim" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Zero fade" })).not.toBeInTheDocument();
  });

  it("says so when there are no services", () => {
    renderPage({ services: [] });
    expect(screen.getByText("This person has not posted their services yet.")).toBeInTheDocument();
  });

  it("links straight to booking at a worker's only shop", () => {
    renderPage({ services: [FADE], chairs: [chair("Krusty")] });
    expect(screen.getByRole("link", { name: "Book Now" })).toHaveAttribute(
      "href",
      "/book-with/Krusty/worker-1/service-1",
    );
  });

  it("asks for a shop only on the card whose Book Now was pressed", () => {
    // jsdom has no scrollIntoView.
    Element.prototype.scrollIntoView = vi.fn();
    renderPage({ services: [FADE, TRIM], chairs: [chair("Krusty"), chair("Regular")] });
    const [first, second] = screen.getAllByRole("button", { name: "Book Now" });

    fireEvent.click(second);

    expect(second.parentElement).toHaveTextContent("Pick a shop first");
    expect(first.parentElement).not.toHaveTextContent("Pick a shop first");
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });

  it("asks for a shop without scrolling when the worker has none", () => {
    Element.prototype.scrollIntoView = vi.fn();
    renderPage({ services: [FADE] });

    fireEvent.click(screen.getByRole("button", { name: "Book Now" }));

    expect(screen.getByText("Pick a shop first")).toBeInTheDocument();
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
  });
});

describe("worker page shop selector", () => {
  it("hides it at one shop, which stays selected", () => {
    renderPage({ chairs: [chair("Krusty")] });
    expect(screen.queryByText("Works at")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Krusty" })).toBeInTheDocument();
  });

  it("keeps it at two shops", () => {
    renderPage({ chairs: [chair("Krusty"), chair("Regular")] });
    expect(screen.getByText("Select a shop to book")).toBeInTheDocument();
  });
});
