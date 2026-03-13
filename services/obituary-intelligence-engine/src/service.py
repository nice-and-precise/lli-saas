from __future__ import annotations

import logging
from functools import lru_cache
from pathlib import Path
from typing import Literal

from src.collector import CollectionResult, ObituaryCollector, ObituaryRecord
from src.contracts import (
    HeirRecord,
    Lead,
    LeadProperty,
    MatchMetadata,
    ObituaryEngineIssue,
    ObituaryEngineRunScanRequest,
    ObituaryEngineScanResult,
    ObituaryMetadata,
    ObituarySourceReport,
    SourceHealthResponse,
)
from src.extractor import HeirExtractor
from src.feed_sources import resolve_sources
from src.logging import get_logger, log_event
from src.matcher import NameMatcher, NicknameIndex
from src.normalization import isoformat_or_none, utcnow
from src.state_store import ObituaryStateStore

LeadTier = Literal["hot", "warm", "pending_review", "low_signal"]


class ObituaryIntelligenceService:
    def __init__(
        self,
        *,
        collector: ObituaryCollector,
        extractor: HeirExtractor,
        matcher: NameMatcher,
        state_store: ObituaryStateStore,
        logger: logging.Logger | None = None,
    ) -> None:
        self.collector = collector
        self.extractor = extractor
        self.matcher = matcher
        self.state_store = state_store
        self.logger = logger or get_logger("obituary-intelligence-engine")

    def run_scan(
        self,
        request: ObituaryEngineRunScanRequest,
        *,
        tenant_id: str | None = None,
    ) -> ObituaryEngineScanResult:
        started_at = utcnow()
        started_at_iso = isoformat_or_none(started_at) or ""
        log_event(
            self.logger,
            logging.INFO,
            "obituary-intelligence-engine",
            "obituary_scan_started",
            scan_id=request.scan_id,
            tenant_id=tenant_id,
            owner_count=len(request.owner_records),
            lookback_days=request.lookback_days,
            reference_date=request.reference_date,
            source_ids=request.source_ids,
        )
        known_fingerprints = self.state_store.known_fingerprints()
        source_ids = request.source_ids or [source.source_id for source in resolve_sources([])]
        raw_collection_result = self.collector.collect(source_ids=source_ids, lookback_days=request.lookback_days)
        if isinstance(raw_collection_result, CollectionResult):
            collection_result = raw_collection_result
        else:
            collection_result = CollectionResult(
                records=list(raw_collection_result),
                source_reports=[],
                errors=[],
                successful_source_ids=source_ids,
            )
        log_event(
            self.logger,
            logging.INFO,
            "obituary-intelligence-engine",
            "obituary_scan_collection_summary",
            scan_id=request.scan_id,
            tenant_id=tenant_id,
            source_count=len(source_ids),
            candidate_count=len(collection_result.records),
            source_report_count=len(collection_result.source_reports),
            error_count=len(collection_result.errors),
            known_fingerprint_count=len(known_fingerprints),
        )
        fresh_obituaries = [
            obituary
            for obituary in collection_result.records
            if obituary.fingerprint not in known_fingerprints
        ]
        leads: list[Lead] = []
        matched_fingerprints: list[str] = []

        for obituary in fresh_obituaries:
            match = self.matcher.match_obituary(obituary, request.owner_records)
            if match is None:
                continue
            matched_fingerprints.append(obituary.fingerprint)

            extraction = None
            if obituary.has_survivor_text:
                extraction = self.extractor.extract(
                    obituary.raw_text,
                    obituary.full_name,
                    request.reference_date,
                )

            heirs = []
            if extraction:
                heirs = [
                    HeirRecord(
                        name=survivor.full_name,
                        relationship=survivor.relationship,
                        location_city=survivor.location_city,
                        location_state=survivor.location_state,
                        out_of_state=bool(survivor.location_state and survivor.location_state != "IA"),
                        executor=survivor.relationship == "executor",
                    )
                    for survivor in extraction.survivors
                ]

            out_of_state_states = sorted(
                {
                    *(state for state in obituary.out_of_state_heir_states if state),
                    *(heir.location_state for heir in heirs if heir.out_of_state and heir.location_state),
                }
            )
            out_of_state_heir_likely = bool(out_of_state_states)

            tier = self._resolve_tier(match.score, heirs, out_of_state_heir_likely)
            notes = [
                f"Matched obituary source {obituary.source_label}.",
                (
                    "Weighted match score "
                    f"{match.score} with last name {match.last_name_score} "
                    f"and first name {match.first_name_score}."
                ),
            ]
            if obituary.out_of_state_heir_evidence:
                notes.append(f"Out-of-state survivor signal: {obituary.out_of_state_heir_evidence}")

            completed_at = isoformat_or_none(utcnow()) or ""
            lead = Lead(
                scan_id=request.scan_id,
                source="obituary_intelligence_engine",
                run_started_at=started_at_iso,
                run_completed_at=completed_at,
                owner_id=match.owner_record.owner_id,
                owner_name=match.owner_record.owner_name,
                deceased_name=extraction.deceased_name if extraction else obituary.full_name,
                property=LeadProperty(
                    county=match.owner_record.county,
                    state=match.owner_record.state,
                    acres=match.owner_record.acres,
                    parcel_ids=match.owner_record.parcel_ids,
                    address_line_1=match.owner_record.property_address_line_1,
                    city=match.owner_record.property_city,
                    postal_code=match.owner_record.property_postal_code,
                    operator_name=match.owner_record.operator_name,
                ),
                heirs=heirs,
                obituary=ObituaryMetadata(
                    url=obituary.obituary_url,
                    source_id=obituary.source_id,
                    published_at=obituary.published_at,
                    death_date=obituary.death_date,
                    deceased_city=obituary.city,
                    deceased_state=obituary.state,
                ),
                match=MatchMetadata(
                    score=match.score,
                    last_name_score=match.last_name_score,
                    first_name_score=match.first_name_score,
                    location_bonus_applied=match.location_bonus_applied,
                    status=match.status,
                ),
                tier=tier,
                out_of_state_heir_likely=out_of_state_heir_likely,
                out_of_state_states=out_of_state_states,
                executor_mentioned=bool(extraction and extraction.executor_mentioned),
                unexpected_death=bool(extraction and extraction.unexpected_death),
                notes=notes,
                tags=self._build_tags(tier, obituary, match.status, out_of_state_heir_likely),
                raw_artifacts=[
                    f"obituary:{obituary.obituary_url}",
                    f"source:{obituary.source_id}",
                    f"owner:{match.owner_record.raw_source_ref or match.owner_record.owner_id}",
                ],
            )
            leads.append(lead)

        processed_at = isoformat_or_none(utcnow())
        processed_at = processed_at or ""
        self.state_store.record_scan(
            source_ids=collection_result.successful_source_ids,
            fingerprints=matched_fingerprints,
            processed_at=processed_at,
        )
        completed_at = isoformat_or_none(utcnow()) or ""
        for lead in leads:
            lead.run_completed_at = completed_at

        log_event(
            self.logger,
            logging.INFO,
            "obituary-intelligence-engine",
            "obituary_scan_completed",
            scan_id=request.scan_id,
            tenant_id=tenant_id,
            lead_count=len(leads),
            matched_fingerprint_count=len(matched_fingerprints),
            skipped_known_count=len(collection_result.records) - len(fresh_obituaries),
            source_report_count=len(collection_result.source_reports),
            error_count=len(collection_result.errors),
        )

        return ObituaryEngineScanResult(
            source="obituary_intelligence_engine",
            run_started_at=started_at_iso,
            run_completed_at=completed_at,
            leads=leads,
            source_reports=[
                ObituarySourceReport.model_validate(report.__dict__) for report in collection_result.source_reports
            ],
            errors=[
                ObituaryEngineIssue.model_validate(
                    {
                        "stage": issue.stage,
                        "code": issue.code,
                        "message": issue.message,
                        "source_id": issue.source_id,
                        "details": issue.details or {},
                    }
                )
                for issue in collection_result.errors
            ],
        )

    def source_health(
        self,
        *,
        source_ids: list[str] | None = None,
        lookback_days: int = 30,
        include_supplemental: bool = False,
    ) -> SourceHealthResponse:
        health_result = self.collector.source_health(
            source_ids=source_ids or [],
            lookback_days=lookback_days,
            include_supplemental=include_supplemental,
        )
        return SourceHealthResponse(
            generated_at=health_result.generated_at,
            proof_target_count=health_result.proof_target_count,
            healthy_source_count=health_result.healthy_source_count,
            source_reports=[
                ObituarySourceReport.model_validate(report.__dict__) for report in health_result.source_reports
            ],
            errors=[
                ObituaryEngineIssue.model_validate(
                    {
                        "stage": issue.stage,
                        "code": issue.code,
                        "message": issue.message,
                        "source_id": issue.source_id,
                        "details": issue.details or {},
                    }
                )
                for issue in health_result.errors
            ],
        )

    def _build_tags(
        self,
        tier: LeadTier,
        obituary: ObituaryRecord,
        match_status: str,
        out_of_state_heir_likely: bool,
    ) -> list[str]:
        tags = [f"tier:{tier}", f"source:{obituary.source_id}", f"match:{match_status}"]
        if out_of_state_heir_likely:
            tags.append("signal:out_of_state_heir")
        if not obituary.has_survivor_text:
            tags.append("signal:stub_obituary")
        return tags

    def _resolve_tier(
        self,
        score: float,
        heirs: list[HeirRecord],
        out_of_state_heir_likely: bool,
    ) -> LeadTier:
        if not heirs:
            return "low_signal"
        if score >= 95:
            return "hot" if out_of_state_heir_likely else "warm"
        return "pending_review" if score >= 85 else "low_signal"


@lru_cache(maxsize=1)
def get_service() -> ObituaryIntelligenceService:
    nickname_path = Path(__file__).resolve().parent.parent / "nicknames.csv"
    return ObituaryIntelligenceService(
        collector=ObituaryCollector(),
        extractor=HeirExtractor(),
        matcher=NameMatcher(NicknameIndex(nickname_path)),
        state_store=ObituaryStateStore(),
    )
