import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, test } from "vitest";

import App from "../src/App";

test("renders the login route", () => {
  render(
    <MemoryRouter initialEntries={["/login"]}>
      <App />
    </MemoryRouter>,
  );

  expect(screen.getByRole("heading", { name: /broker access starts here/i })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: /login/i })).toBeInTheDocument();
});
