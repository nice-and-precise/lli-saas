#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SERVICE_DIR = ROOT / "services" / "obituary-intelligence-engine"
sys.path.insert(0, str(SERVICE_DIR))

from src.collector import ObituaryCollector  # noqa: E402
from src.feed_sources import DEFAULT_PROOF_TARGET_COUNT  # noqa: E402


def env_flag(name: str) -> bool:
    return os.getenv(name, "").strip().lower() in {"1", "true", "yes", "on"}


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate configured obituary sources and emit proof output.")
    parser.add_argument("--lookback-days", type=int, default=30)
    parser.add_argument("--include-supplemental", action="store_true", default=env_flag("PILOT_RELEASE_MODE"))
    parser.add_argument("--json-output", type=Path)
    args = parser.parse_args()

    collector = ObituaryCollector(http_timeout_seconds=15.0)
    result = collector.source_health(
        source_ids=[],
        lookback_days=args.lookback_days,
        include_supplemental=args.include_supplemental,
    )

    payload = {
        "generated_at": result.generated_at,
        "proof_target_count": result.proof_target_count,
        "healthy_source_count": result.healthy_source_count,
        "source_reports": [report.__dict__ for report in result.source_reports],
        "errors": [
            {
                "stage": issue.stage,
                "code": issue.code,
                "message": issue.message,
                "source_id": issue.source_id,
                "details": issue.details or {},
            }
            for issue in result.errors
        ],
    }

    if args.json_output:
        args.json_output.write_text(json.dumps(payload, indent=2), encoding="utf-8")

    print("Source".ljust(28), "Status".ljust(10), "Candidates".ljust(10), "Obits".ljust(8), "Region")
    print("-" * 88)
    for report in result.source_reports:
        print(
            report.source_id.ljust(28),
            report.status.ljust(10),
            str(report.candidate_count).ljust(10),
            str(report.obituary_count).ljust(8),
            report.region or "",
        )
        if report.error_message:
            print(f"  error: {report.error_message}")

    print()
    print(f"Healthy sources: {result.healthy_source_count}/{DEFAULT_PROOF_TARGET_COUNT}")
    if args.json_output:
        print(f"JSON report: {args.json_output}")

    return 0 if result.healthy_source_count >= DEFAULT_PROOF_TARGET_COUNT else 1


if __name__ == "__main__":
    raise SystemExit(main())
