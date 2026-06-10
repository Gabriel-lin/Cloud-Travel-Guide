import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import HomePage from "./page";

describe("HomePage", () => {
  it("renders the 3D globe section heading", () => {
    render(<HomePage />);
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(
      "3D 地球",
    );
  });
});
