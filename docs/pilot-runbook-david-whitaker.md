# Getting started — Land Legacy Leads (David Whitaker pilot)

**Land Legacy Leads turns recent Iowa obituaries into inherited-land leads, delivered
straight into your Monday.com board** — scored, tiered, and linked back to the obituary.

Open **https://lli.jordandamhof.com/welcome** for the same overview in the app, or jump
straight to **https://lli.jordandamhof.com** to begin.

## What you'll need

- A **Monday.com** account you can sign in to.
- Your land owners in Monday, each with a **county** and **state**.
- This works for **Iowa** land owners — owners outside Iowa won't match obituaries yet.

## Getting started — 3 steps

1. **Install + connect Monday.** First open the **install link** in the email (it adds the
   "LLI Lead Engine" app to your Monday account), and click **Install**. Then open the portal,
   click **Connect Monday**, and authorize the app. *(You only do this once.)* We ask Monday for
   permission to read your boards and to create the leads board — nothing else.
2. **We set everything up for you.** On that first connected load the app automatically:
   - finds the board in your workspace that holds your landowners (by its columns — county,
     state, acres, parcel, operator, etc.);
   - builds a clean **"Land Legacy Leads"** board for the results;
   - maps every field for you.
   A short **setup checklist** shows what got done and points at the one thing left to do.
3. **Run your first scan.** Press **Run obituary scan** (the defaults are fine). Matched,
   tiered leads land as items on your **Land Legacy Leads** board.

That's it. After your first scan, the system **re-scans automatically every day**, so new
leads keep arriving with no action from you.

## What to expect

- **Where leads go:** new items on your **Land Legacy Leads** Monday board. Click a result in
  the dashboard's **Latest results** to see why it matched and to open the obituary.
- **Quality signals:** each lead has a match **score** and a **tier** (e.g. "Needs review",
  "Low match") so you can prioritize.
- **A run with no new leads is normal** — it usually just means no new Iowa obituaries matched
  your owners that week. It is not an error.

## If something looks off

- **"I ran a scan and got nothing."** Most often the owners aren't Iowa, or are missing a
  **county/state**. Open **Setup & connections** and confirm your owner board has those columns
  (or import a CSV — there's a **Download example CSV** link showing the exact format).
- **"It picked the wrong owner board."** Open **Setup & connections → Where your owners come
  from** and choose the right board.
- **"No owner board was found."** Use **Import your owners** in Setup to upload a CSV; we'll
  build a `Clients` board from it.
- **"This app is private and cannot be installed in your account."** You skipped the install
  step. Open the **install link** from the email first, click **Install**, then return to the
  portal and click **Connect Monday**.
- **Anything else:** just reply to the email that sent you here.

---

## Operator notes (Jordan)

Technical/runbook detail for the person running the pilot — not needed by Dave.

**Monday app distribution — REQUIRED before any external account (Dave) can connect.** A private
app shows *"This app is private and cannot be installed in your account"* on the OAuth authorize
screen for any account that hasn't installed it. To fix, in the **Developer Center** (monday.com →
profile picture → **Developers**), open **LLI Lead Engine** (client_id `7c11d0d059b6de1f6ab3f5563f81ba4d`):

1. **Manage → App versions** — promote the current version to **Live** (draft versions can't be
   shared). If it's already Live, leave it.
2. **Distribute → Share** — accept the developer terms, then either:
   - **Share App** → copy the public **shareable install URL** (any Monday user can install), or
   - **Share with specific monday accounts** → enter Whitaker's Monday account URL (only they can
     install).
3. Send Dave that **install URL**. He opens it → **Install** → then **Connect Monday** in the
   portal. (Install-first is the supported path; the authorize URL also sets
   `force_install_if_needed=true` so the portal Connect button can trigger install on its own, but
   install-first avoids relying on the OAuth state surviving Monday's install redirect.)

After Dave connects, **his token replaces the stored Monday token in KV** (single-tenant pilot by
design) — Jordan's own dashboard view then runs against Dave's Monday account.

**Live services (Vercel):** portal `https://lli.jordandamhof.com`, crm-adapter
`https://crm.jordandamhof.com` (Monday OAuth callback `/auth/callback`), lead-engine
`https://lead.jordandamhof.com`, obituary-engine `https://obit.jordandamhof.com`. Provisioning
and env detail live in [vercel-deployment.md](vercel-deployment.md).

**First-run flow under the hood:** the portal lands on `/dashboard` (the `/welcome` route is the
shareable overview; there's no login page). **Connect Monday** → `crm-adapter /auth/login` →
OAuth (signed `state` + binding cookie) → callback redirects to `/dashboard?connected=1`.
Auto-onboarding runs once on that first connected load (`POST /onboard/auto-provision`):
detects the owner **source** board, creates the **"Land Legacy Leads"** destination board with
typed columns, and auto-maps every field. Idempotent + best-effort (gated by
`onboarding.auto_provisioned_at`; a Monday hiccup degrades gracefully and
`POST /boards/auto-provision-destination` is the explicit retry). Override the source board via
`POST /boards/select-source` (the **Owner source board** dropdown); if none was detected,
`POST /owners/import` (the CSV panel) creates a `Clients` board.

**Measuring progress:** the dashboard's **Activity & pipeline** section + `GET /metrics` (served
by the obituary engine, proxied through lead-engine) track obituaries scanned/day and leads
delivered/day; stored in Upstash KV so they persist across deploys.

**Health/troubleshooting:** confirm `/ready` for lead-engine, obituary-engine, and crm-adapter.
If OAuth fails, verify `MONDAY_CLIENT_ID`/`MONDAY_CLIENT_SECRET`/`MONDAY_REDIRECT_URI`. If the
portal can't load boards/status, verify the crm-adapter base URL. If a scan can't launch, verify
lead-engine can reach obituary-engine. If no heir data appears, verify the obituary passed the
actionability gate and AI provider keys are present. On Vercel, state lives in Upstash KV
(`STATE_STORE_BACKEND=kv`; check `KV_REST_API_URL`/`KV_REST_API_TOKEN`).

**Local development:** lead-engine `:8000`, obituary-engine `:8080`, crm-adapter `:3000`,
user-portal `:5173`; copy each service's `.env.example` to `.env` and set the values listed in
[vercel-deployment.md](vercel-deployment.md). Make sure the Monday OAuth redirect URI matches the
adapter callback.
