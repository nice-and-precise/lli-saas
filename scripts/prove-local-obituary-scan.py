#!/usr/bin/env python3

from __future__ import annotations

import argparse
import base64
import hashlib
import hmac
from datetime import date, datetime
import json
import os
import re
import socket
import subprocess
import sys
import tempfile
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Any
from urllib.error import URLError
from urllib.request import urlopen

from fastapi.testclient import TestClient


ROOT = Path(__file__).resolve().parents[1]
LEAD_ENGINE_DIR = ROOT / "services" / "lead-engine"
OBITUARY_ENGINE_DIR = ROOT / "services" / "obituary-intelligence-engine"
PROOF_SOURCE_FIXTURE_PATH = ROOT / "infra" / "charts" / "lli-saas" / "files" / "obituary-proof-source.json"
SOURCE_HEALTH_SCRIPT = ROOT / "scripts" / "validate-obituary-sources.py"
AUTH_JWT_SECRET = "proof-jwt-secret"
AUTH_JWT_ISSUER = "lli-saas-pilot"
AUTH_JWT_AUDIENCE = "lli-saas"

os.environ["AUTH_JWT_SECRET"] = AUTH_JWT_SECRET
os.environ["AUTH_JWT_ISSUER"] = AUTH_JWT_ISSUER
os.environ["AUTH_JWT_AUDIENCE"] = AUTH_JWT_AUDIENCE

sys.path.insert(0, str(LEAD_ENGINE_DIR))

from src.app import app as lead_app  # noqa: E402
from src.contracts import Lead, ScanResult  # noqa: E402
from src.obituary_engine import HttpObituaryEngine  # noqa: E402
from src.owner_corpus import OwnerFetchResponse, OwnerRecord  # noqa: E402
from src.scan_service import ScanService, get_scan_service  # noqa: E402


class FixtureCRMAdapterClient:
    def __init__(self, owners: list[dict[str, Any]]) -> None:
        self.owners = [OwnerRecord.model_validate(owner) for owner in owners]
        self.delivered_leads: list[Lead] = []

    def fetch_owner_records(self, *, owner_limit: int, bearer_token: str) -> OwnerFetchResponse:
        tenant_id = "pilot"
        selected = self.owners[:owner_limit]
        return OwnerFetchResponse.model_validate(
            {
                "tenant_id": tenant_id,
                "source_board": {"id": "fixture-board", "name": "Fixture Owners"},
                "owner_count": len(selected),
                "owners": [owner.model_dump(mode="json") for owner in selected],
            }
        )

    def deliver_lead(self, *, lead: Lead, bearer_token: str) -> dict[str, Any]:
        tenant_id = "pilot"
        self.delivered_leads.append(lead)
        return {
            "tenant_id": tenant_id,
            "board_id": "fixture-board",
            "delivery_id": f"fixture-{lead.owner_id}",
            "status": "created",
            "item_id": f"fixture-item-{lead.owner_id}",
            "item_name": f"{lead.deceased_name} - local proof",
        }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run a Monday-free lead-engine -> obituary-engine proof scan.")
    parser.add_argument("--json-output", type=Path)
    parser.add_argument("--lookback-days", type=int, default=30)
    parser.add_argument("--deterministic-only", action="store_true")
    return parser.parse_args()


def find_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def resolve_service_python(service_dir: Path) -> str:
    local_python = service_dir / ".venv" / "bin" / "python"
    if local_python.exists():
        return str(local_python)
    return sys.executable


