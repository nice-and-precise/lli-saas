#!/usr/bin/env bash

set -euo pipefail

RELEASE_NAME="lli-saas"
NAMESPACE="lli-saas-pilot"
REVISION=""
KUBE_CONTEXT=""

usage() {
  cat <<'EOF'
Usage: bash scripts/rollback-pilot.sh --revision N [options]

Options:
  --revision N         Helm revision to roll back to
  --release NAME       Helm release name (default: lli-saas)
  --namespace NAME     Kubernetes namespace (default: lli-saas-pilot)
  --context NAME       kubectl/helm context to use
  --help               Show this help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --revision)
      REVISION="$2"
      shift 2
      ;;
    --release)
      RELEASE_NAME="$2"
      shift 2
      ;;
    --namespace)
      NAMESPACE="$2"
      shift 2
      ;;
    --context)
      KUBE_CONTEXT="$2"
      shift 2
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

if [[ -z "${REVISION}" ]]; then
  echo "A --revision value is required." >&2
  usage >&2
  exit 1
fi

for command in helm kubectl; do
  if ! command -v "${command}" >/dev/null 2>&1; then
    echo "Missing required command: ${command}" >&2
    exit 1
  fi
done

HELM_ARGS=()
KUBECTL_ARGS=()
if [[ -n "${KUBE_CONTEXT}" ]]; then
  HELM_ARGS+=(--kube-context "${KUBE_CONTEXT}")
  KUBECTL_ARGS+=(--context "${KUBE_CONTEXT}")
fi

run_helm() {
  local args=(helm)

  if [[ ${#HELM_ARGS[@]} -gt 0 ]]; then
    args+=("${HELM_ARGS[@]}")
  fi

  args+=("$@")
  "${args[@]}"
}

run_helm rollback "${RELEASE_NAME}" "${REVISION}" --namespace "${NAMESPACE}" --wait

echo
echo "Rolled back ${RELEASE_NAME} in namespace ${NAMESPACE} to revision ${REVISION}."
echo "Verify:"
echo "  helm ${HELM_ARGS[*]} history ${RELEASE_NAME} -n ${NAMESPACE}"
echo "  kubectl ${KUBECTL_ARGS[*]} -n ${NAMESPACE} get pods"
