"""Tests for the Legacy.com collector and the KV-backed stores (prefetch + metrics).

KV access is exercised against an in-memory fake of `_command`, so no network."""

from __future__ import annotations

from src.collector import ObituaryRecord
from src.legacy_collector import LegacyObituaryCollector, _name_from_url


def _record(**overrides) -> ObituaryRecord:
    payload = {
        "source_id": "legacy_com",
        "source_label": "Legacy.com (Iowa)",
        "full_name": "Margaret Carlson",
        "obituary_url": "https://example.com/obituaries/margaret-carlson",
        "raw_text": "Margaret Carlson, 88, of Boone, Iowa.",
        "death_date": None,
        "city": "Boone",
        "state": "IA",
        "has_survivor_text": False,
        "out_of_state_heir_likely": False,
        "out_of_state_heir_states": [],
        "out_of_state_heir_evidence": None,
        "published_at": None,
    }
    payload.update(overrides)
    return ObituaryRecord(**payload)


class _Resp:
    def __init__(self, text: str) -> None:
        self.text = text

    def raise_for_status(self) -> None:
        return None


class _FakeSession:
    def __init__(self, mapping: dict) -> None:
        self.mapping = mapping

    def get(self, url, timeout=None):  # noqa: ARG002
        return _Resp(self.mapping[url])


def test_name_from_url_handles_funeral_home_and_legacy_slugs() -> None:
    assert _name_from_url("https://fh.example.com/obituaries/deborah-eide") == "Deborah Eide"
    assert _name_from_url("https://www.legacy.com/us/obituaries/name/angela-shaw-obituary?id=1") == "Angela Shaw"


def test_detail_links_resolves_relative_and_skips_region_links() -> None:
    listing = """
    <html><body>
      <a href="https://fh.example.com/obituaries/jane-doe">Jane Doe</a>
      <a href="/us/obituaries/name/john-smith-obituary?id=42">John Smith</a>
      <a href="/us/obituaries/local/iowa/ames">Ames region</a>
      <a href="/us/obituaries">section root</a>
      <a href="https://www.legacy.com/about">About</a>
    </body></html>
    """
    collector = LegacyObituaryCollector(session=_FakeSession({}))
    pairs = collector._detail_links(listing, "https://www.legacy.com/us/obituaries/local/iowa")
    urls = [url for _, url in pairs]
    names = [name for name, _ in pairs]
    assert "https://fh.example.com/obituaries/jane-doe" in urls
    # relative legacy link resolved to absolute
    assert "https://www.legacy.com/us/obituaries/name/john-smith-obituary?id=42" in urls
    # /local/ region link and the bare section root are skipped; non-obituary link excluded
    assert all("/local/" not in url for url in urls)
    assert "John Smith" in names and "Jane Doe" in names
    assert "About" not in names


def test_legacy_collect_builds_iowa_record() -> None:
    listing_url = "https://www.legacy.com/us/obituaries/local/iowa"
    detail_url = "https://fh.example.com/obituaries/margaret-carlson"
    listing_html = f'<html><body><a href="{detail_url}">Margaret Carlson</a></body></html>'
    detail_html = (
        "<html><body><p>Margaret Carlson, 88, of Boone, Iowa, passed away. "
        "She is survived by her daughter Susan. " + "Details. " * 20 + "</p></body></html>"
    )
    collector = LegacyObituaryCollector(
        pages=[listing_url],
        session=_FakeSession({listing_url: listing_html, detail_url: detail_html}),
    )
    records = collector.collect()
    assert len(records) == 1
    assert records[0].full_name == "Margaret Carlson"
    assert records[0].state == "IA"
    assert records[0].source_id == "legacy_com"


def _install_fake_kv(monkeypatch, module) -> dict:
    """Point a store module's `_command` at an in-memory dict and mark KV configured."""
    store: dict = {}

    def fake_command(command):
        op = command[0]
        if op == "SET":
            store[command[1]] = command[2]
            return {"result": "OK"}
        if op == "GET":
            return {"result": store.get(command[1])}
        return {}

    monkeypatch.setenv("KV_REST_API_URL", "http://kv.test")
    monkeypatch.setenv("KV_REST_API_TOKEN", "token")
    monkeypatch.setattr(module, "_command", fake_command)
    return store


def test_prefetch_store_roundtrip(monkeypatch) -> None:
    from src import prefetch_store

    _install_fake_kv(monkeypatch, prefetch_store)
    written = prefetch_store.write_prefetched([_record(), _record(full_name="Bob Lee")], collected_at="2026-05-27T00:00:00Z")
    assert written == 2
    out = prefetch_store.read_prefetched()
    assert {r.full_name for r in out} == {"Margaret Carlson", "Bob Lee"}


def test_metrics_store_roundtrip(monkeypatch) -> None:
    from src import metrics_store

    _install_fake_kv(monkeypatch, metrics_store)
    metrics_store.record_daily("2026-05-27", obituaries=12, by_source={"legacy_com": 12}, kind="run")
    # a backfill estimate must not clobber a real run entry for the same day
    metrics_store.record_daily("2026-05-27", obituaries=3, kind="backfill")
    metrics_store.record_daily("2026-05-26", obituaries=4, kind="backfill")
    data = metrics_store.read_all()
    assert data["2026-05-27"]["obituaries"] == 12
    assert data["2026-05-27"]["kind"] == "run"
    assert data["2026-05-26"]["obituaries"] == 4