def build_service_token(*, sub: str = "lead-proof", tenant_id: str = "pilot", role: str = "service") -> str:
    header = {"alg": "HS256", "typ": "JWT"}
    payload = {
        "sub": sub,
        "role": role,
        "tenant_id": tenant_id,
        "aud": AUTH_JWT_AUDIENCE,
        "iss": AUTH_JWT_ISSUER,
        "exp": int(time.time()) + 3600,
    }

    def encode(value: dict[str, Any]) -> str:
        raw = json.dumps(value, separators=(",", ":")).encode("utf-8")
        return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("utf-8")

    header_segment = encode(header)
    payload_segment = encode(payload)
    signature = base64.urlsafe_b64encode(
        hmac.new(AUTH_JWT_SECRET.encode("utf-8"), f"{header_segment}.{payload_segment}".encode("utf-8"), hashlib.sha256).digest()
    ).rstrip(b"=").decode("utf-8")
    return f"{header_segment}.{payload_segment}.{signature}"


def wait_for_http_ok(url: str, *, timeout_seconds: float = 30.0) -> None:
    deadline = time.time() + timeout_seconds
    last_error: Exception | None = None
    while time.time() < deadline:
        try:
            with urlopen(url, timeout=2.0) as response:
                if response.status == 200:
                    return
        except URLError as exc:
            last_error = exc
        except OSError as exc:
            last_error = exc
        time.sleep(0.25)
    raise RuntimeError(f"Timed out waiting for {url}: {last_error}")


@contextmanager
def obituary_server() -> str:
    port = find_free_port()
    state_dir = Path(tempfile.mkdtemp(prefix="obituary-proof-state-"))
    state_path = state_dir / "state.json"
    env = os.environ.copy()
    env["AUTH_JWT_SECRET"] = AUTH_JWT_SECRET
    env["AUTH_JWT_ISSUER"] = AUTH_JWT_ISSUER
    env["AUTH_JWT_AUDIENCE"] = AUTH_JWT_AUDIENCE
    env["OBITUARY_ENGINE_STATE_PATH"] = str(state_path)
    env["OBITUARY_ENGINE_FIXTURE_SOURCE_PATH"] = str(PROOF_SOURCE_FIXTURE_PATH)
    env.pop("GEMINI_API_KEY", None)
    env.pop("GOOGLE_API_KEY", None)
    env.pop("ANTHROPIC_API_KEY", None)
    process = subprocess.Popen(
        [
            resolve_service_python(OBITUARY_ENGINE_DIR),
            "-m",
            "uvicorn",
            "src.app:app",
            "--host",
            "127.0.0.1",
            "--port",
            str(port),
        ],
        cwd=OBITUARY_ENGINE_DIR,
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    base_url = f"http://127.0.0.1:{port}"
    try:
        wait_for_http_ok(f"{base_url}/health")
        yield base_url
    finally:
        process.terminate()
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)


