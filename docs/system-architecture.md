# System Architecture

This document is the architectural source of truth for `lli-saas`.

## System purpose

`lli-saas` is an obituary intelligence and lead delivery platform for brokers.

- Customer CRM is the source of truth for owner data.
- The platform enriches broker-owned CRM landowner records with death, heir, and inherited-land signals.
- The product is not a land database platform and does not own the owner corpus.

## Core flow

`CRM -> Owner Corpus -> Obituary Intelligence Engine -> Lead Graph -> CRM Delivery`

For the current MVP the concrete path is:

`Monday Clients board -> canonical OwnerRecord[] -> obituary_intelligence_engine -> canonical Lead[] -> Monday destination board`

## Components

- `user-portal`
  - Operator-facing UI for OAuth setup, destination-board mapping visibility, status, and scan launch.
  - Reads status and mapping from `crm-adapter`.
  - Triggers scans through `lead-engine`.

- `crm-adapter`
  - Monday-only adapter for the MVP.
  - Owns Monday OAuth, source-owner fetch from the `Clients` board, destination-board selection, board mapping, and lead delivery back into Monday.
  - Translates Monday-specific schemas to and from canonical models.

- `owner_corpus`
  - Canonical internal owner-record boundary.
  - Represents the normalized owner corpus for a single scan request.
  - Exists in memory for the duration of a scan and is not persisted yet.

- `obituary_intelligence_engine`
  - Intelligence boundary that consumes canonical `OwnerRecord[]`.
  - Wraps the legacy Reaper concept without leaking legacy naming or CRM-specific field assumptions into the rest of the platform.

- `lead-engine`
  - Single orchestration owner for `run_scan()`.
  - Fetches owner records through the CRM adapter, invokes `obituary_intelligence_engine`, aggregates delivery results, and returns canonical `ScanResult`.

- `auth`
  - Monday OAuth is currently relevant for CRM connectivity.
  - No broader application auth platform is in scope in the current MVP beyond the existing local portal stub.

## Canonical models

- `OwnerRecord`
  - `owner_id: string`
  - `owner_name: string`
  - `county: string | null`
  - `state: string | null`
  - `acres: number | null`
  - `parcel_ids: string[]`
  - `mailing_state: string | null`
  - `crm_source: string`
  - `raw_source_ref: string | null`

- `Lead`
  - Canonical lead payload used between obituary intelligence and CRM delivery.
  - Includes scan metadata, owner/deceased identity, property details, heir contacts, notes, tags, and raw artifact references.

- `ScanResult`
  - `scan_id`
  - `status`
  - `owner_count`
  - `lead_count`
  - `delivery_summary`
  - `leads`
  - `errors`

## Design rules

- CRM is the source of truth for owner data.
- Owner data is fetched fresh at runtime for every scan.
- `lli-saas` does not persist the owner corpus yet.
- Canonical schemas isolate CRM-specific differences from the obituary engine and the rest of the platform.
- `obituary_intelligence_engine` is the intelligence layer, not the CRM integration layer.
- Future CRM support should require only new adapter mappings, not engine-core rewrites.
- `run_scan()` is the single orchestration entry point.

## MVP scope

- Monday.com is the first CRM adapter.
- The source owner board is `Clients`.
- Leads are delivered back into the customer CRM.
- No mock data.
- No permanent owner database inside `lli-saas`.
- No multi-CRM implementation in the current pass.
- No enterprise API surface or speculative infrastructure beyond what is needed for the real end-to-end path.

## Future extension notes

- Additional CRM support should be added through new adapter mappings around canonical `OwnerRecord` and `Lead`.
- Owner snapshot caching can be added later if runtime fetch cost or latency requires it.
- State-based scan partitioning can be added later if volume or throughput requires it.
