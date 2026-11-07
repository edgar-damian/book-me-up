import { render, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";
import type { Services } from "~/models/workerPage";
import { ServiceCard } from "~/widgets/WorkerPage/serviceCard";

const SERVICE: Services = {
  id: "service-1",
  worker_id: "worker-1",
  title: "Skin fade",
  description: "Clean and sharp.",
  image: null,
  price_cents: 4500,
  duration_min: 45,
  is_active: true,
};

function renderCard(service: Services = SERVICE) {
  render(<ServiceCard service={service} workerId="worker-1" establishmentId={null} />);
}

describe("service card", () => {
  it("shows the price and the length", () => {
    renderCard();
    expect(screen.getByText("$45.00")).toBeInTheDocument();
    expect(screen.getByText("45 min")).toBeInTheDocument();
  });

  it("keeps the cents of a price that has them", () => {
    renderCard({ ...SERVICE, price_cents: 3550 });
    expect(screen.getByText("$35.50")).toBeInTheDocument();
  });

  it("shows the title and the description", () => {
    renderCard();
    expect(screen.getByRole("heading", { name: "Skin fade" })).toBeInTheDocument();
    expect(screen.getByText("Clean and sharp.")).toBeInTheDocument();
  });

  it("shows a free service as $0.00", () => {
    renderCard({ ...SERVICE, price_cents: 0 });
    expect(screen.getByText("$0.00")).toBeInTheDocument();
  });

  it("links to booking this service at the chosen shop", () => {
    const Stub = createRoutesStub([
      {
        path: "/",
        Component: () => <ServiceCard service={SERVICE} workerId="worker-1" establishmentId="shop-1" />,
      },
    ]);
    render(<Stub initialEntries={["/"]} />);
    expect(screen.getByRole("link", { name: "Book Now" })).toHaveAttribute(
      "href",
      "/book-with/shop-1/worker-1/service-1",
    );
  });
});
