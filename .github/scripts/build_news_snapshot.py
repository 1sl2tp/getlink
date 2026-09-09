#!/usr/bin/env python3
"""Build a bounded hot-news snapshot without using a database.

The script calls GETLINK's public Edge RSS aggregator in the background,
enriches only the hottest/most visible items, and writes one replaceable JSON
snapshot. The publishing workflow force-replaces the news-cache branch, so no
news history is retained in the application database or Git history.
"""
from __future__ import annotations

import argparse
import concurrent.futures
import datetime as dt
import json
import math
import pathlib
import re
import time
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[2]
CONFIG = ROOT / "config.js"
DEFAULT_LIMIT = 100
DETAIL_LIMIT = 24
HTTP_TIMEOUT = 18
DETAIL_TIMEOUT = 12


def api_config() -> tuple[str, str]:
    text = CONFIG.read_text("utf-8")
    base = re.search(r'GETLINK_API_BASE\s*=\s*"([^"]+)"', text)
    key = re.search(r'GETLINK_API_KEY\s*=\s*"([^"]+)"', text)
    if not base:
        raise SystemExit("GETLINK_API_BASE not found in config.js")
    return base.group(1).rstrip("/"), (key.group(1) if key else "")


def fetch_json(url: str, timeout: int = HTTP_TIMEOUT, api_key: str = "") -> dict:
    headers = {
        "Accept": "application/json",
        "User-Agent": "GETLINK-News-Snapshot/1.0",
        "Cache-Control": "no-cache",
    }
    if api_key:
        headers["apikey"] = api_key
    req = urllib.request.Request(
        url,
        headers=headers,
    )
    with urllib.request.urlopen(req, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def parse_time(value: str) -> dt.datetime:
    text = str(value or "").strip()
    if not text:
        return dt.datetime.fromtimestamp(0, dt.timezone.utc)
    try:
        parsed = dt.datetime.fromisoformat(text.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=dt.timezone.utc)
        return parsed.astimezone(dt.timezone.utc)
    except ValueError:
        return dt.datetime.fromtimestamp(0, dt.timezone.utc)


def unique_images(item: dict) -> list[str]:
    values = []
    for value in [item.get("image"), *(item.get("images") or [])]:
        url = str(value or "").strip()
        if url.startswith(("http://", "https://")) and url not in values:
            values.append(url)
    return values[:8]


def hot_score(item: dict, now: dt.datetime) -> float:
    published = parse_time(item.get("published_at", ""))
    age_min = max(0.0, (now - published).total_seconds() / 60.0)
    freshness = max(0.0, 420.0 - age_min)
    duplicate_boost = min(6, max(1, int(item.get("duplicate_count") or 1))) * 32.0
    image_boost = min(4, len(unique_images(item))) * 7.0
    content_boost = min(24.0, len(str(item.get("content") or "")) / 180.0)
    return round(freshness + duplicate_boost + image_boost + content_boost, 3)


def needs_detail(item: dict) -> bool:
    return len(unique_images(item)) == 0 or len(str(item.get("content") or "")) < 450


def enrich_one(base: str, api_key: str, item: dict) -> dict:
    url = str(item.get("url") or "").strip()
    if not url:
        return item
    detail_url = base + "/api/news-detail?url=" + urllib.parse.quote(url, safe="")
    try:
        detail = fetch_json(detail_url, DETAIL_TIMEOUT, api_key)
    except Exception:
        return item

    merged = dict(item)
    detail_images = [
        str(x).strip()
        for x in (detail.get("images") or [])
        if str(x).strip().startswith(("http://", "https://"))
    ]
    images = []
    for value in [*detail_images, *unique_images(item)]:
        if value and value not in images:
            images.append(value)
    if images:
        merged["image"] = images[0]
        merged["images"] = images[:8]

    detail_content = str(detail.get("content") or "").strip()
    if len(detail_content) > len(str(merged.get("content") or "")):
        merged["content"] = detail_content[:10000]
    if detail.get("url"):
        merged["url"] = detail["url"]
    return merged


def compact(item: dict, now: dt.datetime) -> dict:
    images = unique_images(item)
    return {
        "id": str(item.get("id") or ""),
        "title": str(item.get("title") or "").strip(),
        "summary": str(item.get("summary") or "").strip()[:600],
        "content": str(item.get("content") or "").strip()[:10000],
        "url": str(item.get("url") or "").strip(),
        "image": images[0] if images else "",
        "images": images,
        "published_at": str(item.get("published_at") or ""),
        "source_key": str(item.get("source_key") or ""),
        "source_name": str(item.get("source_name") or ""),
        "topic": "latest",
        "duplicate_count": max(1, int(item.get("duplicate_count") or 1)),
        "also_sources": [],
        "hot_score": hot_score(item, now),
    }


def build_snapshot(limit: int = DEFAULT_LIMIT) -> dict:
    base, api_key = api_config()
    url = base + f"/api/news?topic=latest&source=all&limit={limit}&refresh=1"
    payload = fetch_json(url, api_key=api_key)
    items = list(payload.get("items") or [])
    now = dt.datetime.now(dt.timezone.utc)

    items.sort(
        key=lambda item: (
            hot_score(item, now),
            parse_time(item.get("published_at", "")).timestamp(),
        ),
        reverse=True,
    )

    candidates = [item for item in items[:DETAIL_LIMIT] if needs_detail(item)]
    if candidates:
        index_by_id = {str(item.get("id") or ""): index for index, item in enumerate(items)}
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            future_map = {
                pool.submit(enrich_one, base, api_key, item): str(item.get("id") or "")
                for item in candidates
            }
            for future in concurrent.futures.as_completed(future_map):
                item_id = future_map[future]
                try:
                    enriched = future.result()
                except Exception:
                    continue
                index = index_by_id.get(item_id)
                if index is not None:
                    items[index] = enriched

    # Re-rank after image/content enrichment. Hotness strongly values freshness,
    # then multi-source duplication, then image/content quality.
    items.sort(
        key=lambda item: (
            hot_score(item, now),
            parse_time(item.get("published_at", "")).timestamp(),
        ),
        reverse=True,
    )

    compact_items = [compact(item, now) for item in items[:limit] if item.get("title") and item.get("url")]
    newest = max((parse_time(item.get("published_at", "")) for item in compact_items), default=now)
    age_seconds = max(0, int((now - newest).total_seconds()))
    return {
        "version": 1,
        "generated_at": now.isoformat().replace("+00:00", "Z"),
        "newest_published_at": newest.isoformat().replace("+00:00", "Z"),
        "newest_age_seconds": age_seconds,
        "strategy": "background-hot-snapshot",
        "storage": "git-ephemeral-branch",
        "database": False,
        "items": compact_items,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    parser.add_argument("--limit", type=int, default=DEFAULT_LIMIT)
    args = parser.parse_args()

    output = pathlib.Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    snapshot = build_snapshot(max(20, min(100, args.limit)))
    output.write_text(
        json.dumps(snapshot, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )
    print(
        "GETLINK hot-news snapshot",
        f"items={len(snapshot['items'])}",
        f"newest_age_seconds={snapshot['newest_age_seconds']}",
        f"output={output}",
    )


if __name__ == "__main__":
    main()
