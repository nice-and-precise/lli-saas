# Implementation Plan and Recommendations

Below is a structured plan covering repositories, tools, and processes to implement the SaaS platform using the Codex VS Code extension and GSD framework. Each section includes concrete steps and best practices, with relevant references for guidance.

## 1. Repositories, Tools, and VSCode Codex Setup

- **Repositories:** Set up separate repositories for each service (e.g. `lead-engine`, `crm-adapter`, `user-portal`). Include a shared repository for infrastructure code (CI/CD configs, Kubernetes manifests) and a `.planning/` directory for GSD. The [GSD “Get Shit Done” system](https://github.com/gsd-build/get-shit-done) can orchestrate planning and execution across these repos; it now supports Codex via the `get-shit-done-cc` command【68†L998-L1004】.
- **GSD CLI:** Install the GSD CLI for Codex (via `npx get-shit-done-cc`). Configure `.planning/config.json` with project settings (mode, granularity, model profiles)【68†L842-L852】【68†L998-L1004】. This enables scripted planning phases and task decomposition.
- **VS Code + Codex Extension:** Install the OpenAI Codex extension for VS Code (available on macOS/Linux)【66†L575-L584】. After installation, drag the Codex sidebar icon to a convenient position (e.g. right side) for split view【66†L608-L617】【66†L623-L627】. Sign in with your ChatGPT (Codex-enabled) account or API key to enable coding assistance【66†L629-L634】.
- **Workspace Configuration:** In VS Code, arrange the layout as follows: file explorer on one side, Codex chat panel on the other, and an integrated terminal at the bottom (as one user suggested【64†L143-L152】). Add any needed extensions (e.g. Docker, YAML) to support development.
- **Codex Context:** For large codebases, ensure good context: use workspace files, include key example files in prompts, or use the Codex “add to context” feature. Follow Codex best practices: always include the **Goal, Context, Constraints, and Done-when** in prompts【63†L588-L596】. For difficult tasks, use Codex’s Plan mode or a PLANS.md template to outline steps first【63†L618-L626】【63†L631-L637】.
- **Authentication & Access:** Since Codex will run code and call APIs, store any secrets (API keys) securely. Add `.env` and credential files to a denylist so Codex won’t read them【68†L918-L927】.

## 2. Task Planning and Markdown Instructions for Codex

- **Phased Task Lists:** Use GSD and Codex together to break down the project into phases (e.g. *Phase 1: Core Services Setup*, *Phase 2: Lead Engine Integration*, *Phase 3: CRM Integration*, *Phase 4: UI & Onboarding*). For each phase, create a `PLANS.md` or GSD plan with detailed bullet steps. For example:
  1. *Set up project scaffolding:* create repo, Dockerfile, basic app structure.
  2. *Implement lead data service:* integrate Reaper engine as a containerized service.
  3. *Build CRM adapter:* scaffold a Node/Python app to handle OAuth and GraphQL calls.
  4. *Develop user portal:* set up a simple web UI for monitoring and configuration.
  5. *CI/CD pipeline:* write GitHub Actions or Jenkinsfile for each service.
  6. *End-to-end test and docs:* verify integration and write usage guides.
- **Markdown Instructions for Codex:** Write detailed prompts in markdown so Codex can follow them step-by-step. For example, in a `TASK.md` file:
  ```
  ### Task: Create Dockerfile for Lead Engine Service  
  **Goal:** Build a Dockerfile to containerize the lead-processing service.  
  **Context:** This service uses Python with requirements in `requirements.txt`.  
  **Constraints:** Use Python 3.10-slim, install dependencies, and expose port 8080.  
  **Done when:** Dockerfile builds an image that runs the service on startup.
  ```
  This structure aligns with Codex best practices (Goal, Context, Constraints, Done)【63†L588-L596】.
- **Ask Codex to Plan:** For multi-step tasks, use `/plan` or `/gsd:plan` so Codex first outlines sub-tasks. You might instruct: `/plan “Write a plan for implementing CI/CD pipelines for all services.”` This yields a breakdown before coding.
- **AGENTS.md:** Store any repeatable instructions in an `AGENTS.md` (GSD docs) so Codex loads project-specific guidance (e.g. coding standards, tech stack notes) automatically【63†L631-L637】.
- **Use Codex Skills:** If available, leverage Codex Skills like GSD to automatically generate specs, tasks, or documentation. For example, one can prompt Codex: “Use GSD to generate milestone phases for this repository,” turning repeated planning into an automated step.
- **Review and Iterate:** After Codex generates code or configs, review carefully. Codex is a powerful teammate but still requires human validation. Use `gsd:verify` or Codex review features to check against requirements.

## 3. CI/CD and Containerization Blueprint

- **Service Containerization:** Each microservice (Lead Engine, CRM Adapter, User Portal, etc.) should have its own Dockerfile. For example, use `python:3.10-slim` for Python services or `node:18-alpine` for Node.js. In Dockerfiles, install dependencies, copy code, and set a non-root user. Ensure a small final image with `npm prune --production` or similar. Include a `healthcheck` command so Kubernetes can monitor readiness.
- **Semantic Versioning:** Adopt Semantic Versioning for each service’s releases. Tag releases (e.g. `v1.2.0`) in Git and Docker images. This allows independent updates and easy rollbacks【73†L391-L399】.
- **CI Pipelines per Service:** Implement isolated pipelines (e.g. GitHub Actions workflows or Jenkinsfiles) for each repository. As Devtron advises, each microservice should have a dedicated pipeline to build/test/deploy independently【73†L325-L333】. This includes:
  - **Build & Test:** In CI, build Docker image, run unit tests, and perform security scans (e.g. `trivy scan`)【73†L478-L485】.
  - **Publish Artifacts:** Push Docker images to a container registry with tags (e.g. AWS ECR, GCR).
  - **Versioning:** Automatically bump version based on Git tags (GitHub Actions can do this) or use GitOps tools.
  - **Deployment:** Use GitOps or Kubernetes manifests/Helm charts to deploy. For progressive delivery, incorporate canary or blue/green strategies so new versions can be rolled out safely【73†L415-L423】.
- **Progressive Delivery:** To minimize downtime, use deployment strategies:  
  - **Canary Releases:** Deploy new pods for a fraction of traffic, monitor, then promote.  
  - **Blue/Green:** Keep two environments and switch traffic after validation.  
  - **Feature Flags:** Encapsulate unfinished features behind flags so you can enable them without a full redeploy【73†L427-L431】【73†L415-L423】.
- **Git Branching Strategy:** For development, use feature branches and pull requests. For releases, GSD can auto-create a branch per phase or milestone (see `.planning` config for `git.branching_strategy`)【68†L889-L899】. Squash-merge at phase completion to keep history clean.
- **Security and Scanning:** Integrate container scanning in CI (e.g. run `docker scan` or Trivy) to detect vulnerabilities early【73†L478-L485】. Manage secrets with a vault or Kubernetes secrets; do **not** commit them. Use RBAC in CI/CD to restrict who can deploy.
- **Monitoring & Rollback:** Include health checks and metrics collection (Prometheus/Grafana) in CI pipelines. Set up alerting on failure. In GitOps model, pipelines automatically roll back on failure or with manual approval gates.
- **Documentation:** Maintain as-code docs (e.g. README, architecture diagrams, Kubernetes manifests) versioned with code. Use GSD to keep `.planning/` docs and `PLANS.md` updated in Git【68†L883-L892】【68†L945-L954】.

## 4. Monday.com OAuth and GraphQL Integration

- **Monday App Registration:** Register your integration on the Monday.com Developers portal. Specify your OAuth redirect URL (e.g. your SaaS callback endpoint). This gives you a `client_id` and `client_secret`.
- **OAuth Flow:** Implement the OAuth 2.0 flow:
  1. **Authorization URL:** When the broker clicks “Connect Monday”, redirect them to `https://auth.monday.com/oauth2/authorize` with your `client_id` and requested scopes (e.g. `boards:read`, `boards:write`)【77†L269-L277】.
  2. **Callback Endpoint:** Monday redirects back with a code. Your backend exchanges this code for an access token and refresh token via Monday’s token endpoint【77†L304-L308】.
  3. **Token Storage:** Save the access token (and refresh token if provided) securely in the user’s account. Use this token in API calls (set header `Authorization: <token>`).
  - *Note:* As Monday’s docs suggest, OAuth is required for background/server calls beyond 5 minutes【77†L269-L277】【77†L304-L308】.
- **GraphQL API Usage:** All data access happens via Monday’s GraphQL API. Use the token to perform queries and mutations.
  - **Fetch Boards & Columns:** Query the broker’s boards to let them choose where leads should go. Example query:  
    ```graphql
    query {
      boards (ids: 123456789) {
        id
        name
        columns {
          id
          title
          type
        }
      }
    }
    ```  
    This retrieves all columns for board `123456789`【78†L111-L119】.
  - **Create/Update Items:** To push a lead, use `create_item` (mutation). For example:  
    ```graphql
    mutation {
      create_item(board_id: 123456789, item_name: "John Smith") {
        id
        name
      }
    }
    ```  
    This creates a new board item named “John Smith” on board `123456789`【78†L166-L174】. Use similar mutations to set column values (via `change_column_values`) for acres, location, heirs, etc.
  - **Batch Operations:** Monday’s API allows batching multiple creations or queries in one request, which helps stay within rate limits【78†L193-L202】.
  - **Deduplication:** Before creating a lead, optionally run a query to find existing items with the same unique key (e.g. land ID or deceased name). If found, update that item instead of creating a duplicate.
- **API Limits:** Be mindful of rate limits. Monday.com documents high per-minute quotas (up to 10,000,000 complex points/minute) but also notes plan-based daily limits【75†L330-L339】. To be safe, batch updates and catch `rate_limit` errors to back off if needed.
- **Error Handling:** Check responses for errors. If a GraphQL call fails (e.g. token expired), refresh the token (if applicable) or ask the user to re-authenticate. Log errors for troubleshooting.
- **Webhook (Optional):** You can also set up Monday webhooks for real-time triggers if needed (e.g. if a lead status changes in Monday, notify your system). Monday supports configuring webhooks in integrations.
- **One-click Setup:** For an optimal experience, you might pre-create a board template via Monday’s API and prompt the user to use it. But at minimum, ensure the user selects a board and maps lead fields in your UI.
- **Documentation:** Instruct users (in developer onboarding) to have admin access on Monday to generate tokens or approve the app.

## 5. Developer Onboarding Documentation and Pilot Runbook

- **Onboarding Checklist:** Prepare a concise dev onboarding guide. Include steps to clone repos, install dependencies, and run the system locally. For example:
  1. **Environment Setup:** Provide instructions for installing Node.js/Python, Docker, and setting environment variables.  
  2. **Clone and Build:** Show how to clone each service repo and build with Docker or `npm install`【81†L83-L92】.  
  3. **Run Services Locally:** Explain how to run each service (e.g. via `docker-compose up`), including any mock configs or sample data.
  4. **Codebase Tour:** Summarize the architecture (perhaps include an architecture diagram). New developers should review key modules (e.g. Reaper wrapper, CRM adapter) to understand project structure【81†L83-L92】.
  5. **Tools and Scripts:** Document custom CLI commands (e.g. `npm run dev`, GSD commands) and where to find configuration (e.g. `.env.example`, `.planning/config.json`).
- **Access and Permissions:** Ensure new developers have accounts and permissions. For example, grant access to Monday.com, container registry, and code repos on day one【81†L189-L197】. Provide a list of credentials and endpoints in the onboarding doc (excluding secrets).
- **Mentorship:** Assign a senior developer to walk newcomers through the first run of the system. A buddy can help answer questions about project goals and standards.
- **Pilot Runbook for David Whitaker:** Create a checklist for the pilot implementation:
  1. **Initial Setup:** Confirm David’s environment (he already has Monday CRM and farmer data). Provide him with a test Monday board or template.
  2. **Free Scan Credits:** Explain trial limits and where to see credits. Perhaps start with 10 free scans as agreed.
  3. **Monday Connection:** Guide David through connecting his Monday account via OAuth. Ensure he picks the correct board for leads.
  4. **First Scan (Wow Moment):** Run the first obituary scan together. Verify that at least one valid lead appears in his Monday board. This immediate result creates the “wow moment” when he sees value【61†L93-L100】.
  5. **Walkthrough:** Show him the portal/dashboard, how to configure scans (e.g. by county), and how leads map to board columns.
  6. **Collect Feedback:** After the first session, note any feedback on ease of use or lead quality. Use this to iterate on UI or instructions.
  7. **Follow-Up:** Provide contact info for support and schedule a check-in after a week to answer questions.
- **Pilot Objectives:** The runbook should emphasize quick wins. The goal is to have David add his first lead to CRM in the first meeting, reinforcing value【61†L93-L100】. Also, ensure he knows how to trigger additional scans.
- **Documentation:** Maintain all onboarding steps in the repo’s README or a dedicated `ONBOARDING.md`. Include commands for quickstart (e.g. `npm install`, `docker-compose up`) and link to the pilot runbook.

**Sources:** We applied OpenAI’s Codex and GSD best practices【63†L588-L596】【68†L998-L1004】, microservices CI/CD guidelines【73†L325-L333】【73†L391-L399】, and Monday.com API docs【78†L111-L119】【77†L269-L277】. Developer and onboarding recommendations come from industry guides【81†L83-L92】【61†L93-L100】. These informed the structured plan above to move from design to implementation.