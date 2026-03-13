from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

SourceStrategy = Literal[
    "rss_feed",
    "html_listing_gannett",
    "html_listing_blox",
    "html_listing_custom",
    "html_listing_funeral_home",
]

DEFAULT_PROOF_TARGET_COUNT = 6
OBITUARY_KEYWORDS = (
    "obituary",
    "obituaries",
    "passed away",
    "funeral",
    "visitation",
    "memorial",
    "celebration of life",
    "survived by",
)


@dataclass(frozen=True)
class SourceDefinition:
    source_id: str
    label: str
    strategy: SourceStrategy
    listing_url: str
    homepage_url: str
    region: str
    feed_url: str | None = None
    keyword_filters: tuple[str, ...] = field(default_factory=tuple)
    always_fetch_full_page: bool = False
    content_selectors: tuple[str, ...] = field(default_factory=tuple)
    listing_link_selectors: tuple[str, ...] = field(default_factory=tuple)
    requires_session_warmup: bool = False
    browser_render_listing: bool = False
    browser_render_detail: bool = False


PRIMARY_IOWA_SOURCES = [
    SourceDefinition(
        source_id="kwbg_boone",
        label="KWBG Radio",
        strategy="rss_feed",
        listing_url="https://www.kwbg.com/feed/",
        feed_url="https://www.kwbg.com/feed/",
        homepage_url="https://www.kwbg.com/",
        region="Central Iowa",
        keyword_filters=OBITUARY_KEYWORDS,
    ),
    SourceDefinition(
        source_id="kjan_atlantic",
        label="KJAN Radio",
        strategy="rss_feed",
        listing_url="https://www.kjan.com/?feed=rss2&cat=obits",
        feed_url="https://www.kjan.com/?feed=rss2&cat=obits",
        homepage_url="https://www.kjan.com/",
        region="Southwest Iowa",
        keyword_filters=OBITUARY_KEYWORDS,
    ),
    SourceDefinition(
        source_id="the_gazette",
        label="The Gazette",
        strategy="html_listing_custom",
        listing_url="https://www.thegazette.com/obituaries/",
        homepage_url="https://www.thegazette.com/",
        region="Eastern Iowa",
        always_fetch_full_page=True,
        content_selectors=(
            "main article",
            "article",
            ".article-body",
            ".article-restofcontent",
            "[data-testid='article-body']",
        ),
        listing_link_selectors=("a[href*='/obituaries/']",),
        requires_session_warmup=True,
    ),
    SourceDefinition(
        source_id="quad_city_times",
        label="Quad-City Times",
        strategy="html_listing_gannett",
        listing_url="https://qctimes.com/obituaries/",
        homepage_url="https://qctimes.com/",
        region="Scott County",
        always_fetch_full_page=True,
        content_selectors=("article", "main", "[itemprop='articleBody']", ".gnt_ar_b"),
        listing_link_selectors=("a[href*='/obituaries/']",),
        requires_session_warmup=True,
    ),
    SourceDefinition(
        source_id="waterloo_courier",
        label="Waterloo-Cedar Falls Courier",
        strategy="html_listing_blox",
        listing_url="https://wcfcourier.com/obituaries/",
        homepage_url="https://wcfcourier.com/",
        region="Black Hawk County",
        always_fetch_full_page=True,
        content_selectors=("article", "main", ".asset-body", ".lee-text", ".content-body"),
        listing_link_selectors=("a[href*='/obituaries/']",),
        requires_session_warmup=True,
    ),
    SourceDefinition(
        source_id="sioux_city_journal",
        label="Sioux City Journal",
        strategy="html_listing_blox",
        listing_url="https://siouxcityjournal.com/obituaries/",
        homepage_url="https://siouxcityjournal.com/",
        region="Woodbury County",
        always_fetch_full_page=True,
        content_selectors=("article", "main", ".asset-body", ".lee-text", ".content-body"),
        listing_link_selectors=("a[href*='/obituaries/']",),
        requires_session_warmup=True,
    ),
    SourceDefinition(
        source_id="globe_gazette",
        label="Globe Gazette",
        strategy="html_listing_blox",
        listing_url="https://globegazette.com/obituaries/",
        homepage_url="https://globegazette.com/",
        region="Cerro Gordo County",
        always_fetch_full_page=True,
        content_selectors=("article", "main", ".asset-body", ".lee-text", ".content-body"),
        listing_link_selectors=("a[href*='/obituaries/']",),
        requires_session_warmup=True,
    ),
    SourceDefinition(
        source_id="des_moines_register",
        label="Des Moines Register",
        strategy="html_listing_gannett",
        listing_url="https://www.desmoinesregister.com/obituaries/",
        homepage_url="https://www.desmoinesregister.com/",
        region="Polk County",
        always_fetch_full_page=True,
        content_selectors=("article", "main", "[itemprop='articleBody']", ".gnt_ar_b"),
        listing_link_selectors=("a[href*='/obituaries/']",),
        requires_session_warmup=True,
    ),
    SourceDefinition(
        source_id="iowa_city_press_citizen",
        label="Iowa City Press-Citizen",
        strategy="html_listing_gannett",
        listing_url="https://www.press-citizen.com/obituaries/",
        homepage_url="https://www.press-citizen.com/",
        region="Johnson County",
        always_fetch_full_page=True,
        content_selectors=("article", "main", "[itemprop='articleBody']", ".gnt_ar_b"),
        listing_link_selectors=("a[href*='/obituaries/']",),
        requires_session_warmup=True,
    ),
    SourceDefinition(
        source_id="ames_tribune",
        label="Ames Tribune",
        strategy="html_listing_gannett",
        listing_url="https://www.amestrib.com/obituaries/",
        homepage_url="https://www.amestrib.com/",
        region="Story County",
        always_fetch_full_page=True,
        content_selectors=("article", "main", "[itemprop='articleBody']", ".gnt_ar_b"),
        listing_link_selectors=("a[href*='/obituaries/']",),
        requires_session_warmup=True,
    ),
]

