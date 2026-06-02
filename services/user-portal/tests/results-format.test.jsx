import { expect, test } from "vitest";

import { buildScanSummary, formatRelativeTime } from "../src/pages/DashboardPage";

const NOW = new Date("2026-06-01T12:00:00Z").getTime();
const ago = (ms) => new Date(NOW - ms).toISOString();
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

test("formatRelativeTime renders compact, pluralized relative times", () => {
  expect(formatRelativeTime(null, NOW)).toBeNull();
  expect(formatRelativeTime("not-a-date", NOW)).toBeNull();
  expect(formatRelativeTime(ago(20 * SECOND), NOW)).toBe("just now");
  expect(formatRelativeTime(ago(1 * MINUTE), NOW)).toBe("1 minute ago");
  expect(formatRelativeTime(ago(5 * MINUTE), NOW)).toBe("5 minutes ago");
  expect(formatRelativeTime(ago(2 * HOUR), NOW)).toBe("2 hours ago");
  expect(formatRelativeTime(ago(3 * DAY), NOW)).toBe("3 days ago");
  expect(formatRelativeTime(ago(75 * DAY), NOW)).toBe("2 months ago");
});

test("buildScanSummary explains new deliveries", () => {
  const summary = buildScanSummary({
    owner_count: 5,
    lead_count: 3,
    delivery_summary: { created: 3, skipped_duplicate: 0, failed: 0 },
  });
  expect(summary).toMatch(/against your 5 owners/);
  expect(summary).toMatch(/found 3 matches/);
  expect(summary).toMatch(/Delivered 3 new leads to your board/);
});

test("buildScanSummary makes the all-duplicate case explicit", () => {
  const summary = buildScanSummary({
    owner_count: 1,
    lead_count: 4,
    delivery_summary: { created: 0, skipped_duplicate: 4, failed: 0 },
  });
  expect(summary).toMatch(/against your 1 owner\b/);
  expect(summary).toMatch(/All matches were already in your board — no new leads this run/);
});

test("buildScanSummary handles zero matches and surfaces failures", () => {
  const zeroMatch = buildScanSummary({ owner_count: 2, lead_count: 0, delivery_summary: { created: 0, failed: 0 } });
  expect(zeroMatch).toMatch(/found 0 matches\. No new leads this run\./);
  // Zero-match should nudge toward the likely cause (Iowa + county/state).
  expect(zeroMatch).toMatch(/county and state/i);
  expect(
    buildScanSummary({ owner_count: 2, lead_count: 2, delivery_summary: { created: 1, failed: 1 } }),
  ).toMatch(/1 failed to deliver\./);
  expect(buildScanSummary(null)).toBe("");
});
