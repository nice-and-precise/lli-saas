from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from src.collector import ObituaryCollector
from src.contracts import (
    HeirRecord,
    Lead,
    LeadProperty,
    MatchMetadata,
    ObituaryEngineRunScanRequest,
    OwnerRecord,
    ObituaryEngineScanResult,
    ObituaryMetadata,
)
from src.extractor import HeirExtractor
from src.feed_sources import resolve_sources
from src.matcher import NameMatcher, NicknameIndex
from src.normalization import isoformat_or_none, utcnow
from src.state_store import ObituaryStateStore


class ObituaryIntelligenceService:
    def __init__(
        self,
        *,
        collector: ObituaryCollector,
        extractor: HeirExtractor,
        matcher: NameMatcher,
        state_store: ObituaryStateStore,
    ) -> None:
        self.collector = collector
        self.extractor = extractor
        self.matcher = matcher
        self.state_store = state_store

    def run_scan(self, request: ObituaryEngineRunScanRequest) -> ObituaryEngineScanResult:
        started_at = utcnow()
        known_fingerprints = self.state_store.known_fingerprints()
        source_ids = request.source_ids or [source.source_id for source in resolve_sources([])]
        obituaries = self.collector.collect(source_ids=source_ids, lookback_days=request.lookback_days)
        fresh_obituaries = [obituary for obituary in obituaries if obituary.fingerprint not in known_fingerprints]
        leads: list[Lead] = []

        for obituary in fresh_obituaries:
            match = self.matcher.match_obituary(obituary, request.owner_records)
            if match is None:
                continue

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
                    f"Weighted match score {match.score} "
                    f"({match.confidence_band or 'unbanded'}) with last name {match.last_name_score} "
                    f"and first name {match.first_name_score}."
                ),
            ]
            if obituary.out_of_state_heir_evidence:
                notes.append(f"Out-of-state survivor signal: {obituary.out_of_state_heir_evidence}")

            lead = Lead(
                scan_id=request.scan_id,
                source="obituary_intelligence_engine",
                run_started_at=isoformat_or_none(started_at),
                run_completed_at=isoformat_or_none(utcnow()),
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
                    confidence_band=match.confidence_band,
                    matched_fields=match.matched_fields,
                    explanation=match.explanation,
                    explanation_details=match.explanation_details,
                    nickname_match=match.nickname_match,
                    discrepancies=match.discrepancies,
                    geographic_proximity=match.geographic_proximity,
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
                owner_profile_url=self._build_owner_profile_url(match.owner_record),
                obituary_raw_url=obituary.obituary_url,
            )
            leads.append(lead)

        processed_at = isoformat_or_none(utcnow())
        self.state_store.record_scan(
            source_ids=source_ids,
            fingerprints=[obituary.fingerprint for obituary in fresh_obituaries],
            processed_at=processed_at,
        )
        completed_at = isoformat_or_none(utcnow())
        for lead in leads:
            lead.run_completed_at = completed_at

        return ObituaryEngineScanResult(
            source="obituary_intelligence_engine",
            run_started_at=isoformat_or_none(started_at),
            run_completed_at=completed_at,
            leads=leads,
        )

    def _build_tags(self, tier: str, obituary, match_status: str, out_of_state_heir_likely: bool) -> list[str]:
        tags = [f"tier:{tier}", f"source:{obituary.source_id}", f"match:{match_status}"]
        if out_of_state_heir_likely:
            tags.append("signal:out_of_state_heir")
        if not obituary.has_survivor_text:
            tags.append("signal:stub_obituary")
        return tags

    def _resolve_tier(self, score: float, heirs: list[HeirRecord], out_of_state_heir_likely: bool) -> str:
        if not heirs:
            return "low_signal"
        if score >= 95:
            return "hot" if out_of_state_heir_likely else "warm"
        return "pending_review" if score >= 85 else "low_signal"

    def _build_owner_profile_url(self, owner_record: OwnerRecord) -> str | None:
        if owner_record.raw_source_ref:
            return f"lli://owner-profile/{owner_record.raw_source_ref}"
        if owner_record.owner_id:
            return f"lli://owner-profile/{owner_record.owner_id}"
        return None


@lru_cache(maxsize=1)
def get_service() -> ObituaryIntelligenceService:
    nickname_path = Path(__file__).resolve().parent.parent / "nicknames.csv"
    return ObituaryIntelligenceService(
        collector=ObituaryCollector(),
        extractor=HeirExtractor(),
        matcher=NameMatcher(NicknameIndex(nickname_path)),
        state_store=ObituaryStateStore(),
    )
