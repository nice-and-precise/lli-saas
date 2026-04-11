from __future__ import annotations

import csv
import re
import unicodedata
from dataclasses import dataclass
from pathlib import Path

from rapidfuzz import fuzz

from src.collector import ObituaryRecord
from src.contracts import MatchExplanationDetail, OwnerRecord

# Keep matching deterministic and inspectable with a lightweight RapidFuzz-based scorer.
# Heavier entity-resolution libraries would add extra runtime state and opaque training
# behavior that this pipeline does not currently need.
SUFFIX_TOKENS = {
    "jr",
    "sr",
    "ii",
    "iii",
    "iv",
    "v",
    "md",
    "phd",
    "dds",
    "dvm",
    "junior",
    "senior",
}

INITIAL_MATCH_SCORE = 88.0


@dataclass(frozen=True)
class MatchTuning:
    minimum_score: float = 80.0
    minimum_last_name_score: float = 84.0
    minimum_first_name_score: float = 70.0
    auto_confirm_threshold: float = 94.0
    medium_confidence_threshold: float = 86.0
    location_bonus: float = 5.0
    last_name_weight: float = 0.40
    first_name_weight: float = 0.35
    full_name_weight: float = 0.15
    middle_name_weight: float = 0.10


@dataclass(frozen=True)
class NameParts:
    raw: str
    normalized: str
    tokens: tuple[str, ...]
    first: str
    middle: tuple[str, ...]
    last: str
    suffixes: tuple[str, ...]
    any_ngrams: tuple[str, ...]
    tail_ngrams: tuple[str, ...]
    sorted_name: str


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
        confidence_band: str,
        matched_fields: list[str],
        explanation: list[str],
        explanation_details: list[MatchExplanationDetail],
    ) -> None:
        self.owner_record = owner_record
        self.score = score
        self.last_name_score = last_name_score
        self.first_name_score = first_name_score
        self.location_bonus_applied = location_bonus_applied
        self.status = status
        self.confidence_band = confidence_band
        self.matched_fields = matched_fields
        self.explanation = explanation
        self.explanation_details = explanation_details


def _normalize_name_token(value: str | None) -> str:
    if not value:
        return ""
    folded = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode("ascii")
    folded = folded.replace("&", " and ")
    folded = re.sub(r"[’']", "", folded)
    folded = re.sub(r"[-/]+", " ", folded)
    cleaned = re.sub(r"[^A-Za-z,\s]+", " ", folded).lower()
    return re.sub(r"\s+", " ", cleaned).strip()


def _tokenize_name(value: str | None) -> tuple[str, ...]:
    normalized = _normalize_name_token(value)
    return tuple(token for token in normalized.split(" ") if token)


def _build_ngrams(tokens: tuple[str, ...], *, max_size: int = 2) -> tuple[str, ...]:
    if not tokens:
        return tuple()
    seen: list[str] = []
    seen_set: set[str] = set()
    for size in range(1, min(max_size, len(tokens)) + 1):
        for start in range(len(tokens) - size + 1):
            span = tokens[start : start + size]
            for value in (" ".join(span), "".join(span)):
                if value and value not in seen_set:
                    seen.append(value)
                    seen_set.add(value)
    return tuple(seen)


