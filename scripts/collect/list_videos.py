"""Étape 1 : inventaire des vidéos YouTube liées au Saint-Graphique.

1. Liste à plat (``yt-dlp --flat-playlist -J``) les onglets vidéos et streams des
   chaînes @Positions_revue et @PaduTeam, la playlist PaduTeam « Le Graphique de
   Positions Revue » (citée par le README de JnthnBS/saint-graphique et par les
   descriptions de la PaduTeam) et des recherches ``ytsearchN:``. Les listes sont
   mises en cache dans ``research/index/cache/listings/``.
2. Récupère les métadonnées complètes de chaque candidate
   (``yt-dlp -J --skip-download``). Une version allégée (sans formats) est mise
   en cache dans ``research/index/cache/meta/<id>.json`` : une vidéo déjà
   décrite n'est pas redemandée (reprise).
3. Classe la pertinence par mots-clés dans le titre et la description
   (:func:`scripts.collect.pure.classify`), après suppression des lignes
   récurrentes des descriptions d'une même chaîne (la PaduTeam ajoute par
   exemple « Playlist sur le Graphique : … » à ses vidéos) : ``core``,
   ``mention`` ou ``unrelated``.
4. Relève la pertinence d'après le dépistage par transcription
   (``screen_transcripts.py``), s'il a eu lieu.
5. Écrit ``research/index/videos.jsonl`` (core et mention seulement) en
   conservant les champs produits par les étapes suivantes.

Les appels à YouTube sont espacés (``SG_YTDLP_MIN_INTERVAL``, 2 s par défaut)
et suspendus en cas de bridage (HTTP 429 / « not a bot ») : la reprise se fait
à l'exécution suivante grâce au cache.

Usage :
    uv run python scripts/collect/list_videos.py [--refresh-listings] [--workers 4]
    uv run python scripts/collect/list_videos.py --offline   # reclasse depuis le cache
"""

from __future__ import annotations

import argparse
import json
import logging
import re
import sys
import threading
import time
from collections import Counter
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scripts.collect.common import (  # noqa: E402
    LISTING_CACHE_DIR,
    META_CACHE_DIR,
    SCREENING_JSON,
    VIDEOS_JSONL,
    Video,
    YouTubeBlocked,
    file_lock,
    is_throttled,
    load_index,
    mark_blocked,
    read_json,
    save_index,
    setup_logging,
    stderr_tail,
    video_url,
    write_json_atomic,
    ytdlp,
)
from scripts.collect.pure import (  # noqa: E402
    boilerplate_lines,
    classify,
    extract_links,
    is_complete_meta,
    strip_boilerplate,
    upgrade_relevance,
)

log = logging.getLogger("collect.list_videos")


@dataclass(frozen=True)
class Source:
    """Une source de vidéos candidates (onglet de chaîne, playlist ou recherche)."""

    label: str
    url: str
    curated: bool = False  # playlist consacrée au graphique : appartenance => core
    signal: bool = False  # recherche sans nom de chaîne : y figurer est un indice


DEFAULT_SOURCES: tuple[Source, ...] = (
    Source("positions:videos", "https://www.youtube.com/@Positions_revue/videos"),
    Source("positions:streams", "https://www.youtube.com/@Positions_revue/streams"),
    Source("paduteam:videos", "https://www.youtube.com/@PaduTeam/videos"),
    Source("paduteam:streams", "https://www.youtube.com/@PaduTeam/streams"),
    Source(
        "playlist:le-graphique-de-positions-revue",
        "https://www.youtube.com/playlist?list=PLrY3xxT4nd05ZRw9tEIVexgLwZ0taXOzl",
        curated=True,
    ),
    Source("search:saint-graphique", "ytsearch40:saint graphique", signal=True),
    Source("search:saint-graphique-paduteam", "ytsearch30:saint graphique paduteam"),
    Source("search:positions-revue-pcs-electorat", "ytsearch20:positions revue PCS électorat"),
)

VIDEO_ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")

