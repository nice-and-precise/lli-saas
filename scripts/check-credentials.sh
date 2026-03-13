#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

ENV_FILES=(
  "services/lead-engine/.env"
  "services/obituary-intelligence-engine/.env"
  "services/crm-adapter/.env"
  "services/user-portal/.env"
)

PRESENT_KEYS=$'\n'
NONEMPTY_KEYS=$'\n'

required_vars() {
  case "$1" in
    "services/lead-engine/.env")
      echo "CRM_ADAPTER_BASE_URL OBITUARY_ENGINE_BASE_URL"
      ;;
    "services/obituary-intelligence-engine/.env")
      echo "OBITUARY_ENGINE_STATE_PATH OBITUARY_ENGINE_RETENTION_DAYS OBITUARY_HTTP_TIMEOUT_SECONDS HEIR_EXTRACTION_PRIMARY_PROVIDER HEIR_EXTRACTION_PRIMARY_MODEL HEIR_EXTRACTION_FALLBACK_PROVIDER HEIR_EXTRACTION_FALLBACK_MODEL HEIR_EXTRACTION_FINAL_PROVIDER HEIR_EXTRACTION_FINAL_MODEL"
      ;;
    "services/crm-adapter/.env")
      echo "MONDAY_CLIENT_ID MONDAY_CLIENT_SECRET MONDAY_REDIRECT_URI"
      ;;
    "services/user-portal/.env")
      echo "VITE_CRM_ADAPTER_BASE_URL VITE_LEAD_ENGINE_BASE_URL"
      ;;
  esac
}

optional_vars() {
  case "$1" in
    "services/lead-engine/.env")
      echo "PORT"
      ;;
    "services/obituary-intelligence-engine/.env")
      echo "GEMINI_API_KEY GOOGLE_API_KEY ANTHROPIC_API_KEY"
      ;;
    "services/crm-adapter/.env")
      echo "MONDAY_API_BASE_URL CRM_ADAPTER_STATE_PATH PORT"
      ;;
    "services/user-portal/.env")
      echo ""
      ;;
  esac
}

mark_present() {
  PRESENT_KEYS+="$1"$'\n'
}

mark_nonempty() {
  NONEMPTY_KEYS+="$1"$'\n'
}

is_present() {
  [[ "$PRESENT_KEYS" == *$'\n'"$1"$'\n'* ]]
}

is_nonempty() {
  [[ "$NONEMPTY_KEYS" == *$'\n'"$1"$'\n'* ]]
}

parse_env_file() {
  local file="$1"

  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line#"${line%%[![:space:]]*}"}"
    [[ -z "$line" || "${line:0:1}" == "#" ]] && continue
    [[ "$line" != *=* ]] && continue

    local key="${line%%=*}"
    local value="${line#*=}"
    key="${key%"${key##*[![:space:]]}"}"

    mark_present "$file:$key"
    if [[ -n "$value" ]]; then
      mark_nonempty "$file:$key"
    fi
  done <"$ROOT_DIR/$file"
}

for env_file in "${ENV_FILES[@]}"; do
  if [[ -f "$ROOT_DIR/$env_file" ]]; then
    parse_env_file "$env_file"
  fi
done

echo "Credential and env audit"
echo "Repo: $ROOT_DIR"
echo

missing_files=0
missing_required=0
missing_provider_key=0

for env_file in "${ENV_FILES[@]}"; do
  echo "$env_file"

  if [[ ! -f "$ROOT_DIR/$env_file" ]]; then
    echo "  status: missing file"
    missing_files=1
    echo
    continue
  fi

  echo "  status: present"

  for key in $(required_vars "$env_file"); do
    if is_nonempty "$env_file:$key"; then
      echo "  [set] $key"
    elif is_present "$env_file:$key"; then
      echo "  [empty] $key"
      missing_required=1
    else
      echo "  [missing] $key"
      missing_required=1
    fi
  done

  if [[ -n "$(optional_vars "$env_file")" ]]; then
    echo "  optional:"
    for key in $(optional_vars "$env_file"); do
      if is_nonempty "$env_file:$key"; then
        echo "    [set] $key"
      elif is_present "$env_file:$key"; then
        echo "    [empty] $key"
      else
        echo "    [missing] $key"
      fi
    done
  fi

  echo
done

if [[ -f "$ROOT_DIR/services/obituary-intelligence-engine/.env" ]]; then
  gemini_present=0
  anthropic_present=0

  if is_nonempty "services/obituary-intelligence-engine/.env:GEMINI_API_KEY" || is_nonempty "services/obituary-intelligence-engine/.env:GOOGLE_API_KEY"; then
    gemini_present=1
  fi

  if is_nonempty "services/obituary-intelligence-engine/.env:ANTHROPIC_API_KEY"; then
    anthropic_present=1
  fi

  echo "LLM provider status"
  if [[ "$gemini_present" -eq 1 ]]; then
    echo "  [set] Gemini-compatible key"
  else
    echo "  [missing] Gemini-compatible key"
    missing_provider_key=1
  fi

  if [[ "$anthropic_present" -eq 1 ]]; then
    echo "  [set] Anthropic fallback key"
  else
    echo "  [optional] Anthropic fallback key"
  fi
  echo
fi

echo "Current repo-specific gaps"
if [[ ! -f "$ROOT_DIR/services/obituary-intelligence-engine/.env" ]]; then
  echo "  - Create services/obituary-intelligence-engine/.env from .env.example"
fi

if [[ -f "$ROOT_DIR/services/lead-engine/.env" ]]; then
  if is_present "services/lead-engine/.env:REAPER_BASE_URL"; then
    echo "  - Remove legacy REAPER_BASE_URL from services/lead-engine/.env"
  fi
  if ! is_nonempty "services/lead-engine/.env:CRM_ADAPTER_BASE_URL"; then
    echo "  - Set CRM_ADAPTER_BASE_URL in services/lead-engine/.env"
  fi
  if ! is_nonempty "services/lead-engine/.env:OBITUARY_ENGINE_BASE_URL"; then
    echo "  - Set OBITUARY_ENGINE_BASE_URL in services/lead-engine/.env"
  fi
fi

if [[ -f "$ROOT_DIR/services/user-portal/.env" ]]; then
  if ! is_nonempty "services/user-portal/.env:VITE_LEAD_ENGINE_BASE_URL"; then
    echo "  - Set VITE_LEAD_ENGINE_BASE_URL in services/user-portal/.env"
  fi
fi

if [[ -f "$ROOT_DIR/services/crm-adapter/.env" ]]; then
  if ! is_nonempty "services/crm-adapter/.env:CRM_ADAPTER_STATE_PATH"; then
    echo "  - Consider setting CRM_ADAPTER_STATE_PATH for stable local state"
  fi
fi
echo

if [[ "$missing_files" -eq 0 && "$missing_required" -eq 0 && "$missing_provider_key" -eq 0 ]]; then
  echo "Result: required env is in place."
  exit 0
fi

echo "Result: setup is incomplete."
exit 1
