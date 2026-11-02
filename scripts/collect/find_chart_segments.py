"""Étape 3 : repérage des passages où le graphique est commenté.

Lit ``research/transcripts/<id>.txt`` de chaque vidéo transcrite (core et
mention), y cherche les mots-clés du commentaire du graphique (graphique, axe,
abscisse, ordonnée, domination, exploitation, barycentre, PCS, cadres,
ouvriers, retraités, électorat, exécutants, « en haut à droite »…), regroupe
les occurrences proches en fenêtres pondérées, ajoute une marge de ±20 s,
fusionne les fenêtres proches et écrit ``chart_segments`` dans l'index
(voir :func:`scripts.collect.pure.chart_segments`).

Reprise : une vidéo qui a déjà ``chart_segments`` est sautée (sauf ``--force``).

Usage :
    uv run python scripts/collect/find_chart_segments.py [--limit N] [--force]
"""

from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path
from typing import Any

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scripts.collect.common import (  # noqa: E402
    TRANSCRIPTS_DIR,
    Video,
    load_index,
    select_videos,
    setup_logging,
    update_index,
)
from scripts.collect.pure import Segment, chart_segments, parse_transcript  # noqa: E402

log = logging.getLogger("collect.segments")

DEFAULT_PARAMS: dict[str, Any] = {
    "margin": 20.0,
    "max_gap": 60.0,
    "merge_gap": 30.0,
    "min_score": 4,
    "strong_score": 8,
}


def compute_segments(video: Video, **params: Any) -> list[Segment] | None:
    """Segments d'une vidéo d'après sa transcription (``None`` si pas de transcription)."""
    path = TRANSCRIPTS_DIR / f"{video['id']}.txt"
    if not path.exists():
        return None
    lines = parse_transcript(path.read_text(encoding="utf-8"))
    return chart_segments(lines, duration=video.get("duration_s"), **{**DEFAULT_PARAMS, **params})


def process_video(video: Video, force: bool = False, **params: Any) -> list[Segment] | None:
    """Calcule et enregistre ``chart_segments`` d'une vidéo (``None`` si sauté)."""
    if "chart_segments" in video and not force:
        return None
    segments = compute_segments(video, **params)
    if segments is None:
        return None
    update_index({video["id"]: {"chart_segments": segments}})
    covered = sum(s["end_s"] - s["start_s"] for s in segments)
    log.info("%s : %d segment(s), %.0f s couvertes", video["id"], len(segments), covered)
    return segments


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument("--ids", nargs="*", help="restreint à ces identifiants de vidéo")
    ap.add_argument("--limit", type=int, default=None, help="au plus N vidéos (par priorité)")
    ap.add_argument("--force", action="store_true", help="recalcule les segments existants")
    ap.add_argument(
        "--margin",
        type=float,
        default=DEFAULT_PARAMS["margin"],
        help="marge ajoutée de part et d'autre (20 s)",
    )
    ap.add_argument(
        "--max-gap",
        type=float,
        default=DEFAULT_PARAMS["max_gap"],
        help="écart maximal entre deux mots-clés d'une même fenêtre (60 s)",
    )
    ap.add_argument(
        "--merge-gap",
        type=float,
        default=DEFAULT_PARAMS["merge_gap"],
        help="fusion des fenêtres séparées de moins de (30 s)",
    )
    ap.add_argument(
        "--min-score",
        type=int,
        default=DEFAULT_PARAMS["min_score"],
        help="poids minimal d'une fenêtre ancrée (4)",
    )
    ap.add_argument("-v", "--verbose", action="store_true")
    return ap.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    setup_logging(args.verbose)
    params = {
        "margin": args.margin,
        "max_gap": args.max_gap,
        "merge_gap": args.merge_gap,
        "min_score": args.min_score,
    }
    videos = select_videos(load_index(), ("core", "mention"), args.ids, args.limit)
    updates: dict[str, dict[str, Any]] = {}
    for video in videos:
        if "chart_segments" in video and not args.force:
            continue
        segments = compute_segments(video, **params)
        if segments is None:
            log.info("%s : pas de transcription, ignorée", video["id"])
            continue
        updates[video["id"]] = {"chart_segments": segments}
        covered = sum(s["end_s"] - s["start_s"] for s in segments)
        log.info("%s : %d segment(s), %.0f s couvertes", video["id"], len(segments), covered)
    update_index(updates)
    log.info("segments : %d vidéo(s) mises à jour", len(updates))
    return 0


if __name__ == "__main__":
    sys.exit(main())
