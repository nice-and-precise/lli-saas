# Executive Summary  
This document provides a detailed, actionable implementation plan for the LLI SaaS platform, designed to be fully executable by OpenAI Codex via VS Code on macOS. We assume the **Reaper Engine** (obituary processing) already exists and that David Whitaker’s landowner data resides in Monday.com CRM. The goal is to create a phased project structure with Codex-driven plans and tasks, including repository layouts, GSD integration, CI/CD pipelines, and Monday.com OAuth/GraphQL flows. Key artifacts (PLANS.md, TASK.md, AGENTS.md, `.planning/config.json`, Dockerfiles, Kubernetes manifests, GitHub Actions, and onboarding/runbook documents) are specified in full. We also cover deduplication logic, rate-limiting strategies, and environment estimates. All steps are presented in Markdown with sample commands and tables for clarity. GSD commands (e.g. `/gsd:plan-phase`) and Codex prompts (Goal/Context/Constraints/Done) are included to enable automated generation. Monday.com integration details include exact OAuth endpoints and GraphQL queries/mutations. A local checklist and developer onboarding guidance ensure the team can begin automation immediately.

## Repositories, Tools, and Local Environment  

We will use separate Git repositories for modularity: one per service plus infrastructure code. A table of repos is shown below:

| Repository Name      | Description                                      | Tech Stack        |
|----------------------|--------------------------------------------------|-------------------|
| `lead-engine`        | Wraps Reaper Engine; fetches and processes obituaries into leads. | Python, FastAPI   |
| `crm-adapter`        | Pushes leads to CRM (Monday.com) via OAuth and GraphQL. | Node.js or Python |
| `user-portal`        | Web UI for signup, scan configuration, and reports. | React + Node.js   |
| `infra`              | Kubernetes/Helm charts and Terraform for cloud setup. | YAML, Helm       |
| `devops-ci`          | Shared CI/CD templates (GitHub Actions), scripts. | YAML, Shell       |
| **Shared**           | Common configs (e.g. `.planning/`, scripts)       |                   |

### Tools and Setup  
- **VS Code with Codex**: Install the OpenAI Codex extension (from VS Code Marketplace) on your Mac【66†L575-L584】. After installation, drag the Codex panel icon to the right sidebar for a split view【66†L608-L617】【66†L623-L627】. Sign in with your ChatGPT (Codex) account or API key to enable the assistant【66†L629-L634】.  
- **GSD Framework**: Install GSD CLI for Codex with `npm install -g get-shit-done-cc` (or use `npx get-shit-done-cc`). This provides commands like `/gsd:plan-phase` and `/gsd:execute-phase`【85†L442-L450】. In each repo, create a `.planning/config.json` to configure the workflow (e.g. `workflow.mode`, `git.branching_strategy`, `gpt.model`). Example:
  ```json
  {
    "workflow": { "mode": "parallel", "branching_strategy": "branch_per_milestone" },
    "gpt": { "model": "gpt-5.2-turbo" }
  }
  ```  
- **Local Environment**: On the Mac developer machine, install Node.js (v18+), Python (v3.10+), Docker, and kubectl/Helm (for testing). Also install `gsd:progress` and other GSD tools via the CLI.  
- **Codex Context**: Prepare context files (e.g. `REQUIREMENTS.md`, `ARCHITECTURE.md`, sample data) that Codex can read. Use AGENTS.md to store style/convention notes, ensuring Codex applies them. For Codex prompts, always include **Goal, Context, Constraints, Done-when** as per best practices【63†L588-L596】.

## Phase-by-Phase Planning (PLANS.md)  

Use GSD’s plan mode to structure the project into phases and milestones【85†L442-L450】. Each phase has its own PLANS.md with numbered tasks. Below is a sample high-level breakdown. The actual PLANS.md for phase 1 is given as an example.

**Milestone 1:** Project Initialization  
- **Phase 1:** *Setup & Architecture* – Repos, environments, code scaffolding.  
- **Phase 2:** *Lead Engine Service* – Containerize Reaper Engine, test ingestion.  
- **Phase 3:** *CRM Adapter Service* – OAuth, GraphQL integration scaffolding.  
- **Phase 4:** *User Portal* – Basic UI and connectivity.  

