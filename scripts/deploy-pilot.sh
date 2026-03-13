#!/usr/bin/env bash

set -euo pipefail

export PATH=$(pwd)/scripts:$PATH

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CHART_PATH="${ROOT_DIR}/infra/charts/lli-saas"
RELEASE_NAME="lli-saas"
NAMESPACE="lli-saas-pilot"
VALUES_FILE="${ROOT_DIR}/infra/charts/lli-saas/values.pilot.yaml"
ENV_FILE="${ROOT_DIR}/infra/.env"
TIMEOUT="10m"
DRY_RUN="0"
KUBE_CONTEXT=""

usage() {
  cat <<'EOF'
Usage: bash scripts/deploy-pilot.sh [options]

Options:
  --release NAME       Helm release name (default: lli-saas)
  --namespace NAME     Kubernetes namespace (default: lli-saas-pilot)
  --values PATH        Release values file (default: infra/charts/lli-saas/values.pilot.yaml)
  --env-file PATH      Secret env file (default: infra/.env)
  --context NAME       kubectl/helm context to use
  --timeout DURATION   Helm wait timeout (default: 10m)
  --dry-run            Run helm in dry-run mode after applying secrets
  --help               Show this help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --release)
      RELEASE_NAME="$2"
      shift 2
      ;;
    --namespace)
      NAMESPACE="$2"
      shift 2
      ;;
    --values)
      VALUES_FILE="$2"
      shift 2
      ;;
    --env-file)
      ENV_FILE="$2"
      shift 2
      ;;
    --context)
      KUBE_CONTEXT="$2"
      shift 2
      ;;
    --timeout)
      TIMEOUT="$2"
      shift 2
      ;;
    --dry-run)
      DRY_RUN="1"
      shift
      ;;
    --help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

for command in helm kubectl; do
  if ! command -v "${command}" >/dev/null 2>&1; then
    echo "Missing required command: ${command}" >&2
    exit 1
  fi
done

if [[ ! -f "${VALUES_FILE}" ]]; then
  echo "Values file not found: ${VALUES_FILE}" >&2
  exit 1
fi

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Env file not found: ${ENV_FILE}" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "${ENV_FILE}"
set +a

required_vars=(
  CRM_ADAPTER_PUBLIC_URL
  LEAD_ENGINE_PUBLIC_URL
  PORTAL_PUBLIC_URL
  MONDAY_CLIENT_ID
  MONDAY_CLIENT_SECRET
  MONDAY_REDIRECT_URI
  AUTH_JWT_SECRET
  AUTH_ALLOWED_ORIGINS
  OPERATOR_EMAIL
  OPERATOR_PASSWORD
  OPERATOR_TENANT_ID
  OPERATOR_PORTAL_BASE_URL
  LEAD_ENGINE_CRON_JWT
)

for var_name in "${required_vars[@]}"; do
  if [[ -z "${!var_name:-}" ]]; then
    echo "Required env var is missing or empty: ${var_name}" >&2
    exit 1
  fi
done

if [[ -z "${GEMINI_API_KEY:-}" && -z "${GOOGLE_API_KEY:-}" && -z "${ANTHROPIC_API_KEY:-}" ]]; then
  echo "Set at least one obituary provider key in ${ENV_FILE}" >&2
  exit 1
fi

KUBECTL_ARGS=()
HELM_ARGS=()
if [[ -n "${KUBE_CONTEXT}" ]]; then
  KUBECTL_ARGS+=(--context "${KUBE_CONTEXT}")
  HELM_ARGS+=(--kube-context "${KUBE_CONTEXT}")
fi

provider_secret_args=()
if [[ -n "${GEMINI_API_KEY:-}" ]]; then
  provider_secret_args+=(--from-literal=GEMINI_API_KEY="${GEMINI_API_KEY}")
fi
if [[ -n "${GOOGLE_API_KEY:-}" ]]; then
  provider_secret_args+=(--from-literal=GOOGLE_API_KEY="${GOOGLE_API_KEY}")
fi
if [[ -n "${ANTHROPIC_API_KEY:-}" ]]; then
  provider_secret_args+=(--from-literal=ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY}")
fi

