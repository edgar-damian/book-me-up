import { render, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";
import type { WorkerLandingPage } from "~/models/workerPage";
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
