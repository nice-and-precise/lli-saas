from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class RSSSource:
    source_id: str
    label: str
    feed_url: str
    always_fetch_full_page: bool = False


# Iowa obituary RSS sources, each verified live (returning <item>s) via curl_cffi
# Chrome-impersonation probing on 2026-05-26. The Lee Enterprises BLOX search
# feeds 429 a default user-agent but return 200 under TLS impersonation (see
# collector). Two formerly-listed feeds were removed because their URLs now 404:
# the_gazette (moved to a Legacy.com domain with no clean RSS) and nw_iowa_now.
# This list is an operational item — feeds rot; re-probe periodically.
IOWA_RSS_SOURCES = [
    # Lee Enterprises metro dailies (BLOX search RSS)
    RSSSource("waterloo_courier", "Waterloo-Cedar Falls Courier", "https://wcfcourier.com/search/?f=rss&t=article&c[]=obituaries/*"),
    RSSSource("quad_city_times", "Quad-City Times", "https://qctimes.com/search/?f=rss&t=article&c[]=obituaries/*"),
    RSSSource("sioux_city_journal", "Sioux City Journal", "https://siouxcityjournal.com/search/?f=rss&t=article&c[]=obituaries/*"),
    RSSSource("globe_gazette", "Globe Gazette (Mason City)", "https://globegazette.com/search/?f=rss&t=article&c[]=obituaries/*"),
    RSSSource("muscatine_journal", "Muscatine Journal", "https://muscatinejournal.com/search/?f=rss&t=article&c[]=obituaries/*"),
    # Regional radio / community-news WordPress obituary feeds
    RSSSource("kcim_carroll", "Carroll Broadcasting (1380 KCIM)", "https://1380kcim.com/category/obituaries/feed/"),
    RSSSource("kcha_charles_city", "KCHA News (Charles City)", "https://kchanews.com/category/obituaries/feed/"),
    RSSSource("kilj_mt_pleasant", "KILJ (Mt. Pleasant)", "https://kilj.com/category/obituaries/feed/"),
    RSSSource("times_republican_marshalltown", "Times-Republican (Marshalltown)", "https://www.timesrepublican.com/category/obituaries/feed/"),
    RSSSource("my_iowa_info", "My Iowa Info", "https://www.myiowainfo.com/category/obituaries/feed/"),
    # Smaller radio feeds — valid endpoints, often low-volume (kept for breadth)
    RSSSource("kwbg_boone", "KWBG Radio (Boone)", "https://kwbg.com/category/obituaries/feed/"),
    RSSSource("kjan_atlantic", "KJAN Radio (Atlantic)", "https://www.kjan.com/index.php/category/obituaries/feed/"),
]


def resolve_sources(source_ids: list[str]) -> list[RSSSource]:
    if not source_ids:
        return IOWA_RSS_SOURCES

    requested = set(source_ids)
    return [source for source in IOWA_RSS_SOURCES if source.source_id in requested]