**Milestone 2:** Core Features  
- **Phase 5:** *Automated Scanning* – Daily scheduler, queue integration.  
- **Phase 6:** *Lead Delivery* – Implement deduplication and output.  

**Milestone 3:** Production Readiness  
- **Phase 7:** *CI/CD & Infrastructure* – Pipelines, Kubernetes manifests.  
- **Phase 8:** *Pilot & Refinement* – Onboarding, load testing, documentation.

#### Sample PLANS.md (Phase 1)  
```
# Phase 1: Setup & Architecture

**Goal:** Establish project structure, development environment, and initial service skeletons.

1. Initialize Git repos for `lead-engine`, `crm-adapter`, `user-portal`, `infra`, and `devops-ci`.
2. In each repo, create standard folders: `/src`, `/tests`, `/docs`, `.github/workflows`.
3. Create `.planning/` directory with an initial `config.json` (copy example). 
4. Write a top-level `README.md` describing the architecture and tech stack.
5. Generate an initial `ARCHITECTURE.md` with component diagrams.
6. Create a workspace Docker Compose to run all services locally for development.
7. Commit and push skeletons; create initial branch `phase1-init`.

```
*Citations:* GSD commands like `/gsd:plan-phase 1` would generate this file automatically【85†L442-L450】.

## TASK Examples (TASK.md)

Each task is a standalone instruction file that Codex will execute. They follow the format with Goal/Context/Constraints/Done. Here are three examples:

### TASK 1: Create `lead-engine` Repository and Skeleton  
```
Goal: Initialize the `lead-engine` service codebase.
Context: We use Python 3.10, FastAPI, and Docker.
Constraints: Use Poetry for Python dependency management.
Done-when: A new Git repo with a FastAPI app (Hello World) and Dockerfile exists.

- Run `git init lead-engine` and commit.
- Create `src/` with `app.py` containing a FastAPI app.
- Add `Dockerfile` (FROM python:3.10-slim, install Poetry, copy code).
- Create `pyproject.toml` with dependencies (fastapi, uvicorn).
- Verify that `docker build` succeeds and `docker run` responds on port 8000.
```

### TASK 2: Build `crm-adapter` OAuth Flow  
```
Goal: Implement Monday.com OAuth endpoints in `crm-adapter`.
Context: Use Node.js (Express) for the adapter; OAuth client_id/secret obtained.
Constraints: Use `axios` for HTTP calls, store tokens in a vault.
Done-when: The Express app has routes `/auth/login` (redirect to Monday) and `/auth/callback` (exchange code, save tokens).

- In `crm-adapter/src/`, create `server.js` with Express routes.
- In `/auth/login`, redirect to `https://auth.monday.com/oauth2/authorize?client_id=xxx&state=yyy`.
- In `/auth/callback`, read `req.query.code`, POST to `https://auth.monday.com/oauth2/token` with client_id, client_secret, code.
- Receive access_token; store it using a placeholder vault command (`VAULT_ADD monday_token <token>`).
- Verify by making a test GraphQL query to `api.monday.com/v2`.
```

### TASK 3: Write GitHub Actions Workflow for `lead-engine`  
```
Goal: Create CI workflow to build/test Docker image for `lead-engine`.
Context: Use GitHub Actions on pushes to `main`.
Constraints: Include linting and security scan.
Done-when: `.github/workflows/ci.yml` exists and passes checks.

- Create `.github/workflows/ci.yml` in `lead-engine`.
- On `push` to `main`, checkout code.
- Set up Python 3.10, install dependencies.
- Run `poetry run pytest`.
- Build Docker image `lead-engine:latest`.
- Run a security scan (`trivy image lead-engine:latest`).
- On success, push image to registry (`registry.example.com/lead-engine:${{ github.sha }}`).
```

*References:* Codex prompt best practices suggest including Goal/Context/Constraints/Done to ensure complete solutions【63†L588-L596】.

## Folder and File Structure

Organize each repository with a consistent layout. For example, `lead-engine/`:

```
lead-engine/
  src/
    app.py
    ...
  tests/
  .github/
    workflows/
      ci.yml
  Dockerfile
  pyproject.toml
  .env.example
  README.md
  PLANS.md
  TASKS/
    task001-create-repo.md
  .planning/
    config.json
    AGENTS.md
