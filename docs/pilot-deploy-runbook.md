# Pilot Deploy Runbook

## Goal

Deploy a Monday-first pilot release candidate with immutable image references, Kubernetes-managed secrets, and a repeatable rollback path.

## Current Verified Pilot Endpoints

- namespace: `lli-saas-pilot`
- Helm release: `lli-saas`
- portal: `http://portal.35.225.151.173.sslip.io`
- `crm-adapter`: `http://crm.34.42.223.140.sslip.io`
- `lead-engine`: `http://lead.34.57.110.0.sslip.io:8000`
- Monday OAuth callback: `http://crm.34.42.223.140.sslip.io/auth/callback`
- `obituary-intelligence-engine` is internal-only in the live pilot deployment

## Required Inputs

1. Copy `infra/charts/lli-saas/values.pilot.example.yaml` to `infra/charts/lli-saas/values.pilot.yaml`.
2. Replace every `replace-with-*` image reference and every `*.example.com` URL in `infra/charts/lli-saas/values.pilot.yaml`.
3. Copy `infra/.env.example` to `infra/.env`.
4. Fill in Monday OAuth values, the shared JWT secret, operator credentials, at least one obituary provider key, and the cron JWT in `infra/.env`.
5. Keep `infra/.env` and `infra/charts/lli-saas/values.pilot.yaml` out of git.

## Preflight

Run the repo checks and capture release evidence before deploying:

```bash
source "$HOME/.nvm/nvm.sh" && nvm use 20
make lint
make typecheck
make format-check
PILOT_VALUES_FILE=infra/charts/lli-saas/values.pilot.yaml \
PILOT_RELEASE_MODE=1 \
bash scripts/capture-pilot-evidence.sh
```

If the evidence script fails, do not deploy.

## Deploy

Dry-run the deployment first:

```bash
bash scripts/deploy-pilot.sh \
  --values infra/charts/lli-saas/values.pilot.yaml \
  --env-file infra/.env \
  --namespace lli-saas-pilot \
  --dry-run
```

Apply the release:

```bash
bash scripts/deploy-pilot.sh \
  --values infra/charts/lli-saas/values.pilot.yaml \
  --env-file infra/.env \
  --namespace lli-saas-pilot
```

The deploy script creates or updates these secrets before running Helm:

- `lli-saas-shared-auth`
- `lli-saas-crm-adapter-secrets`
- `lli-saas-obituary-provider-secrets`
- `lli-saas-lead-engine-cron`

## Post-Deploy Checks

```bash
kubectl -n lli-saas-pilot get pods
helm status lli-saas -n lli-saas-pilot
kubectl -n lli-saas-pilot get pvc
```

Then run the manual rehearsal from [docs/pilot-release-checklist.md](/Users/jordan/Desktop/LLI_v1/docs/pilot-release-checklist.md) and [docs/pilot-runbook-david-whitaker.md](/Users/jordan/Desktop/LLI_v1/docs/pilot-runbook-david-whitaker.md).

## Rollback

Inspect the Helm history:

```bash
helm history lli-saas -n lli-saas-pilot
```

Rollback to the last known-good revision:

```bash
bash scripts/rollback-pilot.sh \
  --namespace lli-saas-pilot \
  --revision <REVISION>
```

After rollback, confirm pods are healthy and repeat the `/ready` checks before resuming pilot activity.
