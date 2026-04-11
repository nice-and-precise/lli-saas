import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";

import MatchExplainabilityCard from "../src/components/MatchExplainabilityCard";

const SAMPLE_LEAD = {
  deceased_name: "Bob Henderson",
  owner_name: "Robert Henderson",
  match: {
    score: 92.5,
    last_name_score: 100,
    first_name_score: 88.0,
    location_bonus_applied: true,
    status: "auto_confirmed",
    confidence_band: "high",
    matched_fields: ["last_name", "first_name", "full_name", "location"],
    explanation: [
      "[last_name] score=100 weight=0.4 evidence=owner=henderson obituary=henderson",
      "[first_name] score=88 weight=0.35 evidence=owner=robert obituary=bob",
    ],
    explanation_details: [
      {
        component: "last_name",
        score: 100,
        weight: 0.4,
        matched: true,
        evidence: "owner=henderson obituary=henderson",
      },
      {
        component: "first_name",
        score: 88.0,
        weight: 0.35,
        matched: true,
        evidence: "owner=robert obituary=bob",
      },
      {
        component: "full_name",
        score: 90.5,
        weight: 0.15,
        matched: true,
        evidence: "Full-name similarity reinforced the token-level match after normalization.",
      },
      {
        component: "location",
        score: 5.0,
        weight: 0.0,
        matched: true,
        evidence: "City/state alignment added the configured location bonus.",
      },
    ],
    nickname_match: {
      owner_name_used: "robert",
      obituary_name_used: "bob",
      nickname_set: ["bob", "bobby", "rob", "robert"],
    },
    discrepancies: [
      {
        field: "city",
        owner_value: "Boone",
        obituary_value: "Ames",
        severity: "minor",
        note: "City names differ (similarity 45%) — could be a nearby town or mailing address.",
      },
    ],
    geographic_proximity: {
      owner_city: "Boone",
      owner_state: "IA",
      obituary_city: "Ames",
      obituary_state: "IA",
      same_state: true,
      city_match_score: 45.0,
      bonus_applied: false,
    },
  },
};

test("renders explainability header with score and confidence band", () => {
  render(<MatchExplainabilityCard lead={SAMPLE_LEAD} />);
  // Score and badge appear in both strict-mode renders
  expect(screen.getAllByText("92.5%").length).toBeGreaterThanOrEqual(1);
  expect(screen.getAllByText("High").length).toBeGreaterThanOrEqual(1);
  expect(screen.getAllByText("Auto-confirmed").length).toBeGreaterThanOrEqual(1);
});

test("shows nickname match indicator", () => {
  render(<MatchExplainabilityCard lead={SAMPLE_LEAD} />);
  expect(screen.getAllByText("Nickname match detected").length).toBeGreaterThanOrEqual(1);
  expect(screen.getAllByText(/robert ↔ bob/i).length).toBeGreaterThanOrEqual(1);
  expect(screen.getAllByText(/Known aliases:/i).length).toBeGreaterThanOrEqual(1);
});

test("shows geographic proximity section", () => {
  render(<MatchExplainabilityCard lead={SAMPLE_LEAD} />);
  expect(screen.getAllByText("Geographic Proximity").length).toBeGreaterThanOrEqual(1);
  // Details are collapsed by default; the section title confirms the panel exists.
});

test("shows data discrepancies section", () => {
  render(<MatchExplainabilityCard lead={SAMPLE_LEAD} />);
  expect(screen.getAllByText("Data Discrepancies").length).toBeGreaterThanOrEqual(1);
  // Details are collapsed by default; the section title confirms the panel exists.
  // Discrepancy content is rendered inside a <details> element.
});

test("shows empty state when lead is null", () => {
  render(<MatchExplainabilityCard lead={null} />);
  expect(screen.getByText("No match data available.")).toBeInTheDocument();
});

test("renders component score breakdown", () => {
  render(<MatchExplainabilityCard lead={SAMPLE_LEAD} />);
  expect(screen.getAllByText("last_name").length).toBeGreaterThanOrEqual(1);
  expect(screen.getAllByText("first_name").length).toBeGreaterThanOrEqual(1);
  expect(screen.getAllByText("full_name").length).toBeGreaterThanOrEqual(1);
  expect(screen.getAllByText("location").length).toBeGreaterThanOrEqual(1);
});
