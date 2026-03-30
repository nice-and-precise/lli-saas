#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RENDERED_MANIFEST="/tmp/lli-saas-pilot-rendered.yaml"

run_step() {
  local label="$1"
  shift

  echo
  echo "==> ${label}"
  "$@"
}

assert_not_in_file() {
  local pattern="$1"
  local file="$2"
  local message="$3"

  if python3 - "$pattern" "$file" <<'PY'
import pathlib
import re
import sys

pattern = sys.argv[1]
path = pathlib.Path(sys.argv[2])
text = path.read_text()

sys.exit(0 if re.search(pattern, text, re.MULTILINE) else 1)
PY
  then
    echo "ERROR: ${message}" >&2
    exit 1
  fi
}

assert_in_file() {
  local pattern="$1"
  local file="$2"
  local message="$3"

  if ! python3 - "$pattern" "$file" <<'PY'
import pathlib
import re
import sys

pattern = sys.argv[1]
path = pathlib.Path(sys.argv[2])
text = path.read_text()

sys.exit(0 if re.search(pattern, text, re.MULTILINE) else 1)
PY
  then
    echo "ERROR: ${message}" >&2
    exit 1
  fi
}

cd "${ROOT_DIR}"

run_step "lead-engine tests" bash -lc 'cd services/lead-engine && poetry run pytest'
run_step "obituary-intelligence-engine tests" bash -lc 'cd services/obituary-intelligence-engine && poetry run pytest'
run_step "crm-adapter tests" bash -lc 'cd services/crm-adapter && npm test'
run_step "user-portal tests" bash -lc 'cd services/user-portal && npm test'
run_step "user-portal build" bash -lc 'cd services/user-portal && npm run build'
run_step "lead-engine docker build" docker build -f services/lead-engine/Dockerfile -t lli-saas/lead-engine:pilot-check .
run_step "obituary-intelligence-engine docker build" docker build -f services/obituary-intelligence-engine/Dockerfile -t lli-saas/obituary-intelligence-engine:pilot-check .
run_step "crm-adapter docker build" docker build -f services/crm-adapter/Dockerfile -t lli-saas/crm-adapter:pilot-check .
run_step "user-portal docker build" docker build -t lli-saas/user-portal:pilot-check services/user-portal
run_step "helm lint" helm lint infra/charts/lli-saas
run_step "helm template" bash -lc "helm template lli-saas infra/charts/lli-saas > ${RENDERED_MANIFEST}"
run_step "rendered manifest assertions" bash -lc "
  set -euo pipefail
  source /dev/stdin <<'EOF'
$(typeset -f assert_in_file)
$(typeset -f assert_not_in_file)
EOF
  assert_in_file 'kind: PersistentVolumeClaim\nmetadata:\n  name: crm-adapter-state' '${RENDERED_MANIFEST}' 'crm-adapter PVC is missing from rendered manifests'
  assert_in_file 'kind: PersistentVolumeClaim\nmetadata:\n  name: obituary-engine-state' '${RENDERED_MANIFEST}' 'obituary-engine PVC is missing from rendered manifests'
  assert_in_file 'name: CRM_ADAPTER_STATE_PATH\n +value: \"/var/lib/lli-saas/crm-adapter/monday-state.json\"' '${RENDERED_MANIFEST}' 'crm-adapter state path env is missing from rendered manifests'
  assert_in_file 'name: OBITUARY_ENGINE_STATE_PATH\n +value: \"/var/lib/lli-saas/obituary-intelligence-engine/state.json\"' '${RENDERED_MANIFEST}' 'obituary-engine state path env is missing from rendered manifests'
  assert_in_file 'name: CRM_ADAPTER_BASE_URL\n +value: \"https?://[^\"]+\"' '${RENDERED_MANIFEST}' 'user-portal CRM adapter runtime env is missing'
  assert_in_file 'name: LEAD_ENGINE_BASE_URL\n +value: \"https?://[^\"]+\"' '${RENDERED_MANIFEST}' 'user-portal lead engine runtime env is missing'
  assert_not_in_file 'name: CRM_ADAPTER_BASE_URL\n +value: \"http://localhost[:/][^\"]*\"' '${RENDERED_MANIFEST}' 'user-portal CRM adapter runtime env still points at localhost'
  assert_not_in_file 'name: LEAD_ENGINE_BASE_URL\n +value: \"http://localhost[:/][^\"]*\"' '${RENDERED_MANIFEST}' 'user-portal lead engine runtime env still points at localhost'
  assert_in_file 'name: OBITUARY_ENGINE_BASE_URL\n +value: \"[^\"]+\"' '${RENDERED_MANIFEST}' 'lead-engine obituary engine URL is missing from rendered manifests'
  assert_in_file 'kind: CronJob\nmetadata:\n  name: lead-engine-daily-scan' '${RENDERED_MANIFEST}' 'daily lead scan CronJob is missing from rendered manifests'
  assert_not_in_file 'http://reaper:8080|REAPER_BASE_URL' '${RENDERED_MANIFEST}' 'rendered manifests still contain legacy Reaper runtime wiring'
"

run_step "active architecture guard" bash -lc '
  cd "'"${ROOT_DIR}"'"
  if rg -n "REAPER_BASE_URL|Lead Graph|lead database|row-level multi-tenancy" README.md docs/README.md docs/system-architecture.md docs/developer-onboarding.md docs/pilot-runbook-david-whitaker.md docs/pilot-release-checklist.md .planning/PROJECT.md .planning/STATE.md .planning/ROADMAP.md .planning/REQUIREMENTS.md infra/README.md; then
    echo "ERROR: active docs/planning still contain legacy architecture phrases" >&2
    exit 1
  fi
'

if command -v kubectl >/dev/null 2>&1 && kubectl config current-context >/dev/null 2>&1; then
  run_step "kubectl dry-run validation" kubectl apply --dry-run=client --validate=false -f "${RENDERED_MANIFEST}"
else
  echo
  echo "==> kubectl dry-run validation"
  echo "kubectl not configured with a current context; skipping local manifest dry-run"
fi

echo
echo "Pilot readiness check complete."
