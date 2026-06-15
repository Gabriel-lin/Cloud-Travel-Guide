import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import ExplorePage from "./(main)/page";

describe("ExplorePage", () => {
  it("renders the 3D globe section heading", () => {
    render(<ExplorePage />);
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(
      "3D 地球",
    );
  });
});
