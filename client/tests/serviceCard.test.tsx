import { render, screen } from "@testing-library/react";
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
});
