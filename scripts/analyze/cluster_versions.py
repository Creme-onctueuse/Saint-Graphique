"""Regroupe les captures par similarité et date pour repérer les versions du graphique.

Lit ``research/captures/manifest.jsonl``, garde les captures au-dessus d'un seuil de
``chart_score``, puis les regroupe par lien simple sur le pHash, sous contrainte de
date. Écrit le résumé en JSON et peut produire des planches-contacts à inspecter
(à garder hors dépôt : ces planches contiennent des images protégées).

Usage :
    uv run python scripts/analyze/cluster_versions.py --min-score 0.6
    uv run python scripts/analyze/cluster_versions.py --sheets DOSSIER --per-video 12
    uv run python scripts/analyze/cluster_versions.py --sheets DOSSIER --files a.png b.png
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scripts.analyze.pure import cluster_by_hash, medoid  # noqa: E402

MANIFEST = Path("research/captures/manifest.jsonl")
OUTPUT = Path("research/digitized/_clusters.json")


def load_manifest(path: Path = MANIFEST) -> list[dict[str, Any]]:
    """Lit le manifeste en ignorant les lignes vides."""
    with path.open(encoding="utf-8") as handle:
        return [json.loads(line) for line in handle if line.strip()]


def summarize(rows: list[dict[str, Any]], groups: list[list[int]]) -> list[dict[str, Any]]:
    """Décrit chaque groupe : effectif, dates, vidéos, capture centrale et meilleure."""
    summary = []
    for rank, group in enumerate(groups):
        members = [rows[i] for i in group]
        center = members[medoid([m["phash"] for m in members])]
        best = max(members, key=lambda m: m.get("chart_score", 0))
        dates = sorted(m["upload_date"] for m in members)
        summary.append(
            {
                "cluster": rank,
                "n": len(members),
                "date_min": dates[0],
                "date_max": dates[-1],
                "videos": Counter(m["video_id"] for m in members).most_common(),
                "axes": Counter(m.get("axes") for m in members).most_common(),
                "medoid": center["file"],
                "best": best["file"],
                "best_score": best.get("chart_score"),
            }
        )
    return summary


def contact_sheet(files: list[str], out: Path, *, columns: int = 4, width: int = 330) -> None:
    """Assemble des captures légendées en une planche (Pillow importé à la demande)."""
    from PIL import Image, ImageDraw

    tiles = []
    for name in files:
        image = Image.open(name).convert("RGB")
        height = round(image.height * width / image.width)
        tile = image.resize((width, height))
        ImageDraw.Draw(tile).text((3, 2), Path(name).stem, fill=(255, 0, 0))
        tiles.append(tile)
    rows = (len(tiles) + columns - 1) // columns
    tile_height = max(t.height for t in tiles)
    sheet = Image.new("RGB", (columns * width, rows * tile_height), "white")
    for index, tile in enumerate(tiles):
        sheet.paste(tile, ((index % columns) * width, (index // columns) * tile_height))
    out.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(out)


def sheets_per_video(
    rows: list[dict[str, Any]], out_dir: Path, *, per_video: int, min_score: float
) -> list[Path]:
    """Produit une planche par vidéo : captures régulièrement réparties dans le temps."""
    by_video: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        if row.get("chart_score", 0) >= min_score:
            by_video[row["video_id"]].append(row)
    written = []
    for video_id, members in by_video.items():
        members.sort(key=lambda m: m["timestamp_s"])
        step = max(1, len(members) // per_video)
        chosen = members[::step][:per_video]
        upload = members[0].get("upload_date", "")
        out = out_dir / f"{upload}_{video_id}.png"
        contact_sheet([m["file"] for m in chosen], out)
        written.append(out)
    return sorted(written)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=MANIFEST)
    parser.add_argument("--min-score", type=float, default=0.6)
    parser.add_argument("--max-distance", type=int, default=14)
    parser.add_argument("--max-days", type=int, default=120)
    parser.add_argument("--output", type=Path, default=OUTPUT)
    parser.add_argument("--sheets", type=Path, help="dossier de sortie des planches-contacts")
    parser.add_argument("--per-video", type=int, default=12)
    parser.add_argument("--files", nargs="*", help="planche à partir de fichiers précis")
    parser.add_argument("--name", default="selection", help="nom de la planche pour --files")
    parser.add_argument("--columns", type=int, default=4)
    parser.add_argument("--width", type=int, default=330)
    args = parser.parse_args(argv)
    sys.stdout.reconfigure(encoding="utf-8")

    if args.sheets and args.files:
        out = args.sheets / f"{args.name}.png"
        contact_sheet(args.files, out, columns=args.columns, width=args.width)
        print(out)
        return 0

    rows = load_manifest(args.manifest)
    if args.sheets:
        for path in sheets_per_video(
            rows, args.sheets, per_video=args.per_video, min_score=args.min_score
        ):
            print(path)
        return 0

    kept = [r for r in rows if r.get("chart_score", 0) >= args.min_score and r.get("phash")]
    groups = cluster_by_hash(kept, max_distance=args.max_distance, max_days=args.max_days)
    summary = summarize(kept, groups)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(summary, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{len(kept)}/{len(rows)} captures au-dessus de {args.min_score} : {len(groups)} groupes")
    for item in summary:
        if item["n"] < 3:
            continue
        videos = " ".join(f"{v}:{n}" for v, n in item["videos"][:5])
        print(
            f"#{item['cluster']:<3} n={item['n']:<4} {item['date_min']}..{item['date_max']} "
            f"{videos} | {Path(item['medoid']).name}"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
