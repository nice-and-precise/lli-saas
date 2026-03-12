from __future__ import annotations

import re
from datetime import date, datetime, timezone
from email.utils import parsedate_to_datetime
from html import unescape
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from bs4 import BeautifulSoup


MONTH_LOOKUP = {
    "january": 1,
    "february": 2,
    "march": 3,
    "april": 4,
    "may": 5,
    "june": 6,
    "july": 7,
    "august": 8,
    "september": 9,
    "october": 10,
    "november": 11,
    "december": 12,
}


STATE_NORMALIZATION = {
    "alabama": "AL",
    "alaska": "AK",
    "arizona": "AZ",
    "arkansas": "AR",
    "california": "CA",
    "colorado": "CO",
    "connecticut": "CT",
    "delaware": "DE",
    "florida": "FL",
    "georgia": "GA",
    "hawaii": "HI",
    "idaho": "ID",
    "illinois": "IL",
    "indiana": "IN",
    "iowa": "IA",
    "kansas": "KS",
    "kentucky": "KY",
    "louisiana": "LA",
    "maine": "ME",
    "maryland": "MD",
    "massachusetts": "MA",
    "michigan": "MI",
    "minnesota": "MN",
    "mississippi": "MS",
    "missouri": "MO",
    "montana": "MT",
    "nebraska": "NE",
    "nevada": "NV",
    "new hampshire": "NH",
    "new jersey": "NJ",
    "new mexico": "NM",
    "new york": "NY",
    "north carolina": "NC",
    "north dakota": "ND",
    "ohio": "OH",
    "oklahoma": "OK",
    "oregon": "OR",
    "pennsylvania": "PA",
    "rhode island": "RI",
    "south carolina": "SC",
    "south dakota": "SD",
    "tennessee": "TN",
    "texas": "TX",
    "utah": "UT",
    "vermont": "VT",
    "virginia": "VA",
    "washington": "WA",
    "west virginia": "WV",
    "wisconsin": "WI",
    "wyoming": "WY",
}
STATE_NORMALIZATION.update({code: code for code in STATE_NORMALIZATION.values()})
STATE_NORMALIZATION.update({code.lower(): code for code in STATE_NORMALIZATION.values()})

IOWA_COUNTIES = {
    "adair",
    "adams",
    "allamakee",
    "appanoose",
    "audubon",
    "benton",
    "black hawk",
    "boone",
    "bremer",
    "buchanan",
    "buena vista",
    "butler",
    "calhoun",
    "carroll",
    "cass",
    "cedar",
    "cerro gordo",
    "cherokee",
    "chickasaw",
    "clarke",
    "clay",
    "clayton",
    "clinton",
    "crawford",
    "dallas",
    "davis",
    "decatur",
    "delaware",
    "des moines",
    "dickinson",
    "dubuque",
    "emmet",
    "fayette",
    "floyd",
    "franklin",
    "fremont",
    "greene",
    "grundy",
    "guthrie",
    "hamilton",
    "hancock",
    "hardin",
    "harrison",
    "henry",
    "howard",
    "humboldt",
    "ida",
    "iowa",
    "jackson",
    "jasper",
    "jefferson",
    "johnson",
    "jones",
    "keokuk",
    "kossuth",
    "lee",
    "linn",
    "louisa",
    "lucas",
    "lyon",
    "madison",
    "mahaska",
    "marion",
    "marshall",
    "mills",
    "mitchell",
    "monona",
    "monroe",
    "montgomery",
    "muscatine",
    "obrien",
    "osceola",
    "page",
    "palo alto",
    "plymouth",
    "pocahontas",
    "polk",
    "pottawattamie",
    "poweshiek",
    "ringgold",
    "sac",
    "scott",
    "shelby",
    "sioux",
    "story",
    "tama",
    "taylor",
    "union",
    "van buren",
    "wapello",
    "warren",
    "washington",
    "wayne",
    "webster",
    "winnebago",
    "winneshiek",
    "woodbury",
    "worth",
    "wright",
}

IOWA_CITIES = {
    "ames",
    "atlantic",
    "boone",
    "burlington",
    "carroll",
    "cedar falls",
    "cedar rapids",
    "charles city",
    "clarinda",
    "clinton",
    "coralville",
    "council bluffs",
    "davenport",
    "decorah",
    "des moines",
    "dubuque",
    "fort dodge",
    "grinnell",
    "indianola",
    "iowa city",
    "keokuk",
    "knoxville",
    "le mars",
    "marshalltown",
    "mason city",
    "mount pleasant",
    "muscatine",
    "nevada",
    "newton",
    "ottumwa",
    "pella",
    "red oak",
    "spencer",
    "storm lake",
    "waterloo",
    "webster city",
    "west des moines",
    "winterset",
}

