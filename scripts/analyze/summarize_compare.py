"""Résume les sorties JSON de compare.py en un tableau, en console et dans un fichier.

Usage :
    uv run python scripts/analyze/summarize_compare.py research/digitized/compare
"""

from __future__ import annotations

import argparse
import json
import sys
from collections.abc import Iterable, Mapping
from pathlib import Path
from typing import Any

BLOCKS = ("groups", "pcs", "pcs_with_aggregates", "candidates")


def summary_rows(reports: Iterable[Mapping[str, Any]]) -> list[dict[str, Any]]:
    """Une ligne par bloc mesuré et par rapport, sans les blocs vides."""
    rows = []
    for report in reports:
        method = Path(report["computed"]).parent.name
        election = Path(report["computed"]).stem
        for block in BLOCKS:
            values = report.get(block) or {}
            if not values.get("n"):
                continue
            rows.append(
                {
                    "version": report["version_id"],
                    "method": method,
                    "election": election,
                    "block": block,
                    "n": values["n"],
                    "rmse_x": values["rmse_x"],
                    "rmse_y": values["rmse_y"],
                    "spearman_x": values["spearman_x"],
                    "spearman_y": values["spearman_y"],
                }
            )
    return sorted(rows, key=lambda r: (r["version"], r["election"], r["block"], r["method"]))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    args = parser.parse_args(argv)
    sys.stdout.reconfigure(encoding="utf-8")

    reports = []
    for path in sorted(args.directory.glob("*.json")):
        if path.name.startswith("_"):
            continue
        content = json.loads(path.read_text(encoding="utf-8"))
        if "computed" in content:
            reports.append(content)
    rows = summary_rows(reports)
    (args.directory / "_synthese.json").write_text(
        json.dumps(rows, ensure_ascii=False, indent=1), encoding="utf-8"
    )
    for row in rows:
        print(
            f"{row['version']:<46} {row['method']:<15} {row['block']:<20} n={row['n']:<3} "
            f"RMSE {row['rmse_x']:>6} {row['rmse_y']:>6}  "
            f"Spearman {row['spearman_x']} {row['spearman_y']}"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
