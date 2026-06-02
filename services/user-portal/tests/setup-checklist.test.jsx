import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";

import SetupChecklist from "../src/components/SetupChecklist";

afterEach(cleanup);

test("marks completed steps done and points the operator at the next action", () => {
  render(
    <SetupChecklist
      sourceBoard={{ name: "Clients" }}
      hasBoard={true}
      fieldsMapped={true}
      hasScanned={false}
      onDismiss={() => {}}
    />,
  );

  expect(screen.getByText(/Owner board found \(Clients\)/i)).toBeInTheDocument();
  expect(screen.getByText(/Monday\.com connected/i).closest("li").className).toMatch(/is-done/);
  // The only unfinished step is the first scan, so it's highlighted as current.
  expect(screen.getByText(/Run your first scan/i).closest("li").className).toMatch(/is-current/);
});

test("guides the operator to find owners when no source board was detected", () => {
  render(<SetupChecklist sourceBoard={null} hasBoard={false} fieldsMapped={false} hasScanned={false} />);

  const ownerStep = screen.getByText(/Find your owners board/i).closest("li");
  expect(ownerStep.className).toMatch(/is-current/);
});