def _build_name_parts(value: str | None) -> NameParts:
    raw = (value or "").strip()
    folded_raw = _normalize_name_token(raw)
    if "," in raw:
        comma_parts = [_tokenize_name(part) for part in raw.split(",")]
        surname_tokens = comma_parts[0] if comma_parts else tuple()
        given_tokens = tuple(token for part in comma_parts[1:] for token in part)
        tokens = given_tokens + surname_tokens
    else:
        tokens = _tokenize_name(raw)

    core_tokens = list(tokens)
    suffixes: list[str] = []
    while core_tokens and core_tokens[-1] in SUFFIX_TOKENS:
        suffixes.insert(0, core_tokens.pop())

    if not core_tokens:
        return NameParts(
            raw=raw,
            normalized=folded_raw,
            tokens=tuple(),
            first="",
            middle=tuple(),
            last="",
            suffixes=tuple(suffixes),
            any_ngrams=tuple(),
            tail_ngrams=tuple(),
            sorted_name="",
        )

    token_tuple = tuple(core_tokens)
    return NameParts(
        raw=raw,
        normalized=" ".join(token_tuple),
        tokens=token_tuple,
        first=token_tuple[0],
        middle=token_tuple[1:-1] if len(token_tuple) > 2 else tuple(),
        last=token_tuple[-1] if len(token_tuple) > 1 else token_tuple[0],
        suffixes=tuple(suffixes),
        any_ngrams=_build_ngrams(token_tuple, max_size=2),
        tail_ngrams=_build_ngrams(token_tuple[-2:] if len(token_tuple) > 1 else token_tuple, max_size=2),
        sorted_name=" ".join(sorted(token_tuple)),
    )


def _similarity(left: str, right: str) -> float:
    if not left or not right:
        return 0.0
    return max(
        float(fuzz.ratio(left, right)),
        float(fuzz.partial_ratio(left, right)),
        float(fuzz.token_sort_ratio(left, right)),
    )