SUPPLEMENTAL_IOWA_SOURCES = [
    SourceDefinition(
        source_id="hamiltons_funeral_home",
        label="Hamilton's Funeral Home",
        strategy="html_listing_funeral_home",
        listing_url="https://www.hamiltonsfuneralhome.com/obituaries",
        homepage_url="https://www.hamiltonsfuneralhome.com/",
        region="Polk County",
        always_fetch_full_page=True,
        content_selectors=("main", "article", ".obituary-content", ".obit-body", ".tribute-container"),
        listing_link_selectors=("a[href*='/obituaries']",),
    ),
    SourceDefinition(
        source_id="lensing_funeral_home",
        label="Lensing Funeral Home",
        strategy="html_listing_funeral_home",
        listing_url="https://www.lensingfuneral.com/obituaries",
        homepage_url="https://www.lensingfuneral.com/",
        region="Johnson County",
        always_fetch_full_page=True,
        content_selectors=("main", "article", ".obituary-content", ".obit-body", ".tribute-container"),
        listing_link_selectors=("a[href*='/obituaries']",),
        browser_render_listing=True,
        browser_render_detail=True,
    ),
    SourceDefinition(
        source_id="dahn_woodhouse",
        label="Dahn & Woodhouse",
        strategy="html_listing_funeral_home",
        listing_url="https://www.dahnandwoodhouse.com/obituaries",
        homepage_url="https://www.dahnandwoodhouse.com/",
        region="Carroll County",
        always_fetch_full_page=True,
        content_selectors=("main", "article", ".obituary-content", ".obit-body", ".tribute-container"),
        listing_link_selectors=("a[href*='/obituaries']",),
        browser_render_listing=True,
    ),
]

FIXTURE_PROOF_SOURCES = [
    SourceDefinition(
        source_id="fixture_proof",
        label="Fixture Proof Source",
        strategy="html_listing_custom",
        listing_url="fixture://proof",
        homepage_url="fixture://proof",
        region="Fixture",
        always_fetch_full_page=True,
        content_selectors=("main", "article"),
        listing_link_selectors=("a[href*='/obituaries/']",),
    ),
]

ALL_IOWA_SOURCES = PRIMARY_IOWA_SOURCES + SUPPLEMENTAL_IOWA_SOURCES


def resolve_sources(source_ids: list[str], *, include_supplemental: bool = False) -> list[SourceDefinition]:
    available = list(PRIMARY_IOWA_SOURCES)
    if include_supplemental:
        available.extend(SUPPLEMENTAL_IOWA_SOURCES)

    if not source_ids:
        return available

    requested = set(source_ids)
    explicit_sources = ALL_IOWA_SOURCES + FIXTURE_PROOF_SOURCES
    return [source for source in explicit_sources if source.source_id in requested]
