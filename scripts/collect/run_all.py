"""Orchestre toute la collecte du Saint-Graphique.

Enchaîne, de façon idempotente (ce qui est déjà fait est sauté) :

1. ``list_videos`` : inventaire et classement (avec le cache de métadonnées) ;
2. ``screen_transcripts`` (option ``--screen``) : dépistage par transcription ;
3. ``archive_web`` : archive du contenu public (sauf ``--skip-web``) ;
4. pour chaque vidéo core et mention, dans un ProcessPool (4 processus) :
   transcription, segments, puis captures pour les vidéos core.

Le journal de tous les processus va dans ``research/collect.log``. Si YouTube
bride, les appels sont suspendus puis la vidéo est remise à l'exécution suivante
(aucun contournement) ; relancer la commande reprend là où elle s'est arrêtée.

Usage :
    uv run python scripts/collect/run_all.py [--limit N] [--workers 4] [--screen]
"""

from __future__ import annotations

import argparse
import logging
import sys
from collections import Counter
from concurrent.futures import as_completed
from pathlib import Path
from typing import Any

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scripts.collect import find_chart_segments, list_videos  # noqa: E402
from scripts.collect.common import (  # noqa: E402
    MANIFEST_JSONL,
    Video,
    load_index,
    process_pool,
    read_jsonl,
    select_videos,
    setup_logging,
)

log = logging.getLogger("collect.run_all")


def process_one(video: Video, options: dict[str, Any]) -> dict[str, Any]:
    """Étapes 2 à 4 pour une vidéo (exécuté dans un processus du pool)."""
    from scripts.collect import fetch_transcripts

    vid = video["id"]
    report: dict[str, Any] = {"id": vid, "transcript": None, "segments": None, "captures": None}
    fields = fetch_transcripts.process_video(
        video, allow_whisper=not options["no_whisper"], whisper_threads=options["whisper_threads"]
    )
    if fields:
        video = {**video, **fields}
        report["transcript"] = fields["transcript_source"]
    segments = find_chart_segments.process_video(video)
    if segments is not None:
        video = {**video, "chart_segments": segments}
        report["segments"] = len(segments)
    if video.get("relevance") == "core" and not options["skip_frames"]:
        from scripts.collect import extract_frames

        state = extract_frames.process_video(
            video, threshold=options["threshold"], full_scan=options["full_scan"]
        )
        if state:
            report["captures"] = state["n_kept"]
    return report


def run_pool(videos: list[Video], workers: int, options: dict[str, Any], verbose: bool) -> Counter:
    """Traite les vidéos dans le pool ; une vidéo en échec n'arrête pas les autres."""
    counts: Counter[str] = Counter()
    with process_pool(workers, verbose) as pool:
        futures = {pool.submit(process_one, v, options): v["id"] for v in videos}
        for fut in as_completed(futures):
            vid = futures[fut]
            try:
                report = fut.result()
            except Exception:
                log.exception("%s : échec, à reprendre à la prochaine exécution", vid)
                counts["echecs"] += 1
                continue
            counts["traitees"] += 1
            if report["transcript"]:
                counts["transcriptions"] += 1
            if report["segments"] is not None:
                counts["segments"] += 1
            if report["captures"] is not None:
                counts["videos_capturees"] += 1
                counts["captures"] += report["captures"]
            log.info("%s : %s", vid, report)
    return counts


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--limit", type=int, default=None,
                    help="au plus N vidéos pour les étapes 2 à 4 (core avec « graphique » d'abord)")
    ap.add_argument("--workers", type=int, default=4, help="processus du pool (4)")
    ap.add_argument("--refresh-listings", action="store_true",
                    help="relance les listages à plat des chaînes et des recherches")
    ap.add_argument("--skip-listing", action="store_true",
                    help="saute l'étape 1 et utilise l'index existant")
    ap.add_argument("--screen", action="store_true",
                    help="dépiste aussi par transcription les vidéos écartées depuis 2025")
    ap.add_argument("--skip-web", action="store_true", help="saute l'archive web")
    ap.add_argument("--skip-frames", action="store_true", help="saute l'extraction des captures")
    ap.add_argument("--no-whisper", action="store_true", help="n'utilise jamais faster-whisper")
    ap.add_argument("--whisper-threads", type=int, default=4, help="threads de faster-whisper")
    ap.add_argument("--threshold", type=float, default=None,
                    help="chart_score minimal (défaut : valeur étalonnée d'extract_frames)")
    ap.add_argument("--no-full-scan", action="store_true",
                    help="n'échantillonne que les segments (pas de balayage à 10 s entre eux)")
    ap.add_argument("-v", "--verbose", action="store_true")
    return ap.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    setup_logging(args.verbose)
    log.info("début de la collecte : %s", vars(args))
    if not args.skip_listing:
        list_videos.run_step(refresh=args.refresh_listings)
    if args.screen:
        from scripts.collect import screen_transcripts

        screen_transcripts.run_step()
        list_videos.run_step(offline=True)
    if not args.skip_web:
        from scripts.collect import archive_web

        archive_web.run_step()

    threshold = args.threshold
    if threshold is None and not args.skip_frames:
        from scripts.collect.extract_frames import DEFAULT_THRESHOLD

        threshold = DEFAULT_THRESHOLD
    options = {
        "threshold": threshold, "skip_frames": args.skip_frames, "no_whisper": args.no_whisper,
        "whisper_threads": args.whisper_threads, "full_scan": not args.no_full_scan,
    }
    index = load_index()
    videos = select_videos(index, ("core", "mention"), limit=args.limit)
    log.info("%d vidéos à examiner (%d dans l'index)", len(videos), len(index))
    counts = run_pool(videos, args.workers, options, args.verbose)

    index = load_index()
    by_relevance = Counter(v.get("relevance") for v in index.values())
    n_transcripts = sum(1 for v in index.values() if v.get("transcript_path"))
    log.info("bilan de cette exécution : %s", dict(counts))
    log.info("état : %s, %d transcriptions, %d captures dans le manifeste", dict(by_relevance),
             n_transcripts, len(read_jsonl(MANIFEST_JSONL)))
    return 1 if counts["echecs"] else 0


if __name__ == "__main__":
    sys.exit(main())