def _initials_match(left: str, right: str) -> bool:
    return bool(left and right and left[0] == right[0])


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
    def __init__(self, nickname_index: NicknameIndex, tuning: MatchTuning | None = None) -> None:
        self.nickname_index = nickname_index
        self.tuning = tuning or MatchTuning()

    def match_obituary(self, obituary: ObituaryRecord, owner_records: list[OwnerRecord]) -> MatchCandidate | None:
        obituary_name = _build_name_parts(obituary.full_name)

        best: MatchCandidate | None = None
        for owner_record in owner_records:
            owner_name = _build_name_parts(owner_record.owner_name)
            last_name_score, last_name_evidence = self._score_last_name(obituary_name, owner_name)
            if last_name_score < self.tuning.minimum_last_name_score:
                continue

            first_name_score, first_name_evidence = self._score_first_name(obituary_name, owner_name)
            if first_name_score < self.tuning.minimum_first_name_score:
                continue

            middle_name_score, middle_name_evidence, include_middle_score = self._score_middle_name(obituary_name, owner_name)
            full_name_score, reordered_name_detected = self._score_full_name(obituary_name, owner_name)
            location_bonus_applied = self._location_bonus_applies(obituary, owner_record)
            score = self._weighted_score(
                last_name_score=last_name_score,
                first_name_score=first_name_score,
                middle_name_score=middle_name_score,
                include_middle_score=include_middle_score,
                full_name_score=full_name_score,
            )
            if location_bonus_applied:
                score = min(100.0, score + self.tuning.location_bonus)

            if score < self.tuning.minimum_score:
                continue

            confidence_band = self._resolve_confidence_band(score)
            matched_fields = ["last_name", "first_name", "full_name"]
            if include_middle_score and middle_name_score >= 80:
                matched_fields.append("middle_name")
            if reordered_name_detected:
                matched_fields.append("reordered_name")

            explanation_details = [
                MatchExplanationDetail(
                    component="last_name",
                    score=round(last_name_score, 2),
                    weight=self.tuning.last_name_weight,
                    matched=last_name_score >= self.tuning.minimum_last_name_score,
                    evidence=last_name_evidence,
                ),
                MatchExplanationDetail(
                    component="first_name",
                    score=round(first_name_score, 2),
                    weight=self.tuning.first_name_weight,
                    matched=first_name_score >= self.tuning.minimum_first_name_score,
                    evidence=first_name_evidence,
                ),
                MatchExplanationDetail(
                    component="full_name",
                    score=round(full_name_score, 2),
                    weight=self.tuning.full_name_weight,
                    matched=full_name_score >= self.tuning.medium_confidence_threshold,
                    evidence=(
                        "Token-sorted full-name similarity stayed strong after normalization and punctuation folding."
                        if reordered_name_detected
                        else "Full-name similarity reinforced the token-level match after normalization."
                    ),
                ),
            ]
            if include_middle_score:
                explanation_details.append(
                    MatchExplanationDetail(
                        component="middle_name",
                        score=round(middle_name_score, 2),
                        weight=self.tuning.middle_name_weight,
                        matched=middle_name_score >= 80,
                        evidence=middle_name_evidence,
                    )
                )

            explanation = [
                f"[last_name] score={round(last_name_score, 2)} weight={self.tuning.last_name_weight} evidence={last_name_evidence}",
                f"[first_name] score={round(first_name_score, 2)} weight={self.tuning.first_name_weight} evidence={first_name_evidence}",
                (
                    f"[full_name] score={round(full_name_score, 2)} weight={self.tuning.full_name_weight} "
                    "evidence=token order normalization preserved the match"
                ),
            ]
            if include_middle_score:
                explanation.append(
                    f"[middle_name] score={round(middle_name_score, 2)} weight={self.tuning.middle_name_weight} "
                    f"evidence={middle_name_evidence}"
                )
            if location_bonus_applied:
                matched_fields.append("location")
                explanation_details.append(
                    MatchExplanationDetail(
                        component="location",
                        score=round(self.tuning.location_bonus, 2),
                        weight=0.0,
                        matched=True,
                        evidence="City/state alignment added the configured location bonus.",
                    )
                )
                explanation.append(
                    f"[location] score={round(self.tuning.location_bonus, 2)} weight=bonus "
                    "evidence=city/state alignment added the configured bonus"
                )
            if obituary_name.suffixes or owner_name.suffixes:
                explanation.append(
                    "[normalization] score=ignored weight=0 evidence=suffix tokens were removed before scoring"
                )

            candidate = MatchCandidate(
                owner_record=owner_record,
                score=round(score, 2),
                last_name_score=round(last_name_score, 2),
                first_name_score=round(first_name_score, 2),
                location_bonus_applied=location_bonus_applied,
                status="auto_confirmed" if confidence_band == "high" else "pending_review",
                confidence_band=confidence_band,
                matched_fields=matched_fields,
                explanation=explanation,
                explanation_details=explanation_details,
            )
            if best is None or candidate.score > best.score:
                best = candidate

        return best

    def _score_last_name(self, obituary_name: NameParts, owner_name: NameParts) -> tuple[float, str]:
        if not obituary_name.tokens or not owner_name.last:
            return 0.0, "Missing surname tokens after normalization."

        owner_candidates = owner_name.tail_ngrams or ((owner_name.last,) if owner_name.last else ())
        best_score = 0.0
        best_pair = ("", "")
        for owner_candidate in owner_candidates:
            for obituary_candidate in obituary_name.any_ngrams:
                score = _similarity(owner_candidate, obituary_candidate)
                if score > best_score:
                    best_score = score
                    best_pair = (owner_candidate, obituary_candidate)

        if not best_pair[0]:
            return 0.0, "No surname candidates survived normalization."
        return best_score, f"owner={best_pair[0]} obituary={best_pair[1]}"

    def _score_first_name(self, obituary_name: NameParts, owner_name: NameParts) -> tuple[float, str]:
        if not obituary_name.tokens or not owner_name.first:
            return 0.0, "Missing given-name tokens after normalization."

        owner_candidates = self.nickname_index.expand(owner_name.first)
        best_score = 0.0
        best_evidence = f"owner={owner_name.first}"
        for obituary_token in obituary_name.tokens:
            obituary_candidates = self.nickname_index.expand(obituary_token)
            for obituary_candidate in obituary_candidates:
                for owner_candidate in owner_candidates:
                    candidate_score = _similarity(obituary_candidate, owner_candidate)
                    if obituary_candidate == owner_candidate:
                        candidate_score = max(candidate_score, 100.0)
                    if candidate_score > best_score:
                        best_score = candidate_score
                        best_evidence = f"owner={owner_candidate} obituary={obituary_candidate}"
            if len(obituary_token) == 1 and _initials_match(obituary_token, owner_name.first):
                if INITIAL_MATCH_SCORE > best_score:
                    best_score = INITIAL_MATCH_SCORE
                    best_evidence = f"owner={owner_name.first} obituary_initial={obituary_token}"

        return best_score, best_evidence

    def _score_middle_name(
        self,
        obituary_name: NameParts,
        owner_name: NameParts,
    ) -> tuple[float, str, bool]:
        if not owner_name.middle and not obituary_name.middle:
            return 100.0, "Neither name included middle tokens.", False
        if not owner_name.middle or not obituary_name.middle:
            return 85.0, "One name omitted middle tokens; omission tolerated.", True

        matched_scores: list[float] = []
        evidence: list[str] = []
        obituary_middle = obituary_name.middle
        for owner_token in owner_name.middle:
            best_token_score = 0.0
            best_obituary_token = ""
            for obituary_token in obituary_middle:
                if owner_token == obituary_token:
                    token_score = 100.0
                elif _initials_match(owner_token, obituary_token) and (len(owner_token) == 1 or len(obituary_token) == 1):
                    token_score = INITIAL_MATCH_SCORE
                else:
                    token_score = _similarity(owner_token, obituary_token)
                if token_score > best_token_score:
                    best_token_score = token_score
                    best_obituary_token = obituary_token
            matched_scores.append(best_token_score)
            evidence.append(f"{owner_token}->{best_obituary_token or '?'}")

        average_score = sum(matched_scores) / len(matched_scores) if matched_scores else 0.0
        return average_score, ", ".join(evidence), True

    def _score_full_name(self, obituary_name: NameParts, owner_name: NameParts) -> tuple[float, bool]:
        if not obituary_name.normalized or not owner_name.normalized:
            return 0.0, False

        direct_score = float(fuzz.ratio(obituary_name.normalized, owner_name.normalized))
        token_sort_score = float(fuzz.token_sort_ratio(obituary_name.normalized, owner_name.normalized))
        token_set_score = float(fuzz.token_set_ratio(obituary_name.normalized, owner_name.normalized))
        sorted_score = float(fuzz.ratio(obituary_name.sorted_name, owner_name.sorted_name))
        full_name_score = max(direct_score, token_sort_score, token_set_score, sorted_score)
        reordered_name_detected = token_sort_score >= direct_score + 5 and token_sort_score >= 90
        return full_name_score, reordered_name_detected

    def _weighted_score(
        self,
        *,
        last_name_score: float,
        first_name_score: float,
        middle_name_score: float,
        include_middle_score: bool,
        full_name_score: float,
    ) -> float:
        weights = {
            "last_name": self.tuning.last_name_weight,
            "first_name": self.tuning.first_name_weight,
            "full_name": self.tuning.full_name_weight,
        }
        weighted_total = (
            (last_name_score * weights["last_name"])
            + (first_name_score * weights["first_name"])
            + (full_name_score * weights["full_name"])
        )
        total_weight = sum(weights.values())
        if include_middle_score:
            weighted_total += middle_name_score * self.tuning.middle_name_weight
            total_weight += self.tuning.middle_name_weight
        if total_weight == 0:
            return 0.0
        return weighted_total / total_weight

    def _resolve_confidence_band(self, score: float) -> str:
        if score >= self.tuning.auto_confirm_threshold:
            return "high"
        if score >= self.tuning.medium_confidence_threshold:
            return "medium"
        return "low"

    def _location_bonus_applies(self, obituary: ObituaryRecord, owner_record: OwnerRecord) -> bool:
        owner_city = owner_record.property_city or owner_record.mailing_city
        owner_state = owner_record.state or owner_record.mailing_state
        if not obituary.city or not obituary.state or not owner_city or not owner_state:
            return False
        if obituary.state.upper() != owner_state.upper():
            return False
        return fuzz.ratio(_normalize_name_token(obituary.city), _normalize_name_token(owner_city)) >= 80
