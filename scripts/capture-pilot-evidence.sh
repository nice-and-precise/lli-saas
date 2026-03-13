#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TIMESTAMP="$(date -u +"%Y%m%dT%H%M%SZ")"
EVIDENCE_DIR="${PILOT_EVIDENCE_DIR:-${ROOT_DIR}/artifacts/pilot-release/${TIMESTAMP}}"
RUN_SOURCE_VALIDATION="${RUN_SOURCE_VALIDATION:-1}"
GATE_LOG="${EVIDENCE_DIR}/pilot-readiness.log"
SOURCE_LOG="${EVIDENCE_DIR}/source-validation.log"
SOURCE_JSON="${EVIDENCE_DIR}/obituary-sources.json"
METADATA_FILE="${EVIDENCE_DIR}/metadata.txt"

mkdir -p "${EVIDENCE_DIR}"

{
  echo "generated_at=$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  echo "git_head=$(git -C "${ROOT_DIR}" rev-parse HEAD 2>/dev/null || echo unknown)"
  echo "git_branch=$(git -C "${ROOT_DIR}" rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
  echo "pilot_values_file=${PILOT_VALUES_FILE:-}"
  echo "pilot_release_mode=${PILOT_RELEASE_MODE:-0}"
  echo "run_source_validation=${RUN_SOURCE_VALIDATION}"
} > "${METADATA_FILE}"

echo "Saving pilot release evidence to ${EVIDENCE_DIR}"

(
  cd "${ROOT_DIR}"
  bash scripts/pilot-readiness-check.sh
) 2>&1 | tee "${GATE_LOG}"

if [[ "${RUN_SOURCE_VALIDATION}" == "1" ]]; then
  SOURCE_VALIDATION_ARGS=()
  if [[ "${PILOT_RELEASE_MODE:-0}" == "1" ]]; then
    SOURCE_VALIDATION_ARGS+=(--include-supplemental)
  fi
  (
    cd "${ROOT_DIR}"
    python3 scripts/validate-obituary-sources.py "${SOURCE_VALIDATION_ARGS[@]}" --json-output "${SOURCE_JSON}"
  ) 2>&1 | tee "${SOURCE_LOG}"
else
  printf 'Source validation skipped (RUN_SOURCE_VALIDATION=%s)\n' "${RUN_SOURCE_VALIDATION}" | tee "${SOURCE_LOG}"
fi

if [[ -n "${PILOT_VALUES_FILE:-}" && -f "${PILOT_VALUES_FILE}" ]]; then
  cp "${PILOT_VALUES_FILE}" "${EVIDENCE_DIR}/$(basename "${PILOT_VALUES_FILE}")"
fi

echo "Pilot release evidence captured in ${EVIDENCE_DIR}"
