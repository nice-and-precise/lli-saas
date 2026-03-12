from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class RSSSource:
    source_id: str
    label: str
    feed_url: str
    always_fetch_full_page: bool = False


IOWA_RSS_SOURCES = [
    RSSSource("the_gazette", "The Gazette", "https://www.thegazette.com/obituaries/feed/", always_fetch_full_page=True),
    RSSSource("kwbg_boone", "KWBG Radio", "https://kwbg.com/category/obituaries/feed/"),
    RSSSource("kjan_atlantic", "KJAN Radio", "https://www.kjan.com/index.php/category/obituaries/feed/"),
    RSSSource("nw_iowa_now", "NW Iowa Now", "https://nwestiowa.com/obituaries/rss/"),
    RSSSource("waterloo_courier", "Waterloo-Cedar Falls Courier", "https://wcfcourier.com/search/?f=rss&t=article&c[]=obituaries/*"),
    RSSSource("quad_city_times", "Quad-City Times", "https://qctimes.com/search/?f=rss&t=article&c[]=obituaries/*"),
    RSSSource("sioux_city_journal", "Sioux City Journal", "https://siouxcityjournal.com/search/?f=rss&t=article&c[]=obituaries/*"),
    RSSSource("globe_gazette", "Globe Gazette", "https://globegazette.com/search/?f=rss&t=article&c[]=obituaries/*"),
]


def resolve_sources(source_ids: list[str]) -> list[RSSSource]:
    if not source_ids:
        return IOWA_RSS_SOURCES

    requested = set(source_ids)
    return [source for source in IOWA_RSS_SOURCES if source.source_id in requested]
