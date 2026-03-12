#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

run_step() {
  local label="$1"
  shift

  echo
  echo "==> ${label}"
  "$@"
}

cd "${ROOT_DIR}"

run_step "lead-engine tests" bash -lc 'cd services/lead-engine && python3 -m poetry run pytest'
run_step "crm-adapter tests" bash -lc 'cd services/crm-adapter && npm test'
run_step "user-portal tests" bash -lc 'cd services/user-portal && npm test'
run_step "user-portal build" bash -lc 'cd services/user-portal && npm run build'
run_step "lead-engine docker build" docker build -t lli-saas/lead-engine:pilot-check services/lead-engine
run_step "crm-adapter docker build" docker build -t lli-saas/crm-adapter:pilot-check services/crm-adapter
run_step "user-portal docker build" docker build -t lli-saas/user-portal:pilot-check services/user-portal
run_step "helm lint" helm lint infra/charts/lli-saas
run_step "helm template" bash -lc 'helm template lli-saas infra/charts/lli-saas > /tmp/lli-saas-pilot-rendered.yaml'

if command -v kubectl >/dev/null 2>&1 && kubectl config current-context >/dev/null 2>&1; then
  run_step "kubectl dry-run validation" kubectl apply --dry-run=client --validate=false -f /tmp/lli-saas-pilot-rendered.yaml
else
  echo
  echo "==> kubectl dry-run validation"
  echo "kubectl not configured with a current context; skipping local manifest dry-run"
fi

echo
echo "Pilot readiness check complete."
