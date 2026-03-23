# Product Requirements Document (PRD): Land Legacy Intelligence (LLI-SaaS)

## 1. Product Context & Overview
**Product Name:** LLI-SaaS (Land Legacy Intelligence)  
**Target Audience:** Land brokers and brokerages (e.g., Whitaker Marketing Group as the initial pilot).  
**Core Value Proposition:** An obituary-intelligence and CRM lead-delivery platform that identifies inherited-land leads and automatically delivers them into the broker's CRM (e.g., Monday.com) as actionable intelligence.

## 2. Problem Statement
Land brokers rely on finding landowners who may be interested in selling. Inherited land (where an owner passes away) is a prime source of leads, but tracking obituaries, identifying heirs, and cross-referencing with property deed and GIS data is a massive manual effort. Brokers need an automated way to surface these opportunities directly in their workflow.

## 3. Product Vision & Rules
- **CRM is the Source of Truth:** `lli-saas` is NOT a standalone CRM or system of record for brokers. The customer's CRM (Monday.com) is the ultimate source of truth for owner data.
- **Automated Intelligence:** `lli-saas` fetches canonical owners at scan time, runs obituary intelligence against them, and delivers scored leads back to the CRM.
- **Multi-Tenant SaaS:** The platform is a cloud-native, multi-tenant SaaS built around the "Reaper Engine," offering shared backend services with row-level data isolation for cost efficiency and scalability.

## 4. Key Components and Architecture
1. **Obituary Intelligence Engine (`services/obituary-intelligence-engine`):** Inherits the "Reaper" logic to collect obituaries, identify deceased owners, extract heirs using LLMs, match against land records, and tier the leads.
2. **Lead Engine (`services/lead-engine`):** Orchestrates the `run_scan()` process, managing data flow between the CRM adapter and the obituary intelligence engine.
3. **CRM Adapter (`services/crm-adapter`):** Manages Monday.com OAuth, board mapping, deduplication of incoming leads, and API pushes into the customer's CRM board.
4. **User Portal (`services/user-portal`):** The operator UI where brokers can log in, select target CRM boards, map fields, initiate scans, and manage billing/trial credits.

## 5. User Journey & Workflows
- **Registration & Integration:** Broker signs up, connects their Monday.com CRM via OAuth, and maps their target lead board fields.
- **Scanning Context:** The system performs automated daily scans or broker-initiated manual scans for their target territory (e.g., Iowa).
- **Processing:** The Lead Engine triggers the Obituary Intelligence Engine to find matches between recent obituaries and canonical land records.
- **Delivery:** Matched leads (with deceased name, heirs, acreage, location, and match confidence score) are automatically created or updated in the broker's Monday.com board.

## 6. Pilot Program Strategy
- **Initial Customer:** David Whitaker (Whitaker Marketing Group).
- **Pricing:** Usage-based tiers (scans/leads) with a generous free trial of usage credits.
- **Focus:** Prove the value instantly ("Wow Moment") by having the first scan populate real leads in Monday.com immediately.

## 7. Future Expansion & Moat
- **More Geographies:** Expand beyond the initial Iowa target to broader midwest and national coverage.
- **Multiple CRMs:** Provide adapter support for HubSpot, Salesforce, and other CRM enterprise systems.
- **Exclusive Data Licenses:** Establish data exclusivity arrangements for premium brokerages on a per-county basis.