def run_source_health(lookback_days: int) -> dict[str, Any]:
    report_path = Path(tempfile.mkdtemp(prefix="obituary-proof-health-")) / "source-health.json"
    subprocess.run(
        [
            sys.executable,
            str(SOURCE_HEALTH_SCRIPT),
            "--lookback-days",
            str(lookback_days),
            "--json-output",
            str(report_path),
        ],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    return json.loads(report_path.read_text(encoding="utf-8"))


def collect_live_records(source_id: str, lookback_days: int) -> dict[str, Any]:
    code = """
import json
from src.collector import ObituaryCollector

collector = ObituaryCollector(http_timeout_seconds=10.0)
result = collector.collect(source_ids=[SOURCE_ID], lookback_days=LOOKBACK_DAYS)
print(json.dumps({
    "records": [
        {
            "full_name": record.full_name,
            "city": record.city,
            "state": record.state,
            "death_date": record.death_date,
            "published_at": record.published_at,
            "has_survivor_text": record.has_survivor_text,
            "out_of_state_heir_states": record.out_of_state_heir_states,
        }
        for record in result.records
    ],
    "source_reports": [report.__dict__ for report in result.source_reports],
    "errors": [issue.__dict__ for issue in result.errors],
}))
""".replace("SOURCE_ID", repr(source_id)).replace("LOOKBACK_DAYS", str(lookback_days))
    completed = subprocess.run(
        [resolve_service_python(OBITUARY_ENGINE_DIR), "-c", code],
        cwd=OBITUARY_ENGINE_DIR,
        check=True,
        capture_output=True,
        text=True,
        timeout=45,
    )
    return json.loads(completed.stdout)


def normalize_owner_name(full_name: str) -> str:
    without_parentheticals = re.sub(r"\([^)]*\)", " ", full_name)
    without_quotes = without_parentheticals.replace('"', " ")
    tokens = re.findall(r"[A-Za-z][A-Za-z'-]*", without_quotes)
    if len(tokens) < 2:
        return full_name.strip()
    return f"{tokens[0]} {tokens[-1]}"


def build_owner_fixture(record: dict[str, Any], *, owner_id: str) -> dict[str, Any]:
    city = record.get("city") or "Boone"
    state = record.get("state") or "IA"
    owner_name = normalize_owner_name(record["full_name"])
    return {
        "owner_id": owner_id,
        "owner_name": owner_name,
        "county": None,
        "state": state,
        "acres": 160.0,
        "parcel_ids": [f"fixture-parcel-{owner_id}"],
        "mailing_state": state,
        "mailing_city": city,
        "mailing_postal_code": "50036",
        "property_address_line_1": None,
        "property_city": city,
        "property_postal_code": "50036",
        "operator_name": None,
        "crm_source": "fixture",
        "raw_source_ref": f"fixture:{owner_id}",
    }


def parse_optional_date(value: str | None) -> date | None:
    if not value:
        return None
    try:
        return date.fromisoformat(value)
    except ValueError:
        return None


def parse_optional_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def score_live_candidate(record: dict[str, Any]) -> tuple[int, int, int, int]:
    today = date.today()
    death_date = parse_optional_date(record.get("death_date"))
    published_at = parse_optional_datetime(record.get("published_at"))
    has_recent_death_date = 0
    death_date_score = -9999
    if death_date is not None:
        age_days = (today - death_date).days
        if 0 <= age_days <= 366:
            has_recent_death_date = 1
            death_date_score = -age_days

    published_score = 0
    has_published_at = 1 if published_at is not None else 0
    if published_at is not None:
        published_score = -int((datetime.now(published_at.tzinfo) - published_at).total_seconds())

    out_of_state_score = len(record.get("out_of_state_heir_states", []))
    return (has_recent_death_date, has_published_at, out_of_state_score, max(death_date_score, published_score))


def validate_scan_payload(payload: dict[str, Any]) -> ScanResult:
    result = ScanResult.model_validate(payload)
    if not result.source_reports:
        raise RuntimeError("Proof scan returned empty source_reports")
    required_fields = {"scan_id", "status", "owner_count", "lead_count", "delivery_summary", "leads", "source_reports", "errors"}
    missing = sorted(required_fields.difference(payload))
    if missing:
        raise RuntimeError(f"Proof scan payload is missing required fields: {missing}")
    return result


def run_lead_scan(obituary_base_url: str, owners: list[dict[str, Any]], source_ids: list[str], lookback_days: int) -> dict[str, Any]:
    crm_adapter = FixtureCRMAdapterClient(owners)
    service = ScanService(
        crm_adapter_client=crm_adapter,
        obituary_engine=HttpObituaryEngine(base_url=obituary_base_url, timeout_seconds=60.0),
    )
    lead_app.dependency_overrides[get_scan_service] = lambda: service
    client = TestClient(lead_app)
    bearer_token = build_service_token()
    try:
        response = client.post(
            "/run-scan",
            headers={"Authorization": f"Bearer {bearer_token}"},
            json={
                "owner_limit": len(owners),
                "lookback_days": lookback_days,
                "source_ids": source_ids,
            },
        )
    finally:
        lead_app.dependency_overrides.clear()
    payload = response.json()
    return {
        "status_code": response.status_code,
        "scan_result": payload,
        "delivered_lead_count": len(crm_adapter.delivered_leads),
    }


def run_live_proof(obituary_base_url: str, lookback_days: int) -> tuple[dict[str, Any], dict[str, Any]]:
    health = run_source_health(lookback_days)
    healthy_reports = [
        report
        for report in health.get("source_reports", [])
        if report.get("status") == "healthy" and report.get("obituary_count", 0) > 0
    ]
    healthy_reports.sort(
        key=lambda report: (
            -int(report.get("obituary_count", 0)),
            -int(report.get("candidate_count", 0)),
            report.get("source_id", ""),
        )
    )
    healthy_reports = healthy_reports[:3]

    for report in healthy_reports:
        source_id = report["source_id"]
        try:
            collected = collect_live_records(source_id, lookback_days)
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired):
            continue
        candidates = [
            record
            for record in collected.get("records", [])
            if record.get("full_name") and record.get("city") and record.get("state") and record.get("has_survivor_text")
        ]
        candidates.sort(key=score_live_candidate, reverse=True)
        for index, candidate in enumerate(candidates[:3], start=1):
            owner = build_owner_fixture(candidate, owner_id=f"live-{source_id}-{index}")
            attempt = run_lead_scan(obituary_base_url, [owner], [source_id], lookback_days)
            try:
                validated = validate_scan_payload(attempt["scan_result"])
            except Exception as exc:
                attempt["error"] = str(exc)
                continue
            matched = len(validated.leads) > 0
            heirs_present = matched and bool(validated.leads[0].heirs)
            if matched and heirs_present:
                attempt.update(
                    {
                        "status": "proved",
                        "mode": "live",
                        "selected_source_id": source_id,
                        "owner_fixture": owner,
                        "matched_deceased_name": validated.leads[0].deceased_name,
                    }
                )
                return health, attempt
    return health, {"status": "not_proved", "mode": "live", "reason": "No live source produced a matched lead with heirs"}


