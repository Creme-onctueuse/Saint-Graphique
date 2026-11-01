"""Étape 2 bis : dépistage des vidéos que le filtre de mots-clés a pu manquer.

Le titre et la description ne disent pas toujours que le graphique est utilisé.
Ce script lit donc ce qui est *dit* dans les vidéos PaduTeam / Positions publiées
depuis l'apparition du graphique (janvier 2025) et absentes de l'index comme
``core`` : il télécharge leurs sous-titres français (jamais whisper, trop coûteux
à cette échelle), compte les « graphique » prononcés et note le résultat dans
``research/index/cache/screening.json``. ``list_videos.py`` relit ce fichier et
relève la pertinence (voir :func:`scripts.collect.pure.screening_relevance`).

Les sous-titres téléchargés restent dans ``research/transcripts/`` : le seuil peut
être réétalonné sans rien redemander. Reprise : une vidéo déjà dépistée n'est pas
redemandée.
Le dépistage s'arrête si YouTube bride, et reprend à l'exécution suivante.

Usage :
    uv run python scripts/collect/screen_transcripts.py [--limit N] [--workers 3]
"""

from __future__ import annotations

import argparse
import logging
import sys
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scripts.collect.common import (  # noqa: E402
    META_CACHE_DIR,
    SCREENING_JSON,
    file_lock,
    load_index,
    read_json,
    setup_logging,
    write_json_atomic,
)
from scripts.collect.fetch_transcripts import (  # noqa: E402
    download_subtitle,
    subtitle_file_to_lines,
)
from scripts.collect.pure import (  # noqa: E402
    choose_subtitle,
    is_complete_meta,
    is_own_channel,
    screening_relevance,
    spoken_signal,
)

log = logging.getLogger("collect.screening")

GRAPH_START = "20250101"  # première vidéo de la playlist du graphique : 7 janvier 2025
MIN_DURATION_S = 300.0


def candidates(screened: dict[str, Any]) -> tuple[list[dict[str, Any]], int]:
    """Vidéos à dépister (les plus récentes d'abord) et nombre de fiches incomplètes."""
    index = load_index()
    out: list[dict[str, Any]] = []
    incomplete = 0
    for path in META_CACHE_DIR.glob("*.json"):
        meta = read_json(path)
        if not meta or "error" in meta or meta["id"] in screened:
            continue
        if not is_own_channel(meta.get("channel")):
            continue
        if (meta.get("upload_date") or "0") < GRAPH_START:
            continue
        if index.get(meta["id"], {}).get("relevance") == "core":
            continue
        if not is_complete_meta(meta):
            incomplete += 1
            continue
        if (meta.get("duration") or 0) < MIN_DURATION_S:
            continue
        out.append(meta)
    out.sort(key=lambda m: m.get("upload_date") or "", reverse=True)
    return out, incomplete


def _store(video_id: str, result: dict[str, Any]) -> None:
    with file_lock(SCREENING_JSON):
        data = read_json(SCREENING_JSON) or {}
        data[video_id] = result
        write_json_atomic(SCREENING_JSON, data)


def screen_video(meta: dict[str, Any], stop: threading.Event) -> dict[str, Any] | None:
    """Dépiste une vidéo ; ``None`` si le résultat doit être redemandé plus tard."""
    if stop.is_set():
        return None
    vid = meta["id"]
    choice = choose_subtitle(meta)
    if choice is None:
        result: dict[str, Any] = {"upload_date": meta.get("upload_date"), "no_subtitles": True,
                                  "relevance": None}
        _store(vid, result)
        return result
    lang, kind = choice
    path = download_subtitle(vid, lang, kind, attempts=1, max_wait=0)
    if path is None:
        return None
    signal = spoken_signal(subtitle_file_to_lines(path))
    relevance = screening_relevance(signal)
    result = {"upload_date": meta.get("upload_date"), "duration_s": meta.get("duration"),
              "title": (meta.get("title") or "")[:100], **signal, "relevance": relevance}
    _store(vid, result)
    return result


def run_step(limit: int | None = None, workers: int = 3, max_failures: int = 5) -> dict[str, int]:
    """Dépiste les candidates et renvoie les décomptes de cette exécution."""
    screened = read_json(SCREENING_JSON) or {}
    todo, incomplete = candidates(screened)
    if limit:
        todo = todo[:limit]
    log.info("dépistage : %d déjà faites, %d à faire, %d fiches incomplètes écartées",
             len(screened), len(todo), incomplete)
    counts = {"core": 0, "mention": 0, "aucun": 0, "sans_sous_titres": 0, "reporte": 0}
    stop = threading.Event()
    failures = 0
    with ThreadPoolExecutor(max_workers=max(1, workers)) as pool:
        futures = {pool.submit(screen_video, m, stop): m["id"] for m in todo}
        for done, fut in enumerate(as_completed(futures), 1):
            try:
                result = fut.result()
            except Exception:
                log.exception("%s : échec du dépistage", futures[fut])
                result = None
            if result is None:
                counts["reporte"] += 1
                failures += 1
                if failures >= max_failures and not stop.is_set():
                    log.error("dépistage interrompu après %d échecs (YouTube bride ?)", failures)
                    stop.set()
            else:
                failures = 0
                if result.get("no_subtitles"):
                    counts["sans_sous_titres"] += 1
                else:
                    counts[result.get("relevance") or "aucun"] += 1
            if done % 50 == 0:
                log.info("dépistage : %d/%d %s", done, len(todo), counts)
    log.info("dépistage terminé : %s", counts)
    return counts


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--limit", type=int, default=None, help="au plus N vidéos (les plus récentes)")
    ap.add_argument("--workers", type=int, default=3, help="téléchargements parallèles (3)")
    ap.add_argument("-v", "--verbose", action="store_true")
    return ap.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    setup_logging(args.verbose)
    run_step(args.limit, args.workers)
    return 0


if __name__ == "__main__":
    sys.exit(main())