```

Include an `AGENTS.md` (for GSD/Codex) and `.planning/config.json` in each. Example `.planning/config.json`:
```json
{
  "workflow": {
    "mode": "parallel",
    "branching_strategy": "branch_per_phase",
    "milestone_definition": "All tasks verified"
  },
  "git": {
    "create_pr_on_merge": true
  },
  "gpt": {
    "model": "gpt-5.2-turbo",
    "temperature": 0.0,
    "tokens": 800000,
    "context_lines": 50
  }
}
```
`AGENTS.md` can define coding standards and prompt guidance, e.g.:
```
- Style: RESTful APIs, JSON input/output.
- Error handling: use try/catch and return HTTP 400 for bad requests.
- Logging: send logs to stdout for cloud logging.
```

## CI/CD and Containerization  

Use Docker and GitHub Actions for CI/CD, and Kubernetes for deployment.

### Dockerfiles  
For each service, a Dockerfile skeleton:  
**lead-engine/Dockerfile**:
```dockerfile
FROM python:3.10-slim
WORKDIR /app
COPY pyproject.toml poetry.lock /app/
RUN pip install poetry && poetry install --no-root --only main
COPY src/ /app/src/
EXPOSE 8000
CMD ["poetry", "run", "uvicorn", "src.app:app", "--host", "0.0.0.0", "--port", "8000"]
```
**crm-adapter/Dockerfile**:
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package.json package-lock.json /app/
RUN npm ci
COPY src/ /app/src/
EXPOSE 3000
CMD ["node", "src/server.js"]
```
**user-portal/Dockerfile** (React app):
```dockerfile
FROM node:18-alpine as builder
WORKDIR /app
COPY package.json yarn.lock /app/
RUN yarn install
COPY . /app/
RUN yarn build

FROM nginx:alpine
COPY --from=builder /app/build /usr/share/nginx/html
```

### GitHub Actions Workflows  
Each repo has a `ci.yml`. Example for `lead-engine`:
```yaml
name: CI

on: [push]
jobs:
  build-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Set up Python
        uses: actions/setup-python@v4
        with: python-version: 3.10
      - name: Install deps
        run: |
          pip install poetry
          poetry install
      - name: Run tests
        run: |
          poetry run pytest --maxfail=1 --disable-warnings -v
      - name: Build Docker image
        run: docker build -t ${{ secrets.REGISTRY }}/lead-engine:latest .
      - name: Scan image
        uses: aquasecurity/trivy-action@v0.0.20
        with:
          image-ref: ${{ secrets.REGISTRY }}/lead-engine:latest
      - name: Push image
        run: |
          echo "${{ secrets.REGISTRY_PASS }}" | docker login ${{ secrets.REGISTRY }} -u ${{ secrets.REGISTRY_USER }} --password-stdin
          docker push ${{ secrets.REGISTRY }}/lead-engine:latest
```
Similar workflows apply to `crm-adapter` and `user-portal`, adjusting commands (e.g. `npm test` or `yarn build`). Use semantic tagging (e.g. `${{ github.sha }}`) for versioning and releases.

### Kubernetes Manifests / Helm  
Define a Helm chart or k8s manifests in `infra/`. For example, `infra/helm/templates/lead-engine-deployment.yaml`:
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: lead-engine
spec:
  replicas: 2
  template:
    metadata:
      labels: { app: lead-engine }
    spec:
      containers:
        - name: lead-engine
          image: {{ .Values.registry }}/lead-engine:{{ .Values.tag }}
          ports: [{ containerPort: 8000 }]
          envFrom:
            - secretRef: { name: lead-engine-secrets }
          readinessProbe:
            httpGet: { path: /health, port: 8000 }
```
Include Services and Ingress as needed. Use `Helm` values to manage image tags and resource requests (e.g. CPU 500m, memory 512Mi). For example, in `values.yaml`:
```yaml
registry: registry.example.com
tag: latest
resources:
  requests: { cpu: 200m, memory: 256Mi }
  limits:   { cpu: 500m, memory: 512Mi }
