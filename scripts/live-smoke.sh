#!/usr/bin/env bash
# Live smoke test for the deployed Vercel pilot. Read-only by default (safe to run
# anytime); pass --write to also exercise the write paths (idempotent re-provision +
# a bounded scan). Exits non-zero on the first failed assertion.
#
#   scripts/live-smoke.sh            # read-only checks
#   scripts/live-smoke.sh --write    # + idempotent provision re-run + a scan
#
# Override hosts via env: PORTAL/CRM/LEAD/OBIT (default *.jordandamhof.com).

set -uo pipefail

PORTAL="${PORTAL:-https://lli.jordandamhof.com}"
CRM="${CRM:-https://crm.jordandamhof.com}"
LEAD="${LEAD:-https://lead.jordandamhof.com}"
OBIT="${OBIT:-https://obit.jordandamhof.com}"
WRITE=0
[ "${1:-}" = "--write" ] && WRITE=1

fail=0
pass() { echo "  ✓ $1"; }
bad()  { echo "  ✗ $1" >&2; fail=1; }

code() { curl -s -o /dev/null -w "%{http_code}" "$1"; }

echo "== 1. Service health (all 200) =="
for pair in "portal|$PORTAL/" "obit|$OBIT/health" "lead|$LEAD/health" "crm|$CRM/health"; do
  name="${pair%%|*}"; url="${pair##*|}"; c="$(code "$url")"
  [ "$c" = "200" ] && pass "$name $c" || bad "$name returned $c (expected 200)"
done

echo "== 2. Readiness chain (lead /ready proves lead→obit wiring) =="
for pair in "lead|$LEAD/ready" "crm|$CRM/ready" "obit|$OBIT/ready"; do
  name="${pair%%|*}"; url="${pair##*|}"; c="$(code "$url")"
  [ "$c" = "200" ] && pass "$name ready" || bad "$name /ready returned $c"
done

echo "== 3. crm /status shape (auto-onboarding state) =="
curl -s "$CRM/status" | python3 -c "
import sys,json
d=json.load(sys.stdin)
def chk(cond,msg): print(('  ✓ ' if cond else '  ✗ ')+msg); sys.exit(0) if cond else None
ok=True
for cond,msg in [
  ('token_present' in d, 'status exposes token_present'),
  (isinstance(d.get('onboarding'),dict) and 'auto_provisioned_at' in d['onboarding'], 'status exposes onboarding.auto_provisioned_at'),
  ('source_board' in d, 'status exposes source_board'),
]:
  print(('  ✓ ' if cond else '  ✗ ')+msg); ok = ok and cond
print('  · source:', (d.get('source_board') or {}).get('name'), '| dest:', (d.get('board') or {}).get('name'), '| provisioned:', bool((d.get('onboarding') or {}).get('auto_provisioned_at')))
sys.exit(0 if ok else 1)
" || bad "status shape check failed"

echo "== 4. /boards reachable, no duplicate 'Land Legacy Leads' =="
curl -s "$CRM/boards" | python3 -c "
import sys,json
ns=[b['name'] for b in json.load(sys.stdin).get('boards',[])]
n=ns.count('Land Legacy Leads')
print('  · boards:', ns)
print(('  ✓ ' if n<=1 else '  ✗ ')+f'Land Legacy Leads count={n} (must be <=1)')
sys.exit(0 if n<=1 else 1)
" || bad "boards duplicate check failed"

echo "== 5. /metrics surface =="
curl -s "$LEAD/metrics" | python3 -c "
import sys,json
d=json.load(sys.stdin); t=d.get('totals',{})
ok = all(k in t for k in ('days_tracked','obituaries','leads_delivered'))
print(('  ✓ ' if ok else '  ✗ ')+f'metrics totals: {t}')
sys.exit(0 if ok else 1)
" || bad "metrics shape check failed"

echo "== 6. new endpoints exist (not 404) =="
for ep in "/boards/select-source" "/boards/auto-provision-destination" "/onboard/auto-provision"; do
  c="$(curl -s -o /dev/null -w '%{http_code}' -X POST "$CRM$ep" -H 'Content-Type: application/json' -d '{}')"
  # 200/400/409 are all "exists"; 404 means the route is missing.
  [ "$c" != "404" ] && pass "$ep ($c)" || bad "$ep is 404 (missing)"
done

if [ "$WRITE" = "1" ]; then
  echo "== 7. (write) auto-provision is idempotent =="
  curl -s -X POST "$CRM/onboard/auto-provision" | python3 -c "
import sys,json
d=json.load(sys.stdin)
ok = bool(d.get('already_provisioned') or d.get('auto_provisioned'))
print(('  ✓ ' if ok else '  ✗ ')+f'auto-provision ok (already={d.get(\"already_provisioned\")} board={(d.get(\"board\") or {}).get(\"name\")})')
sys.exit(0 if ok else 1)
" || bad "auto-provision re-run failed"

  echo "== 8. (write) scan completes, delivery path healthy =="
  curl -s -X POST "$LEAD/run-scan" -H 'Content-Type: application/json' -d '{"owner_limit":5,"lookback_days":7}' | python3 -c "
import sys,json
d=json.load(sys.stdin)
ok = d.get('status') in ('completed','partial') and not d.get('errors')
print(('  ✓ ' if ok else '  ✗ ')+f\"scan status={d.get('status')} owners={d.get('owner_count')} leads={d.get('lead_count')} delivery={d.get('delivery_summary')} errors={[e.get('code') for e in d.get('errors',[])]}\")
sys.exit(0 if ok else 1)
" || bad "scan check failed"
fi

echo
if [ "$fail" = "0" ]; then echo "✅ live smoke PASSED"; else echo "❌ live smoke FAILED"; fi
exit "$fail"