# Champs conservés dans le cache de métadonnées (les formats, très volumineux, sont omis).
META_FIELDS = (
    "id", "title", "fulltitle", "channel", "channel_id", "uploader", "uploader_id",
    "upload_date", "timestamp", "release_timestamp", "description", "duration",
    "webpage_url", "tags", "categories", "language", "view_count", "live_status",
    "was_live", "availability", "chapters",
)
PERMANENT_ERRORS = (
    "Private video", "Video unavailable", "This video is unavailable", "members-only",
    "Join this channel", "has been removed", "confirm your age", "This live event will begin",
    "Premieres in", "not available in your country",
)


def _now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


def _slug(label: str) -> str:
    return re.sub(r"[^A-Za-z0-9_.-]+", "_", label)


# --------------------------------------------------------------------------- yt-dlp


def iter_flat_entries(node: dict[str, Any]) -> Iterator[dict[str, Any]]:
    """Entrées vidéo d'un résultat ``--flat-playlist -J`` (sous-listes aplaties)."""
    for entry in node.get("entries") or []:
        if not entry:
            continue
        if entry.get("entries") is not None:
            yield from iter_flat_entries(entry)
        elif entry.get("ie_key") in (None, "Youtube") and VIDEO_ID_RE.match(entry.get("id") or ""):
            yield entry


def flat_listing(
    source: Source, refresh: bool = False, offline: bool = False
) -> list[dict[str, Any]]:
    """Liste à plat d'une source, depuis le cache sauf ``refresh``."""
    cache = LISTING_CACHE_DIR / f"{_slug(source.label)}.json"
    cached = read_json(cache)
    if cached is not None and (not refresh or offline):
        return cached["entries"]
    if offline:
        log.warning("%s : pas de liste en cache (mode hors ligne)", source.label)
        return []
    try:
        proc = ytdlp(["--flat-playlist", "-J", source.url], timeout=900, max_wait=1800)
    except YouTubeBlocked as exc:
        log.warning("%s : %s, liste en cache conservée", source.label, exc)
        return cached["entries"] if cached else []
    note = None
    if proc.returncode != 0:
        err = stderr_tail(proc)
        if "does not have a" in err:  # onglet inexistant (ex. pas de streams)
            note = err.strip().splitlines()[-1]
            log.info("%s : onglet absent (%s)", source.label, note)
            entries: list[dict[str, Any]] = []
        else:
            log.warning("%s : échec du listage : %s", source.label, err)
            return cached["entries"] if cached else []
    else:
        data = json.loads(proc.stdout.decode("utf-8"))
        entries = [
            {
                "id": e["id"],
                "title": e.get("title") or "",
                "duration": e.get("duration"),
                "channel": e.get("channel") or data.get("channel"),
            }
            for e in iter_flat_entries(data)
        ]
        log.info("%s : %d vidéos listées", source.label, len(entries))
    write_json_atomic(
        cache,
        {"label": source.label, "url": source.url, "fetched_at": _now(), "note": note,
         "entries": entries},
    )
    return entries


def slim_meta(info: dict[str, Any]) -> dict[str, Any]:
    """Métadonnées utiles d'un ``yt-dlp -J`` (sans formats ni URL de sous-titres)."""
    meta = {k: info.get(k) for k in META_FIELDS}
    subs = info.get("subtitles") or {}
    autos = info.get("automatic_captions") or {}
    meta["subtitle_langs"] = sorted(k for k in subs if k != "live_chat")
    meta["auto_caption_langs"] = sorted(
        k for k in autos if k.startswith("fr") or k.endswith("-orig")
    )
    meta["fetched_at"] = _now()
    return meta