```
Use a `Secret` for sensitive config (e.g. Monday OAuth credentials) instead of hard-coding. Consider a Vault integration: e.g. `vault:` annotations to fetch secrets at runtime.

## Monday.com OAuth & GraphQL Integration  

Implement Monday integration in `crm-adapter`:

1. **Register OAuth App:** In Monday.com developer portal, register the app to obtain `client_id` and `client_secret`.
2. **Redirect (Login) Endpoint:**  
   - Route: `GET /auth/login`  
   - Action: Redirect user to Monday’s OAuth URL, e.g.:  
     ```
     https://auth.monday.com/oauth2/authorize
       ?client_id=<CLIENT_ID>
       &redirect_uri=https://yourapp.com/auth/callback
       &state=<RANDOM_STATE>
     ```
3. **Callback Endpoint:**  
   - Route: `GET /auth/callback`  
   - Read `code` from query params. Exchange it for tokens:  
     ```
     POST https://auth.monday.com/oauth2/token
     Content-Type: application/json
     {
       "client_id": "<CLIENT_ID>",
       "client_secret": "<CLIENT_SECRET>",
       "code": "<AUTH_CODE>",
       "redirect_uri": "https://yourapp.com/auth/callback"
     }
     ```  
   - Monday returns `access_token` (and optionally `refresh_token`). Store `access_token` securely, e.g. in Vault or encrypted DB.  
4. **Using the Token:** Include the token in GraphQL calls by setting the `Authorization` header to the token value【77†L269-L277】. Monday’s GraphQL endpoint is `https://api.monday.com/v2`.  
5. **GraphQL Queries/Mutations:**  
   - **Get Boards:**  
     ```graphql
     query {
       boards {
         id
         name
         columns { id title type }
       }
     }
     ```  
     Fetch all boards the user has access to (then filter for CRM boards).  
   - **Create Lead Item:**  
     ```graphql
     mutation {
       create_item(board_id: 123456, item_name: "John Doe") {
         id
         name
       }
     }
     ```【78†L166-L174】  
     Follow with `change_column_values` to set custom columns (e.g. acres, county, heirs).  
   - **Deduplication:** Before creating, run:  
     ```graphql
     query {
       items_by_column_values(board_id: 123456, column_id: "name", column_value: "John Doe") {
         id
       }
     }
     ```  
     If an item exists, use `change_column_values` instead of `create_item`.  
6. **Rate Limit Handling:** Monday’s API has high quotas but use exponential backoff on 429 errors. Pseudocode:  
   ```bash
   while retry < 5:
     response = call_monday_api()
     if response.status == 429:
       sleep(2**retry)
       retry++
     else:
       break
   ```  
7. **Secrets Management:** Store `client_secret`, `vault` tokens, and Monday tokens in a secure store. For example, use HashiCorp Vault or Kubernetes Secrets mounted into containers. The CRM adapter reads secrets at startup, not from code.  
8. **Validation:** Add a health endpoint (e.g. `/health`) that checks Monday API connectivity using the saved token.

## Developer Onboarding & Pilot Runbook  

### Onboarding Checklist  
- **Accounts & Tools:** Ensure new developers have: GitHub access, registry credentials, Monday.com sandbox account, and API keys/secrets (via vault).  
- **Local Setup:** Instruct to clone all repos, run `npm install`/`poetry install`, and start services via Docker Compose (`docker-compose up`). Provide a step-by-step `SETUP.md`.  
- **Environment Variables:** Provide a table of required env vars (in `env_vars.md`). Example:

| Variable               | Required? | Description                                  |
|------------------------|-----------|----------------------------------------------|
| `MONDAY_CLIENT_ID`     | Yes       | OAuth Client ID for Monday.com               |
| `MONDAY_CLIENT_SECRET` | Yes       | OAuth Client Secret for Monday.com           |
| `VAULT_ADDR`           | No        | URL of HashiCorp Vault for secrets           |
| `DATABASE_URL`         | Yes       | DB connection string for user-portal         |
| `REGISTRY_USER/PASS`   | Yes       | Docker registry credentials for CI/CD        |

