const payload = {
  scan_id: 'scan-2026-03-30-001',
  source: 'obituary_intelligence_engine',
  run_started_at: '2026-03-30T14:00:00Z',
  run_completed_at: '2026-03-30T14:03:12Z',
  owner_id: 'owner-1088',
  owner_name: 'Jordan Example',
  deceased_name: 'Pat Example',
  property: {
    county: 'Boone',
    state: 'IA',
    acres: 120.5,
    parcel_ids: ['17-01-100-001'],
    address_line_1: '123 County Road',
    city: 'Boone',
    postal_code: '50036',
    operator_name: 'Johnson Farms LLC',
  },
  heirs: [
    {
      name: 'Casey Example',
      relationship: 'son',
      location_city: 'Phoenix',
      location_state: 'AZ',
      out_of_state: true,
      phone: null,
      email: null,
      mailing_address: null,
      executor: false,
    },
  ],
  obituary: {
    url: 'https://example.com/obituaries/pat-example',
    source_id: 'kwbg_boone',
    published_at: '2026-03-30T13:55:00Z',
    death_date: '2026-03-29',
    deceased_city: 'Boone',
    deceased_state: 'IA',
  },
  match: {
    score: 96.2,
    last_name_score: 100,
    first_name_score: 90.5,
    location_bonus_applied: true,
    status: 'auto_confirmed',
  },
  tier: 'hot',
  out_of_state_heir_likely: true,
  out_of_state_states: ['AZ'],
  executor_mentioned: false,
  unexpected_death: false,
  notes: ['pilot-ready'],
  tags: ['tier:hot', 'signal:out_of_state_heir'],
  raw_artifacts: ['artifact-1.json'],
};

const response = await fetch('http://localhost:3000/leads', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-tenant-id': 'pilot',
  },
  body: JSON.stringify(payload),
});

if (!response.ok) {
  throw new Error(`Lead submission failed: ${response.status} ${await response.text()}`);
}

console.log(await response.json());