def run_deterministic_proof(obituary_base_url: str, lookback_days: int) -> dict[str, Any]:
    owner = build_owner_fixture(
        {
            "full_name": "Robert Henderson",
            "city": "Boone",
            "state": "IA",
        },
        owner_id="fixture-proof-1",
    )
    attempt = run_lead_scan(obituary_base_url, [owner], ["fixture_proof"], lookback_days)
    validated = validate_scan_payload(attempt["scan_result"])
    if not validated.leads:
        raise RuntimeError("Deterministic proof returned no matched leads")
    if not validated.leads[0].heirs:
        raise RuntimeError("Deterministic proof returned no heirs")
    attempt.update(
        {
            "status": "proved",
            "mode": "deterministic",
            "selected_source_id": "fixture_proof",
            "owner_fixture": owner,
            "matched_deceased_name": validated.leads[0].deceased_name,
        }
    )
    return attempt


def main() -> int:
    args = parse_args()
    payload: dict[str, Any] = {
        "live_source_health": {"skipped": args.deterministic_only},
        "live_proof": {"status": "skipped" if args.deterministic_only else "pending"},
        "deterministic_proof": {"status": "pending"},
        "final_scan_result": None,
    }

    with obituary_server() as obituary_base_url:
        if not args.deterministic_only:
            live_health, live_proof = run_live_proof(obituary_base_url, args.lookback_days)
            payload["live_source_health"] = live_health
            payload["live_proof"] = live_proof

        deterministic_proof = run_deterministic_proof(obituary_base_url, args.lookback_days)
        payload["deterministic_proof"] = deterministic_proof
        if payload["live_proof"].get("status") == "proved":
            payload["final_scan_result"] = payload["live_proof"]["scan_result"]
        else:
            payload["final_scan_result"] = deterministic_proof["scan_result"]

    rendered = json.dumps(payload, indent=2)
    if args.json_output:
        args.json_output.write_text(rendered, encoding="utf-8")
    print(rendered)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
