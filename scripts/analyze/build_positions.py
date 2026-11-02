"""Écrit ``data/positions_chris.json`` à partir des relevés locaux de ``research/digitized``.

Les relevés de plusieurs versions du tableau de Chris sont réunis, poste par poste. Chaque
lecture est ramenée sur la grille de 0,5 observée dans les infobulles. Une lecture qui
s'écarte de la précédente ouvre une révision : seule la dernière révision est retenue, ce
qui garde le déplacement de deux catégories d'employés en février 2026.

Poids, du plus sûr au moins sûr :

- ``read`` : valeur « Somme de POIDS » lue dans une infobulle ;
- ``census`` : part dans le recensement, multipliée par le rapport médian entre infobulles et
  recensement, car Chris rapporte ses poids à une population plus large (inactifs compris) ;
- ``disc`` : aire du disque mesuré sur une capture, calibrée sur les infobulles.

Les relevés restent locaux. Le fichier produit ne contient que des chiffres cités, avec
leur vidéo et leur horodatage.

Usage :
    uv run python scripts/analyze/build_positions.py
"""

from __future__ import annotations

import argparse
import json
import math
import statistics
import sys
from collections.abc import Iterable, Mapping, Sequence
from pathlib import Path
from typing import Any

import yaml

ROOT = Path(__file__).resolve().parents[2]
DIGITIZED = ROOT / "research" / "digitized"
OUTPUT = ROOT / "data" / "positions_chris.json"

GRID = 0.5
#: Versions du tableau, de la plus ancienne à la plus récente.
VERSIONS = (
    "diapo_2025_01_07",
    "powerbi_2025_03_27",
    "powerbi_2026_02_14",
    "powerbi_2026_02_28",
)
#: Capture plein écran dont les disques servent à estimer les poids.
DISC_VERSION = "powerbi_2026_02_14"
DISC_FILE = "iXImwyHjrwM_00656.detect.json"
MATCH_TOLERANCE = 0.2
#: Rayons mesurés à la main (px) : disques que la détection automatique a manqués, car ils se
#: chevauchent ou touchent un autre disque, sur la même capture.
MANUAL_RADII_PX = {"11": 10.6, "12": 7.0, "13": 10.5, "74": 30.0, "86": 21.5}

#: Libellés courts des postes absents de ``config/pcs.yaml``.
SHORT_LABELS = {
    "11": "Agri. petite expl.",
    "12": "Agri. moyenne expl.",
    "13": "Agri. grande expl.",
    "71": "Anciens agriculteurs",
    "72": "Anciens indépendants",
    "74": "Anciens cadres",
    "75": "Anciennes prof. interm.",
    "77": "Anciens employés",
    "78": "Anciens ouvriers",
    "81": "Chômeurs sans emploi passé",
    "84": "Élèves, étudiants",
    "85": "Sans emploi passé, -60 ans",
    "86": "Sans emploi passé, 60 ans et +",
}

VIDEO_TITLES = {
    "MJsGgEA_Slw": "Première présentation du graphique (diapositive)",
    "GTN2rUgOdFo": "Tableau interactif, infobulles lues",
    "iXImwyHjrwM": "Tableau en plein écran",
    "81kznHfk78k": "Tableau révisé : deux catégories d'employés déplacées",
}


def snap(value: float, grid: float = GRID) -> float:
    """Valeur la plus proche sur la grille."""
    return round(value / grid) * grid


def retained_position(readings: Sequence[tuple[float, float]]) -> tuple[float, float, int]:
    """Position retenue et nombre de lectures qui la soutiennent.

    ``readings`` suit l'ordre chronologique. Une lecture qui change de case après arrondi
    ouvre une révision et écarte les précédentes.
    """
    if not readings:
        raise ValueError("aucune lecture")
    current: list[tuple[float, float]] = []
    for reading in readings:
        if current and (snap(reading[0]), snap(reading[1])) != (
            snap(current[-1][0]),
            snap(current[-1][1]),
        ):
            current = []
        current.append(reading)
    return (
        snap(statistics.median(r[0] for r in current)),
        snap(statistics.median(r[1] for r in current)),
        len(current),
    )


def linear_scale(marks: Sequence[Mapping[str, float]]) -> tuple[float, float]:
    """Pente et ordonnée à l'origine d'un axe, ajustées sur ses repères de calibrage."""
    xs = [float(m["pixel"]) for m in marks]
    ys = [float(m["value"]) for m in marks]
    x_mean, y_mean = sum(xs) / len(xs), sum(ys) / len(ys)
    slope = sum((a - x_mean) * (b - y_mean) for a, b in zip(xs, ys, strict=True)) / sum(
        (a - x_mean) ** 2 for a in xs
    )
    return slope, y_mean - slope * x_mean


def match_radii(
    positions: Mapping[str, tuple[float, float]],
    discs: Iterable[Mapping[str, float]],
    calibration: Mapping[str, Sequence[Mapping[str, float]]],
    tolerance: float = MATCH_TOLERANCE,
) -> dict[str, float]:
    """Rayon en pixels du disque détecté à la position de chaque poste."""
    ax, bx = linear_scale(calibration["x_marks"])
    ay, by = linear_scale(calibration["y_marks"])
    placed = [(ax * d["px"] + bx, ay * d["py"] + by, float(d["r"])) for d in discs]
    radii: dict[str, float] = {}
    for code, (x, y) in positions.items():
        candidates = [(math.hypot(px - x, py - y), r) for px, py, r in placed]
        distance, radius = min(candidates, default=(math.inf, 0.0))
        if distance < tolerance:
            radii[code] = radius
    return radii


