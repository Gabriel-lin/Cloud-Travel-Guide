import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import Home from "./page";

vi.mock("@/components/CpuUsage", () => ({
  default: () => <div data-testid="cpu-usage" />,
}));
vi.mock("@/components/CpuFlameDiagram", () => ({
  default: () => <div data-testid="cpu-flame" />,
}));
vi.mock("@/components/DynamicLineChart", () => ({
  default: () => <div data-testid="dynamic-chart" />,
}));

describe("Home", () => {
  it("renders the app title", () => {
    render(<Home />);
    expect(screen.getByText("Cloud Travel Guide")).toBeInTheDocument();
  });
});