SURVIVOR_KEYWORDS = [
    "survived by",
    "is survived by",
    "survivors include",
    "left to cherish",
    "left behind",
    "children:",
    "sons:",
    "daughters:",
]


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def canonicalize_url(url: str) -> str:
    parts = urlsplit(url.strip())
    filtered_query = [(key, value) for key, value in parse_qsl(parts.query, keep_blank_values=True) if not key.startswith("utm_") and key not in {"fbclid", "gclid"}]
    return urlunsplit((parts.scheme, parts.netloc.lower(), parts.path.rstrip("/"), urlencode(filtered_query), ""))


def html_to_text(value: str) -> str:
    if not value:
        return ""
    soup = BeautifulSoup(value, "lxml")
    text = soup.get_text(" ", strip=True)
    return normalize_whitespace(unescape(text))


def normalize_whitespace(value: str) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


def parse_optional_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = parsedate_to_datetime(value)
    except (TypeError, ValueError, IndexError):
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def isoformat_or_none(value: datetime | None) -> str | None:
    if value is None:
        return None
    return value.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def normalize_state(value: str | None) -> str | None:
    if not value:
        return None
    cleaned = value.strip().replace(".", "").lower()
    if cleaned == "ia":
        return "IA"
    return STATE_NORMALIZATION.get(cleaned)


def parse_month_date(text: str) -> date | None:
    match = re.search(
        r"\b(" + "|".join(MONTH_LOOKUP.keys()) + r")\s+(\d{1,2})(?:,)?\s+(\d{4})\b",
        text,
        re.IGNORECASE,
    )
    if not match:
        return None
    month = MONTH_LOOKUP[match.group(1).lower()]
    day = int(match.group(2))
    year = int(match.group(3))
    return date(year, month, day)


def extract_death_date(text: str, published_at: datetime | None) -> str | None:
    patterns = [
        r"(?:passed away|died|entered eternal rest|went to be with the lord)\s+(?:on\s+)?([^.;]+)",
        r"(?:death occurred|death date)\s*(?:on\s+)?([^.;]+)",
    ]
    for pattern in patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        if not match:
            continue
        parsed = parse_month_date(match.group(1))
        if parsed:
            return parsed.isoformat()

    if published_at:
        return published_at.date().isoformat()

    return None


def extract_iowa_location(text: str) -> tuple[str | None, str | None]:
    explicit = re.search(r"\b([A-Z][A-Za-z .'-]+?),\s*(IA|Iowa)\b", text)
    if explicit:
        return normalize_whitespace(explicit.group(1)).title(), "IA"

    dateline = re.search(r"^([A-Z][A-Z .'-]+?),\s*(IA|Iowa)\s*[—-]", text)
    if dateline:
        return normalize_whitespace(dateline.group(1)).title(), "IA"

    lowered = text.lower()
    for city in sorted(IOWA_CITIES, key=len, reverse=True):
        if re.search(rf"\b(?:of|born in|from|lived in)\s+{re.escape(city)}\b", lowered):
            if city == "nevada" and "nevada, ia" not in lowered and "nevada, iowa" not in lowered:
                continue
            return city.title(), "IA"

    for city in sorted(IOWA_CITIES, key=len, reverse=True):
        if city in lowered[:1000]:
            return city.title(), "IA"

    return None, None


def is_iowa_relevant(text: str, city: str | None, state: str | None) -> bool:
    lowered = text.lower()
    if state == "IA":
        return True
    if city and city.lower() in IOWA_CITIES:
        return True
    if any(f"{county} county" in lowered for county in IOWA_COUNTIES):
        return True
    return " iowa" in lowered or ", ia" in lowered


def has_survivor_signal(text: str) -> bool:
    lowered = text.lower()
    return len(text) > 250 and any(keyword in lowered for keyword in SURVIVOR_KEYWORDS)


def detect_out_of_state_survivor_states(text: str) -> tuple[bool, list[str], str | None]:
    lowered = text.lower()
    anchor_positions = [lowered.find(keyword) for keyword in SURVIVOR_KEYWORDS if lowered.find(keyword) >= 0]
    start = min(anchor_positions) if anchor_positions else 0
    window = text[start : start + 350]
    states: set[str] = set()
    evidence = None
    pattern = re.compile(
        r"\b(?:of|in|from|residing in)\s+[A-Z][A-Za-z .'-]+,\s*([A-Z]{2}|[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\b"
    )
    for match in pattern.finditer(window):
        normalized = normalize_state(match.group(1))
        if normalized and normalized != "IA":
            states.add(normalized)
            if evidence is None:
                evidence = normalize_whitespace(window)

    return bool(states), sorted(states), evidence
