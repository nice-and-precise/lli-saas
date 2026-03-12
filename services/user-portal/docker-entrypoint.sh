#!/bin/sh

set -eu

cat > /usr/share/nginx/html/runtime-config.js <<EOF
window.__LLI_RUNTIME_CONFIG__ = {
  crmAdapterBaseUrl: "${CRM_ADAPTER_BASE_URL:-}",
  leadEngineBaseUrl: "${LEAD_ENGINE_BASE_URL:-}"
};
EOF

exec nginx -g 'daemon off;'