run_kubectl() {
  local args=(kubectl)

  if [[ ${#KUBECTL_ARGS[@]} -gt 0 ]]; then
    args+=("${KUBECTL_ARGS[@]}")
  fi

  args+=("$@")
  "${args[@]}"
}

run_helm() {
  local args=(helm)

  if [[ ${#HELM_ARGS[@]} -gt 0 ]]; then
    args+=("${HELM_ARGS[@]}")
  fi

  args+=("$@")
  "${args[@]}"
}

run_kubectl create namespace "${NAMESPACE}" --dry-run=client -o yaml | run_kubectl apply -f -

if [[ -n "${GHCR_TOKEN:-}" && -n "${GHCR_USER:-}" ]]; then
  run_kubectl -n "${NAMESPACE}" create secret docker-registry ghcr-pull \
    --docker-server=ghcr.io \
    --docker-username="${GHCR_USER}" \
    --docker-password="${GHCR_TOKEN}" \
    --dry-run=client -o yaml | run_kubectl apply -f -
fi

run_kubectl -n "${NAMESPACE}" create secret generic lli-saas-shared-auth \
  --from-literal=AUTH_JWT_SECRET="${AUTH_JWT_SECRET}" \
  --dry-run=client -o yaml | run_kubectl apply -f -

run_kubectl -n "${NAMESPACE}" create secret generic lli-saas-crm-adapter-secrets \
  --from-literal=MONDAY_CLIENT_ID="${MONDAY_CLIENT_ID}" \
  --from-literal=MONDAY_CLIENT_SECRET="${MONDAY_CLIENT_SECRET}" \
  --from-literal=OPERATOR_EMAIL="${OPERATOR_EMAIL}" \
  --from-literal=OPERATOR_PASSWORD="${OPERATOR_PASSWORD}" \
  --dry-run=client -o yaml | run_kubectl apply -f -

run_kubectl -n "${NAMESPACE}" create secret generic lli-saas-obituary-provider-secrets \
  "${provider_secret_args[@]}" \
  --dry-run=client -o yaml | run_kubectl apply -f -

run_kubectl -n "${NAMESPACE}" create secret generic lli-saas-lead-engine-cron \
  --from-literal=LEAD_ENGINE_CRON_JWT="${LEAD_ENGINE_CRON_JWT}" \
  --dry-run=client -o yaml | run_kubectl apply -f -

helm_command=(
  upgrade --install "${RELEASE_NAME}" "${CHART_PATH}"
  --namespace "${NAMESPACE}"
  --create-namespace
  --values "${VALUES_FILE}"
  --wait
  --timeout "${TIMEOUT}"
  --atomic
  --set-string services.leadEngine.env.AUTH_ALLOWED_ORIGINS="${AUTH_ALLOWED_ORIGINS}"
  --set-string services.obituaryIntelligenceEngine.env.AUTH_ALLOWED_ORIGINS="${AUTH_ALLOWED_ORIGINS}"
  --set-string services.crmAdapter.env.MONDAY_REDIRECT_URI="${MONDAY_REDIRECT_URI}"
  --set-string services.crmAdapter.env.AUTH_ALLOWED_ORIGINS="${AUTH_ALLOWED_ORIGINS}"
  --set-string services.crmAdapter.env.OPERATOR_TENANT_ID="${OPERATOR_TENANT_ID}"
  --set-string services.crmAdapter.env.OPERATOR_PORTAL_BASE_URL="${OPERATOR_PORTAL_BASE_URL}"
  --set-string services.userPortal.env.CRM_ADAPTER_BASE_URL="${CRM_ADAPTER_PUBLIC_URL}"
  --set-string services.userPortal.env.LEAD_ENGINE_BASE_URL="${LEAD_ENGINE_PUBLIC_URL}"
  --set validatePlaceholders=true
)

if [[ "${DRY_RUN}" == "1" ]]; then
  helm_command+=(--dry-run --debug)
fi

run_helm "${helm_command[@]}"

echo
echo "Release ${RELEASE_NAME} applied to namespace ${NAMESPACE}."
kubectl_context_args="${KUBECTL_ARGS[*]:-}"
helm_context_args="${HELM_ARGS[*]:-}"
echo "Next checks:"
echo "  kubectl ${kubectl_context_args} -n ${NAMESPACE} get pods"
echo "  helm ${helm_context_args} status ${RELEASE_NAME} -n ${NAMESPACE}"