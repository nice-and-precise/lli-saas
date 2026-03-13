from __future__ import annotations

import re
from datetime import UTC, date, datetime
from email.utils import parsedate_to_datetime
from html import unescape
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from bs4 import BeautifulSoup
from bs4.element import PageElement

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

OBITUARY_CONTEXT_KEYWORDS = [
    "passed away",
    "died",
    "obituary",
    "funeral",
    "visitation",
    "memorial",
    "celebration of life",
    "services will be held",
    "survived by",
]


def utcnow() -> datetime:
    return datetime.now(UTC)


def canonicalize_url(url: str) -> str:
    parts = urlsplit(url.strip())
    filtered_query = [
        (key, value)
        for key, value in parse_qsl(parts.query, keep_blank_values=True)
        if not key.startswith("utm_") and key not in {"fbclid", "gclid"}
    ]
    return urlunsplit((parts.scheme, parts.netloc.lower(), parts.path.rstrip("/"), urlencode(filtered_query), ""))


def html_to_text(value: str) -> str:
    if not value:
        return ""
    soup = BeautifulSoup(value, "lxml")
    text = soup.get_text(" ", strip=True)
    return normalize_whitespace(unescape(text))


def extract_content_text(value: str, selectors: tuple[str, ...] = ()) -> str:
    if not value:
        return ""

    soup = BeautifulSoup(value, "lxml")
    for selector in (
        "script",
        "style",
        "noscript",
        "svg",
        "header",
        "footer",
        "nav",
        "aside",
        "form",
        "button",
        ".ad",
        ".ads",
        ".advertisement",
        ".newsletter",
        ".social-share",
        ".related-links",
        ".recommended",
        ".site-header",
        ".site-footer",
        ".breadcrumbs",
    ):
        for node in soup.select(selector):
            node.decompose()

    selected_nodes: list[PageElement] = []
    for selector in selectors:
        nodes = soup.select(selector)
        if nodes:
            selected_nodes = list(nodes)
            break

    if not selected_nodes:
        for selector in (
            "article",
            "main",
            ".article-body",
            ".asset-body",
            ".content-body",
            ".obituary-content",
            ".obit-body",
            "[itemprop='articleBody']",
        ):
            nodes = soup.select(selector)
            if nodes:
                selected_nodes = list(nodes)
                break

    if selected_nodes:
        text = " ".join(node.get_text(" ", strip=True) for node in selected_nodes)
        return normalize_whitespace(unescape(text))

    return normalize_whitespace(unescape(soup.get_text(" ", strip=True)))


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
        return parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def isoformat_or_none(value: datetime | None) -> str | None:
    if value is None:
        return None
    return value.astimezone(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


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
        if parsed and _death_date_is_reasonable(parsed, published_at):
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

    return None, None


def is_iowa_relevant(text: str, city: str | None, state: str | None) -> bool:
    lowered = text.lower()
    if not has_obituary_context(text):
        return False
    if state == "IA":
        return True
    if city and city.lower() in IOWA_CITIES:
        return True
    if any(f"{county} county" in lowered for county in IOWA_COUNTIES):
        return True
    return bool(re.search(r"\b(?:in|of|from|born in|died in)\s+[a-z .'-]+,\s*(?:ia|iowa)\b", lowered))


def has_obituary_context(text: str) -> bool:
    lowered = text.lower()
    return any(keyword in lowered for keyword in OBITUARY_CONTEXT_KEYWORDS)


def is_obituary_listing_text(title: str, text: str) -> bool:
    lowered = f"{title} {text}".lower()
    return any(keyword in lowered for keyword in OBITUARY_CONTEXT_KEYWORDS)


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


def _death_date_is_reasonable(value: date, published_at: datetime | None) -> bool:
    if published_at is None:
        return value.year >= 2020
    published_date = published_at.date()
    if value > published_date:
        return False
    return (published_date - value).days <= 366