def choose_weights(
    codes: Iterable[str],
    tooltips: Mapping[str, float],
    census_shares: Mapping[str, float],
    radii: Mapping[str, float],
) -> dict[str, tuple[float, str]]:
    """Poids de chaque poste et sa nature (``read``, ``census`` ou ``disc``)."""
    common = [c for c in tooltips if c in census_shares]
    if not common:
        raise ValueError("aucune infobulle commune avec le recensement")
    scale = statistics.median(tooltips[c] / census_shares[c] for c in common)
    calibrated = [c for c in tooltips if c in radii]
    if not calibrated:
        raise ValueError("aucune infobulle associée à un disque")
    area_factor = sum(tooltips[c] * radii[c] ** 2 for c in calibrated) / sum(
        radii[c] ** 4 for c in calibrated
    )
    weights: dict[str, tuple[float, str]] = {}
    for code in codes:
        if code in tooltips:
            weights[code] = (tooltips[code], "read")
        elif code in census_shares:
            weights[code] = (round(census_shares[code] * scale, 2), "census")
        elif code in radii:
            weights[code] = (round(area_factor * radii[code] ** 2, 2), "disc")
        else:
            raise ValueError(f"poste {code} : aucun poids disponible")
    return weights


def build_document(
    documents: Mapping[str, Mapping[str, Any]],
    discs: Iterable[Mapping[str, float]],
    pcs_items: Sequence[Mapping[str, Any]],
    short_labels: Mapping[str, str],
    census_source: Mapping[str, Any],
) -> dict[str, Any]:
    """Assemble le document ``positions.schema.json``."""
    readings: dict[str, list[tuple[float, float]]] = {}
    latest: dict[str, tuple[Mapping[str, Any], Mapping[str, Any]]] = {}
    tooltips: dict[str, float] = {}
    videos: dict[str, Mapping[str, Any]] = {}
    for version in VERSIONS:
        document = documents[version]
        videos[version] = document["source"]
        for point in document["points"]:
            code = point.get("code")
            if point["kind"] != "pcs" or not code:
                continue
            readings.setdefault(code, []).append((float(point["x"]), float(point["y"])))
            latest[code] = (point, document)
            if point.get("weight"):
                tooltips[code] = float(point["weight"])

    positions: dict[str, tuple[float, float]] = {}
    supports: dict[str, int] = {}
    for code, rows in readings.items():
        x, y, support = retained_position(rows)
        positions[code] = (x, y)
        supports[code] = support

    calibration = documents[DISC_VERSION]["calibration"]
    radii = {**match_radii(positions, discs, calibration), **MANUAL_RADII_PX}
    total = sum(float(item["population"]) for item in pcs_items)
    census_shares = {
        str(item["code"]): 100 * float(item["population"]) / total
        for item in pcs_items
        if str(item["code"]) in positions
    }
    weights = choose_weights(positions, tooltips, census_shares, radii)

    items = []
    for code in sorted(positions):
        point, document = latest[code]
        source = document["source"]
        weight, weight_status = weights[code]
        items.append(
            {
                "code": code,
                "group": code[0],
                "label": point["label"],
                "short": short_labels.get(code, point["label"]),
                "x": positions[code][0],
                "y": positions[code][1],
                "weight_pct": weight,
                "weight_status": weight_status,
                "readings": supports[code],
                "video_id": point.get("video_id") or source["video_id"],
                "timestamp_s": point.get("timestamp_s") or source["timestamp_s"],
            }
        )
    last = VERSIONS[-1]
    sources = [
        {
            "id": f"paduteam_{source['video_id']}",
            "title": f"PaduTeam, {VIDEO_TITLES.get(source['video_id'], 'graphique')}, "
            f"{documents[version]['date']}",
            "url": f"https://youtu.be/{source['video_id']}?t={int(source['timestamp_s'])}",
            "publisher": "PaduTeam",
            "accessed": "2026-11-02",
            "notes": "Valeurs lues à l'écran. Le graphique et son algorithme sont de Chris.",
        }
        for version, source in videos.items()
    ]
    return {
        "version_id": last,
        "date": str(documents[last]["date"]),
        "nomenclature": "PCS 2003, 42 postes (libellés lus à l'écran)",
        "grid": GRID,
        "sources": [*sources, dict(census_source)],
        "items": items,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--digitized", type=Path, default=DIGITIZED)
    parser.add_argument("--out", type=Path, default=OUTPUT)
    args = parser.parse_args(argv)
    sys.stdout.reconfigure(encoding="utf-8")

    documents = {
        version: json.loads((args.digitized / f"{version}.json").read_text(encoding="utf-8"))
        for version in VERSIONS
    }
    discs = json.loads((args.digitized / "frames" / DISC_FILE).read_text(encoding="utf-8"))
    pcs = json.loads((ROOT / "data" / "pcs.json").read_text(encoding="utf-8"))
    config = yaml.safe_load((ROOT / "config" / "pcs.yaml").read_text(encoding="utf-8"))
    shorts = {str(i["code"]): i["short"] for i in config["items"]}
    shorts.update(SHORT_LABELS)
    census = next(s for s in pcs["sources"] if "ecensement" in s["title"])

    document = build_document(documents, discs, pcs["items"], shorts, census)
    args.out.write_text(
        json.dumps(document, ensure_ascii=False, indent=1) + "\n", encoding="utf-8", newline="\n"
    )
    tally: dict[str, int] = {}
    for item in document["items"]:
        tally[item["weight_status"]] = tally.get(item["weight_status"], 0) + 1
    total = sum(i["weight_pct"] for i in document["items"])
    print(f"{args.out} : {len(document['items'])} postes, somme des poids {total:.1f}, {tally}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
