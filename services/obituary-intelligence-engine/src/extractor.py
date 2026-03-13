from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass
from typing import Any, cast

from pydantic import BaseModel, ConfigDict, Field

from src.normalization import normalize_state, normalize_whitespace

HEIR_EXTRACTION_PROMPT = """
You are a professional genealogist analyzing an obituary to extract family survivor information.

Extract ALL survivors mentioned in the obituary text. Return strictly valid JSON with no markdown.

For each survivor, extract:
- full_name: Their full name as written (strip titles like Dr., Rev., etc.)
- relationship: One of: spouse, son, daughter, brother, sister, grandchild, niece, nephew, executor, other
- location_city: City if mentioned (e.g., "of Chicago" -> "Chicago")
- location_state: State abbreviation if mentioned (e.g., "of Denver, Colorado" -> "CO")

IMPORTANT EXTRACTION RULES:
1. "Survived by his wife" or "life partner" or "companion" -> relationship: "spouse"
2. "Son John (Mary) of Chicago" -> John is son, Mary is daughter-in-law (relationship: "other")
3. "Stepson James" or "Stepdaughter Sarah" -> relationship: "son" or "daughter" (treat as children)
4. "Brother-in-law Tom" or "Sister-in-law Jane" -> relationship: "other" (NOT brother/sister)
5. "Services pending with Anderson Funeral Home" -> Do NOT extract funeral home as heir
6. Names in parentheses after a child's name are usually spouses. Extract them!
7. "John (Jack) Smith" -> Jack is a nickname, extract full_name as "John Smith"
8. "Preceded in death by" -> Do NOT extract these (they are deceased relatives)
9. Executors are sometimes mentioned: "Estate handled by..." or "Services arranged by family member..."
10. "Great-grandchildren" -> relationship: "grandchild"
11. IOWA CITY DISAMBIGUATION: "Nevada" could be Nevada, IA (a city) - check context.
"""


class ExtractedSurvivor(BaseModel):
    model_config = ConfigDict(extra="forbid")

    full_name: str = Field(min_length=1)
    relationship: str = Field(min_length=1)
    location_city: str | None = None
    location_state: str | None = None


class HeirExtractionResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    deceased_name: str = Field(min_length=1)
    survivors: list[ExtractedSurvivor] = Field(default_factory=list)
    executor_mentioned: bool = False
    unexpected_death: bool = False


@dataclass(frozen=True)
class ProviderConfig:
    provider: str
    model: str
    api_key: str | None
    temperature: float


