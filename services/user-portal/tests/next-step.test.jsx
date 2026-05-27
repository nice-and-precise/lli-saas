import { expect, test } from "vitest";

import { describeNextStep } from "../src/pages/DashboardPage";

const base = {
  loading: false,
  mondayConnected: true,
  hasBoard: true,
  errorCount: 0,
  canStartScan: true,
  deliveryCount: 0,
};

test("gives no cue while the dashboard is still loading", () => {
  expect(describeNextStep({ ...base, loading: true })).toBeNull();
});

test("walks the operator through the setup sequence", () => {
  expect(describeNextStep({ ...base, mondayConnected: false })).toMatch(/connect your monday/i);
  expect(describeNextStep({ ...base, hasBoard: false })).toMatch(/import your owners/i);
  expect(describeNextStep({ ...base, errorCount: 2 })).toMatch(/resolve 2 mapping issues/i);
  expect(describeNextStep({ ...base, errorCount: 1 })).toMatch(/resolve 1 mapping issue\b/i);
});

test("invites a scan once setup is clear, and notes prior deliveries", () => {
  expect(describeNextStep(base)).toMatch(/run a scan/i);
  expect(describeNextStep({ ...base, deliveryCount: 3 })).toMatch(/3 leads delivered/i);
  expect(describeNextStep({ ...base, deliveryCount: 1 })).toMatch(/1 lead delivered/i);
});

test("falls back to finishing setup when the validator has not cleared a scan", () => {
  expect(describeNextStep({ ...base, canStartScan: false })).toMatch(/finish the destination board/i);
});