- **Codebase Orientation:** Walk through each service’s README. Explain the tech stack (FastAPI, Node.js, React), and key flows (e.g. how lead-engine calls Reaper).  
- **Run Initial Build:** Have devs run `npm run dev` or `uvicorn app` to verify the skeletons work. Ensure tests pass (`pytest` or `jest`).  
- **Documentation:** Store this onboarding guide in each repo’s `README.md` and a central `DEV-ONBOARDING.md`.  
- **Environment Estimates:** Recommend each service use moderate resources: e.g. Docker container with 200Mi-512Mi RAM and 0.5 CPU. On Mac, Docker Desktop with 4 cores and 4GiB RAM should suffice. Cloud staging: start with a cluster of 3 nodes (2 CPU, 4GiB each) for Kubernetes. Adjust after load testing.

### Pilot Runbook (David Whitaker)  
- **Purpose:** Quickly validate value for David Whitaker’s team.  
- **Setup:** Provide David with a credentials package: a Monday.com test workspace, and the platform’s URL.  
- **Free Credits:** Configure a trial plan (e.g. 10 initial scans). Show how credits are consumed in the portal.  
- **Integration:** Assist David in clicking “Connect Monday”. Confirm the OAuth handshake results in an active token in the CRM-adapter logs.  
- **First Scan:** Trigger a scan of one county (e.g., Story County) to generate leads. Verify at least one lead appears on his Monday board and in the portal. This immediate success creates a “wow moment”【61†L93-L100】.  
- **Deduplication Test:** If a test lead is created twice, ensure the adapter updates the existing item instead of duplicating (via `items_by_column_values`).  
- **Rate Limit Test:** Simulate hitting the Monday API rate limit (e.g. by rapidly inserting leads). Confirm the backoff logic works (delay then retry).  
- **Feedback Loop:** Have David verify leads in Monday and portal, and report any issues (wrong column mapping, missing data).  
- **Check Outreach Risks:** Emphasize confidentiality of his data and the value of the intel, to encourage adoption (“don’t let competitors get this”).  
- **Documentation:** Provide a one-page “Quickstart” and an example run of the scan and lead push.

## Local Startup Checklist  
1. **Install prerequisites:** Node.js, Python 3.10, Docker Desktop, `kubectl`, `helm`, and VS Code Codex extension【66†L575-L584】.  
2. **Clone repos:**  
   ```bash
   git clone <org>/lead-engine.git
   git clone <org>/crm-adapter.git
   git clone <org>/user-portal.git
   git clone <org>/infra.git
   git clone <org>/devops-ci.git
   ```  
3. **Create Vault (for dev):** Optionally run a local HashiCorp Vault and store Monday OAuth secrets.  
4. **Build & Run:** Navigate to each service directory and run:
   ```bash
   # Lead Engine
   cd lead-engine
   docker build -t lead-engine:test .
   docker run -d -p 8000:8000 lead-engine:test

   # CRM Adapter
   cd crm-adapter
   npm ci
   # Create .env from template and fill in client_id/secret
   npm start

   # User Portal
   cd user-portal
   npm ci && npm start
   ```  
5. **Run with Docker Compose (optional):** In a central repo with a `docker-compose.yml`, run all services together:  
   ```bash
   docker-compose up --build
   ```  
6. **Check Services:** Verify each service’s health endpoint (e.g. `http://localhost:8000/health`).  
7. **Monitor Logs:** Ensure Codex-generated code has no syntax errors. Use GSD’s `/gsd:execute-phase 1` to run all `TASKS/*.md` tasks automatically【85†L442-L450】. Review any failures via `/gsd:verify-work`.

**Sources:** We followed OpenAI’s Codex best-practices (Goal/Context/Constraints/Done)【63†L588-L596】 and GSD workflow guidance【85†L442-L450】. CI/CD and security recommendations come from microservices best practices【73†L325-L333】【73†L478-L485】. Monday.com OAuth/GraphQL steps follow their official docs【77†L269-L277】【78†L166-L174】. Developer onboarding advice is based on industry guides【81†L83-L92】【61†L93-L100】. All code snippets and commands are ready to be executed by Codex according to the plan above.