class HeirExtractor:
    def __init__(self) -> None:
        self.provider_chain = [
            ProviderConfig(
                provider=os.getenv("HEIR_EXTRACTION_PRIMARY_PROVIDER", "gemini"),
                model=os.getenv("HEIR_EXTRACTION_PRIMARY_MODEL", "gemini-2.5-flash-lite"),
                api_key=os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY"),
                temperature=0.1,
            ),
            ProviderConfig(
                provider=os.getenv("HEIR_EXTRACTION_FALLBACK_PROVIDER", "gemini"),
                model=os.getenv("HEIR_EXTRACTION_FALLBACK_MODEL", "gemini-1.5-flash"),
                api_key=os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY"),
                temperature=0.2,
            ),
            ProviderConfig(
                provider=os.getenv("HEIR_EXTRACTION_FINAL_PROVIDER", "anthropic"),
                model=os.getenv("HEIR_EXTRACTION_FINAL_MODEL", "claude-3-7-sonnet-latest"),
                api_key=os.getenv("ANTHROPIC_API_KEY"),
                temperature=0.1,
            ),
        ]

    def extract(self, raw_text: str, deceased_name_hint: str, reference_date: str | None = None) -> HeirExtractionResult | None:
        prompt = self._build_prompt(raw_text, reference_date)
        for config in self.provider_chain:
            if not config.api_key:
                continue
            try:
                return self._call_provider(config, prompt)
            except Exception:
                continue

        return self._heuristic_extract(raw_text, deceased_name_hint)

    def _build_prompt(self, raw_text: str, reference_date: str | None) -> str:
        prompt = HEIR_EXTRACTION_PROMPT
        if reference_date:
            prompt += f"\nReference date: {reference_date}\n"
        prompt += "\nJSON Schema:\n"
        prompt += json.dumps(
            {
                "deceased_name": "String",
                "survivors": [
                    {
                        "full_name": "String",
                        "relationship": "String",
                        "location_city": "String or null",
                        "location_state": "String or null",
                    }
                ],
                "executor_mentioned": "Boolean",
                "unexpected_death": "Boolean",
            }
        )
        prompt += "\n\nObituary Text:\n"
        prompt += raw_text[:4000]
        return prompt

    def _call_provider(self, config: ProviderConfig, prompt: str) -> HeirExtractionResult:
        if config.provider == "gemini":
            from google import genai
            from google.genai import types as genai_types

            gemini_client = genai.Client(api_key=config.api_key)
            response = gemini_client.models.generate_content(
                model=config.model,
                contents=[{"text": prompt}],
                config=genai_types.GenerateContentConfig(temperature=config.temperature),
            )
            payload = self._parse_json_response(getattr(response, "text", "") or "")
            return HeirExtractionResult.model_validate(payload)

        if config.provider == "anthropic":
            import anthropic

            anthropic_client: Any = anthropic.Anthropic(api_key=config.api_key)
            response = anthropic_client.messages.create(
                model=config.model,
                max_tokens=1500,
                temperature=config.temperature,
                messages=[{"role": "user", "content": prompt}],
            )
            parts = []
            for block in response.content:
                text = getattr(block, "text", None)
                if text:
                    parts.append(text)
            payload = self._parse_json_response("".join(parts))
            return HeirExtractionResult.model_validate(payload)

        raise ValueError(f"Unsupported provider: {config.provider}")

    def _parse_json_response(self, text: str) -> dict[str, object]:
        stripped = text.strip()
        if stripped.startswith("```"):
            stripped = stripped.split("```", maxsplit=2)[1]
            stripped = stripped.removeprefix("json").strip()
        payload = json.loads(stripped)
        if not isinstance(payload, dict):
            raise ValueError("LLM response must be a JSON object")
        return cast(dict[str, object], payload)

    def _heuristic_extract(self, raw_text: str, deceased_name_hint: str) -> HeirExtractionResult | None:
        lowered = raw_text.lower()
        anchor = None
        for candidate in ("survived by", "is survived by", "survivors include", "left behind"):
            position = lowered.find(candidate)
            if position >= 0:
                anchor = position + len(candidate)
                break

        if anchor is None:
            return HeirExtractionResult(
                deceased_name=deceased_name_hint,
                survivors=[],
                executor_mentioned="executor" in lowered,
                unexpected_death=any(word in lowered for word in ("suddenly", "unexpectedly", "tragically")),
            )

        section = self._extract_survivor_section(raw_text[anchor:])
        survivors = self._extract_survivors_from_section(section)

        return HeirExtractionResult(
            deceased_name=deceased_name_hint,
            survivors=survivors,
            executor_mentioned="executor" in lowered or "estate handled by" in lowered,
            unexpected_death=any(word in lowered for word in ("suddenly", "unexpectedly", "tragically")),
        )

    def _extract_survivor_section(self, section: str) -> str:
        stop_match = re.search(
            r"(preceded in death|visitation|funeral services|memorial services|a celebration of life|services will be held|the family will greet friends|donations may be made|memorials may be directed)",
            section,
            re.IGNORECASE,
        )
        if stop_match:
            section = section[: stop_match.start()]
        section = normalize_whitespace(section[:500])
        section = re.sub(
            r"\b(?:he|she)\s+was\s+known\s+for\b.*$",
            "",
            section,
            flags=re.IGNORECASE,
        )
        return normalize_whitespace(section)

    def _extract_survivors_from_section(self, section: str) -> list[ExtractedSurvivor]:
        fragments = re.split(r";|\.\s+", section)
        survivors: list[ExtractedSurvivor] = []
        seen: set[tuple[str, str, str | None, str | None]] = set()

        relationship_patterns = [
            ("spouse", r"\b(?:wife|husband|spouse|companion)\s+([A-Z][A-Za-z .'-]{1,60}?)(?:\s+(?:of|in)\s+([A-Z][A-Za-z .'-]+?)(?:,\s*([A-Z]{2}|[A-Za-z ]+))?)?$"),
            ("son", r"\b(?:son|stepson)\s+([A-Z][A-Za-z .'-]{1,60}?)(?:\s+(?:of|in)\s+([A-Z][A-Za-z .'-]+?)(?:,\s*([A-Z]{2}|[A-Za-z ]+))?)?$"),
            ("daughter", r"\b(?:daughter|stepdaughter)\s+([A-Z][A-Za-z .'-]{1,60}?)(?:\s+(?:of|in)\s+([A-Z][A-Za-z .'-]+?)(?:,\s*([A-Z]{2}|[A-Za-z ]+))?)?$"),
            ("brother", r"\bbrother\s+([A-Z][A-Za-z .'-]{1,60}?)(?:\s+(?:of|in)\s+([A-Z][A-Za-z .'-]+?)(?:,\s*([A-Z]{2}|[A-Za-z ]+))?)?$"),
            ("sister", r"\bsister\s+([A-Z][A-Za-z .'-]{1,60}?)(?:\s+(?:of|in)\s+([A-Z][A-Za-z .'-]+?)(?:,\s*([A-Z]{2}|[A-Za-z ]+))?)?$"),
            ("grandchild", r"\b(?:grandson|granddaughter|grandchild|great-grandchild|great-grandchildren)\s+([A-Z][A-Za-z .'-]{1,60}?)(?:\s+(?:of|in)\s+([A-Z][A-Za-z .'-]+?)(?:,\s*([A-Z]{2}|[A-Za-z ]+))?)?$"),
            ("niece", r"\bniece\s+([A-Z][A-Za-z .'-]{1,60}?)(?:\s+(?:of|in)\s+([A-Z][A-Za-z .'-]+?)(?:,\s*([A-Z]{2}|[A-Za-z ]+))?)?$"),
            ("nephew", r"\bnephew\s+([A-Z][A-Za-z .'-]{1,60}?)(?:\s+(?:of|in)\s+([A-Z][A-Za-z .'-]+?)(?:,\s*([A-Z]{2}|[A-Za-z ]+))?)?$"),
        ]

        for fragment in fragments:
            cleaned = normalize_whitespace(fragment.strip(" ,.;"))
            if len(cleaned) < 4:
                continue
            subfragments = re.split(r"\s+\band\b\s+", cleaned, flags=re.IGNORECASE)
            for subfragment in subfragments:
                candidate = normalize_whitespace(subfragment.strip(" ,.;"))
                candidate = re.sub(
                    r"^(?:and\s+)?(?:his|her|their)\s+",
                    "",
                    candidate,
                    flags=re.IGNORECASE,
                )
                candidate = re.sub(
                    r"^(?:and\s+)?(?:two|three|four|five|six|seven|eight|nine|ten)\s+",
                    "",
                    candidate,
                    flags=re.IGNORECASE,
                )
                if not self._looks_like_survivor_fragment(candidate):
                    continue
                for relationship, pattern in relationship_patterns:
                    match = re.search(pattern, candidate, re.IGNORECASE)
                    if not match:
                        continue
                    survivor = self._build_survivor(relationship, match)
                    if survivor is None:
                        break
                    key = (
                        survivor.full_name.lower(),
                        survivor.relationship,
                        survivor.location_city,
                        survivor.location_state,
                    )
                    if key not in seen:
                        survivors.append(survivor)
                        seen.add(key)
                    break
        return survivors

    def _build_survivor(self, relationship: str, match: re.Match[str]) -> ExtractedSurvivor | None:
        name = normalize_whitespace(match.group(1))
        city = normalize_whitespace(match.group(2)) if match.lastindex and match.lastindex >= 2 and match.group(2) else None
        state = normalize_state(match.group(3)) if match.lastindex and match.lastindex >= 3 else None
        if not self._is_valid_person_name(name):
            return None
        return ExtractedSurvivor(
            full_name=name,
            relationship=relationship,
            location_city=city,
            location_state=state,
        )

    def _looks_like_survivor_fragment(self, fragment: str) -> bool:
        lowered = fragment.lower()
        if any(
            phrase in lowered
            for phrase in (
                "funeral home",
                "hospice",
                "church activities",
                "civic groups",
                "dedication to the land",
                "known for",
                "family through",
                "services will be held",
                "visitation",
            )
        ):
            return False
        if lowered in {"south carolina", "north carolina", "minnesota", "iowa"}:
            return False
        return True

    def _is_valid_person_name(self, value: str) -> bool:
        lowered = value.lower().strip(" .,'")
        if not lowered:
            return False
        if len(lowered.split()) > 5:
            return False
        if any(
            token in lowered
            for token in (
                "grandchildren",
                "great-grandchildren",
                "nieces",
                "nephews",
                "family",
                "church",
                "community",
                "hospice",
                "dedication",
                "activities",
            )
        ):
            return False
        if lowered in {"arizona", "minnesota", "south carolina", "north carolina", "iowa"}:
            return False
        if not re.search(r"[A-Z][a-z]+", value):
            return False
        return True