class MetaFetcher:
    """Récupère et met en cache les métadonnées complètes.

    Les appels passent par :func:`scripts.collect.common.ytdlp` (espacés, pause
    commune si YouTube bride) ; après ``max_throttle`` refus ou une pause plus
    longue que ``max_wait`` secondes, le reste est remis à une exécution ultérieure.
    """

    def __init__(self, retries: int = 3, max_throttle: int = 3, max_wait: float = 1800) -> None:
        self.retries = retries
        self.max_throttle = max_throttle
        self.max_wait = max_wait
        self._throttled = 0
        self._lock = threading.Lock()
        self.stopped = threading.Event()

    def _note_throttled(self) -> None:
        with self._lock:
            self._throttled += 1
            if self._throttled >= self.max_throttle:
                log.error("YouTube bride les requêtes : arrêt des métadonnées")
                self.stopped.set()

    def __call__(self, video_id: str) -> dict[str, Any] | None:
        path = META_CACHE_DIR / f"{video_id}.json"
        for attempt in range(1, self.retries + 1):
            if self.stopped.is_set():
                return None
            try:
                proc = ytdlp(
                    ["-J", "--skip-download", "--ignore-no-formats-error", video_url(video_id)],
                    timeout=300, max_wait=self.max_wait,
                )
            except YouTubeBlocked as exc:
                log.error("métadonnées interrompues : %s", exc)
                self.stopped.set()
                return None
            if proc.returncode == 0 and proc.stdout.strip():
                info = json.loads(proc.stdout.decode("utf-8"))
                meta = slim_meta(info)
                if is_complete_meta(meta) or info.get("formats"):
                    write_json_atomic(path, meta)
                    return meta
                # Lecteur refusé : réponse partielle qu'il ne faut pas mettre en cache.
                log.warning("%s : réponse incomplète (YouTube bride ?)", video_id)
                mark_blocked()
                self._note_throttled()
                continue
            err = stderr_tail(proc)
            if is_throttled(proc):
                self._note_throttled()
                continue
            if any(s in err for s in PERMANENT_ERRORS):
                last = err.strip().splitlines()[-1] if err.strip() else "erreur"
                log.warning("%s : indisponible (%s)", video_id, last)
                meta = {"id": video_id, "error": last, "fetched_at": _now()}
                write_json_atomic(path, meta)
                return meta
            log.warning("%s : échec des métadonnées (essai %d/%d) : %s",
                        video_id, attempt, self.retries, err[-300:])
            time.sleep(3 * attempt)
        return None


# --------------------------------------------------------------------------- principal


def collect_candidates(
    sources: list[Source], refresh: bool, offline: bool
) -> dict[str, dict[str, Any]]:
    """Fusionne les listes à plat : ``{id: {flat_title, channel, found_in, curated}}``."""
    candidates: dict[str, dict[str, Any]] = {}
    for src in sources:
        for e in flat_listing(src, refresh=refresh, offline=offline):
            c = candidates.setdefault(
                e["id"],
                {"id": e["id"], "flat_title": e.get("title") or "", "channel": e.get("channel"),
                 "found_in": [], "curated": False, "search_hit": False},
            )
            if src.label not in c["found_in"]:
                c["found_in"].append(src.label)
            c["curated"] = c["curated"] or src.curated
            c["search_hit"] = c["search_hit"] or src.signal
    return candidates


def channel_key(meta: dict[str, Any]) -> str:
    """Clé de chaîne stable (``channel_id`` manque parfois dans les réponses de yt-dlp)."""
    return meta.get("uploader_id") or meta.get("channel") or meta.get("channel_id") or "?"


def fetch_all_meta(
    ids: list[str], workers: int, retry_errors: bool, max_fetch: int | None
) -> None:
    """Complète le cache de métadonnées (requêtes yt-dlp en parallèle)."""
    todo = []
    for vid in ids:
        cached = read_json(META_CACHE_DIR / f"{vid}.json")
        if cached is None or not is_complete_meta(cached) or (retry_errors and "error" in cached):
            todo.append(vid)
    n_cached = len(ids) - len(todo)
    if max_fetch is not None:
        todo = todo[:max_fetch]
    log.info("métadonnées : %d en cache, %d à récupérer", n_cached, len(todo))
    if not todo:
        return
    fetcher = MetaFetcher()
    t0 = time.monotonic()
    done = 0
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = [pool.submit(fetcher, vid) for vid in todo]
        for fut in as_completed(futures):
            fut.result()
            done += 1
            if done % 50 == 0 or done == len(todo):
                log.info("métadonnées : %d/%d (%.0f s)", done, len(todo), time.monotonic() - t0)


