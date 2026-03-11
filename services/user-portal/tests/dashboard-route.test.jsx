import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, test } from "vitest";

import App from "../src/App";

test("renders the dashboard route", () => {
  render(
    <MemoryRouter initialEntries={["/dashboard"]}>
      <App />
    </MemoryRouter>,
  );

  expect(screen.getByRole("heading", { name: /scan, connect, verify/i })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: /monday connection/i, level: 2 })).toBeInTheDocument();
});
