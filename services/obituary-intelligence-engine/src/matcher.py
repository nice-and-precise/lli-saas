from __future__ import annotations

import csv
from pathlib import Path

from nameparser import HumanName
from rapidfuzz import fuzz

from src.collector import ObituaryRecord
from src.contracts import OwnerRecord


class MatchCandidate:
    def __init__(
        self,
        *,
        owner_record: OwnerRecord,
        score: float,
        last_name_score: float,
        first_name_score: float,
        location_bonus_applied: bool,
        status: str,
        matched_fields: list[str],
        explanation: list[str],
    ) -> None:
        self.owner_record = owner_record
        self.score = score
        self.last_name_score = last_name_score
        self.first_name_score = first_name_score
        self.location_bonus_applied = location_bonus_applied
        self.status = status
        self.matched_fields = matched_fields
        self.explanation = explanation


def _normalize_name_token(value: str | None) -> str:
    return "".join(ch for ch in (value or "").lower() if ch.isalpha() or ch.isspace()).strip()


class NicknameIndex:
    def __init__(self, csv_path: Path) -> None:
        self.lookup: dict[str, set[str]] = {}
        with csv_path.open("r", encoding="utf-8") as handle:
            reader = csv.DictReader(handle)
            for row in reader:
                canonical = _normalize_name_token(row["canonical"])
                names = {canonical}
                names.update({_normalize_name_token(part) for part in row["nicknames"].split(",") if part.strip()})
                for name in names:
                    self.lookup.setdefault(name, set()).update(names)

    def expand(self, value: str | None) -> set[str]:
        normalized = _normalize_name_token(value)
        return self.lookup.get(normalized, {normalized} if normalized else {""})


class NameMatcher:
    def __init__(self, nickname_index: NicknameIndex) -> None:
        self.nickname_index = nickname_index

    def match_obituary(self, obituary: ObituaryRecord, owner_records: list[OwnerRecord]) -> MatchCandidate | None:
        obituary_name = HumanName(obituary.full_name)
        obituary_first = obituary_name.first
        obituary_last = obituary_name.last

        best: MatchCandidate | None = None
        for owner_record in owner_records:
            owner_name = HumanName(owner_record.owner_name)
            last_name_score = self._score_last_name(obituary_last, owner_name.last)
            if last_name_score < 90:
                continue

            first_name_score = self._score_first_name(obituary_first, owner_name.first)
            if first_name_score < 75:
                continue

            location_bonus_applied = self._location_bonus_applies(obituary, owner_record)
            score = (last_name_score * 0.60) + (first_name_score * 0.40)
            if location_bonus_applied:
                score = min(100.0, score + 5.0)

            if score < 85:
                continue

            matched_fields = ["last_name", "first_name"]
            explanation = [
                f"Last name similarity scored {round(last_name_score, 2)} against owner record.",
                f"First name similarity scored {round(first_name_score, 2)} after nickname expansion.",
            ]
            if location_bonus_applied:
                matched_fields.append("location")
                explanation.append("Location bonus applied because obituary and owner city/state aligned.")

            candidate = MatchCandidate(
                owner_record=owner_record,
                score=round(score, 2),
                last_name_score=round(last_name_score, 2),
                first_name_score=round(first_name_score, 2),
                location_bonus_applied=location_bonus_applied,
                status="auto_confirmed" if score >= 95 else "pending_review",
                matched_fields=matched_fields,
                explanation=explanation,
            )
            if best is None or candidate.score > best.score:
                best = candidate

        return best

    def _score_last_name(self, obituary_last: str, owner_last: str) -> float:
        normalized_obit = _normalize_name_token(obituary_last)
        normalized_owner = _normalize_name_token(owner_last)
        if not normalized_obit or not normalized_owner:
            return 0.0
        return max(
            float(fuzz.ratio(normalized_obit, normalized_owner)),
            float(fuzz.token_sort_ratio(normalized_obit, normalized_owner)),
        )

    def _score_first_name(self, obituary_first: str, owner_first: str) -> float:
        obituary_candidates = self.nickname_index.expand(obituary_first)
        owner_candidates = self.nickname_index.expand(owner_first)
        best = 0.0
        for obit_candidate in obituary_candidates:
            for owner_candidate in owner_candidates:
                best = max(best, float(fuzz.ratio(obit_candidate, owner_candidate)))
        return best

    def _location_bonus_applies(self, obituary: ObituaryRecord, owner_record: OwnerRecord) -> bool:
        owner_city = owner_record.property_city or owner_record.mailing_city
        owner_state = owner_record.state or owner_record.mailing_state
        if not obituary.city or not obituary.state or not owner_city or not owner_state:
            return False
        if obituary.state.upper() != owner_state.upper():
            return False
        return fuzz.ratio(_normalize_name_token(obituary.city), _normalize_name_token(owner_city)) >= 80