def build_records(
    candidates: dict[str, dict[str, Any]], previous: dict[str, Video]
) -> tuple[list[Video], Counter[str]]:
    """Classe les candidates et construit les lignes de l'index (core + mention)."""
    metas: dict[str, dict[str, Any]] = {}
    for vid in candidates:
        meta = read_json(META_CACHE_DIR / f"{vid}.json")
        if meta is not None and "error" not in meta:
            metas[vid] = meta
    # Lignes récurrentes des descriptions, par chaîne.
    by_channel: dict[str, list[str]] = {}
    for meta in metas.values():
        by_channel.setdefault(channel_key(meta), []).append(meta.get("description") or "")
    boiler = {k: boilerplate_lines(v) for k, v in by_channel.items()}

    screening: dict[str, dict[str, Any]] = read_json(SCREENING_JSON) or {}
    counts: Counter[str] = Counter()
    records: list[Video] = []
    for vid, cand in candidates.items():
        meta = metas.get(vid)
        if meta is None:
            counts["sans_metadonnees"] += 1
            continue
        desc = meta.get("description") or ""
        relevance, terms = classify(
            meta.get("title") or cand["flat_title"],
            strip_boilerplate(desc, boiler.get(channel_key(meta), set())),
            meta.get("channel") or cand.get("channel"),
            curated=cand["curated"],
            tags=meta.get("tags") or (),
            search_hit=cand.get("search_hit", False),
        )
        screened = screening.get(vid) or {}
        if screened.get("relevance"):
            relevance = upgrade_relevance(relevance, screened["relevance"])
            terms.append(f"transcription:graphique×{screened.get('graphique', 0)}")
        counts[relevance] += 1
        if relevance == "unrelated":
            continue
        prev = previous.get(vid, {})
        rec: Video = {
            "id": vid,
            "title": meta.get("title") or cand["flat_title"],
            "channel": meta.get("channel") or cand.get("channel") or "",
            "upload_date": meta.get("upload_date") or "",
            "url": video_url(vid),
            "relevance": relevance,
            "relevance_terms": terms,
            "found_in": cand["found_in"],
            "description": desc,
            "links": extract_links(desc),
            "transcript_path": prev.get("transcript_path"),
            "transcript_source": prev.get("transcript_source"),
        }
        if meta.get("duration") is not None:
            rec["duration_s"] = meta["duration"]
        if "chart_segments" in prev:
            rec["chart_segments"] = prev["chart_segments"]
        records.append(rec)
    return records, counts


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--refresh-listings", action="store_true",
                    help="relance les listages à plat même s'ils sont en cache")
    ap.add_argument("--offline", action="store_true",
                    help="n'interroge pas YouTube : reclasse depuis le cache")
    ap.add_argument("--workers", type=int, default=4,
                    help="requêtes yt-dlp parallèles (4 ; voir aussi SG_YTDLP_MIN_INTERVAL)")
    ap.add_argument("--retry-errors", action="store_true",
                    help="redemande les vidéos marquées indisponibles")
    ap.add_argument("--max-fetch", type=int, default=None,
                    help="nombre maximal de métadonnées à récupérer (essais)")
    ap.add_argument("--extra", action="append", default=[], metavar="URL",
                    help="source supplémentaire (playlist, chaîne ou ytsearchN:...)")
    ap.add_argument("-v", "--verbose", action="store_true")
    return ap.parse_args(argv)


def run_step(
    refresh: bool = False, offline: bool = False, workers: int = 4, retry_errors: bool = False,
    max_fetch: int | None = None, extra: list[str] | None = None,
) -> Counter[str]:
    """Exécute l'étape 1 complète et renvoie le décompte par pertinence."""
    sources = list(DEFAULT_SOURCES) + [Source(f"extra:{u}", u) for u in extra or []]
    candidates = collect_candidates(sources, refresh=refresh, offline=offline)
    log.info("%d vidéos candidates (toutes sources)", len(candidates))
    if not offline:
        fetch_all_meta(list(candidates), workers, retry_errors, max_fetch)
    with file_lock(VIDEOS_JSONL):
        records, counts = build_records(candidates, load_index())
        save_index(records)
    log.info(
        "index écrit : %d core, %d mention (%d unrelated écartées, %d sans métadonnées) -> %s",
        counts["core"], counts["mention"], counts["unrelated"], counts["sans_metadonnees"],
        VIDEOS_JSONL,
    )
    return counts


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    setup_logging(args.verbose)
    run_step(args.refresh_listings, args.offline, args.workers, args.retry_errors,
             args.max_fetch, args.extra)
    return 0


if __name__ == "__main__":
    sys.exit(main())
