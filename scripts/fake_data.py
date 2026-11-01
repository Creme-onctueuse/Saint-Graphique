"""Génère un jeu de données FICTIF conforme aux schémas : pcs.json et deux élections.

Usage : uv run python scripts/fake_data.py [dossier] [--seed N]
        (dossier par défaut : pipeline/tests/fixtures/fake/)

Écrit ``<dossier>/pcs.json`` et ``<dossier>/elections/<id>.json``. Ce jeu sert à tester le
pipeline et à produire la fixture de parité Python/TypeScript sans dépendre des vraies
données. Tous les chiffres sont inventés.

Le tirage n'utilise que des entiers (``Generator.integers``) et de l'arithmétique exacte :
le résultat est identique d'une plateforme à l'autre pour une même graine.

Particularités voulues pour les tests :
- ex æquo : les PCS 62 et 63 ont le même score x, les PCS 67 et 68 le même score y ;
- 2099_presidentielle_t1 : compositions par groupe (niveau 1), marge de 3 points, une part
  nulle (candidate D chez les agriculteurs) ;
- 2099_europeennes : compositions par PCS détaillée (niveau 2), sans marge, avec une clé « 81 »
  hors nomenclature, que les méthodes doivent ignorer.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

import numpy as np
import yaml

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from pipeline.model import DIPLOMA_KEYS, validate_instance  # noqa: E402

DEFAULT_OUT = ROOT / "pipeline" / "tests" / "fixtures" / "fake"
DEFAULT_SEED = 20261031
FAKE_YEAR = 2099
SOURCE = {
    "id": "fake",
    "title": "Données fictives générées par scripts/fake_data.py",
    "publisher": "Saint-Graphique",
    "url": "scripts/fake_data.py",
    "accessed": "2026-10-31",
    "license": "MIT",
    "notes": "Chiffres inventés, uniquement pour les tests. Ne pas interpréter.",
}

# Par groupe : niveau de vie (€/mois), patrimoine (k€), poids relatifs des diplômes
# (bac5, bac3, bac2, bac, cap, brevet, certif_aucun), population (milliers).
GROUP_PROFILES: dict[str, tuple[int, int, tuple[int, ...], int]] = {
    "1": (2100, 600, (1, 1, 2, 4, 6, 1, 6), 400),
    "2": (2200, 450, (2, 2, 3, 4, 6, 1, 4), 700),
    "3": (3000, 450, (10, 5, 2, 2, 1, 1, 1), 1200),
    "4": (2250, 260, (2, 4, 5, 5, 3, 1, 1), 1300),
    "5": (1850, 160, (1, 1, 2, 5, 6, 2, 4), 1700),
    "6": (1750, 120, (1, 1, 1, 4, 8, 2, 7), 900),
    "7": (1950, 230, (1, 1, 1, 2, 4, 2, 8), 15000),
}
# Ajustements (niveau de vie, patrimoine) en % pour quelques PCS typées.
CODE_FACTORS: dict[str, tuple[int, int]] = {"23": (150, 400), "31": (120, 130), "10": (100, 80)}


def to_tenths(weights: list[int]) -> list[float]:
    """Répartit 100 % proportionnellement à des poids entiers, au dixième, somme exacte."""
    total = sum(weights)
    if total <= 0:
        raise ValueError("poids tous nuls")
    quotients = [1000 * w // total for w in weights]
    remainders = [1000 * w % total for w in weights]
    for i in sorted(range(len(weights)), key=lambda j: (-remainders[j], j))[
        : 1000 - sum(quotients)
    ]:
        quotients[i] += 1
    return [q / 10 for q in quotients]


def make_pcs(rng: np.random.Generator, pcs_config: dict[str, Any]) -> dict[str, Any]:
    """Données fictives par PCS (codes et groupes de config/pcs.yaml)."""
    items: dict[str, dict[str, Any]] = {}
    for it in pcs_config["items"]:
        code, group = str(it["code"]), str(it["group"])
        nv, pat, diplomas, pop = GROUP_PROFILES[group]
        f_nv, f_pat = CODE_FACTORS.get(code, (100, 100))
        weights = [w * int(rng.integers(5, 16)) for w in diplomas]
        items[code] = {
            "code": code,
            "group": group,
            "population": pop * 10 * int(rng.integers(50, 151)),
            "niveau_vie_mensuel_eur": round(nv * f_nv * int(rng.integers(90, 111)) / 10_000, 1),
            "patrimoine_keur": round(pat * f_pat * int(rng.integers(70, 131)) / 10_000, 1),
            "diplomes": dict(zip(DIPLOMA_KEYS, to_tenths(weights), strict=True)),
            "source_refs": ["fake"],
        }
    # Ex æquo volontaires (départage par code).
    for key in ("niveau_vie_mensuel_eur", "patrimoine_keur"):
        items["63"][key] = items["62"][key]
    items["68"]["diplomes"] = dict(items["67"]["diplomes"])
    items["63"]["notes"] = "Revenus copiés de la PCS 62 : ex æquo volontaire en x."
    items["68"]["notes"] = "Diplômes copiés de la PCS 67 : ex æquo volontaire en y."
    return {
        "nomenclature": pcs_config["nomenclature"],
        "reference_year": FAKE_YEAR,
        "sources": [SOURCE],
        "items": list(items.values()),
    }


def _composition(
    rng: np.random.Generator,
    base: dict[str, int],
    tilt: set[str],
    zeros: frozenset[str] | set[str] = frozenset(),
) -> dict[str, float]:
    """Composition fictive (%, somme 100) : poids de base, accentués sur les groupes ``tilt``."""
    keys = list(base)
    weights = [
        0 if k in zeros else base[k] * (int(rng.integers(5, 16)) + (15 if k in tilt else 0))
        for k in keys
    ]
    return dict(zip(keys, to_tenths(weights), strict=True))


def make_elections(rng: np.random.Generator, pcs: dict[str, Any]) -> list[dict[str, Any]]:
    """Deux élections fictives : une ventilée par groupe, une par PCS détaillée."""
    group_base = {"1": 2, "2": 6, "3": 12, "4": 16, "5": 16, "6": 12, "7": 36}
    pres_candidates = [
        ("abstention", "Abstention", "#000000", set(), set()),
        ("candidat-a", "Candidat A", "#c9191e", {"5", "6"}, set()),
        ("candidate-b", "Candidate B", "#ffb000", {"3", "7"}, set()),
        ("candidat-c", "Candidat C", "#0066cc", {"2", "7"}, set()),
        ("candidate-d", "Candidate D", "#2e8b57", {"3", "4"}, {"1"}),
    ]
    pres_shares = to_tenths([int(rng.integers(10, 40)) for _ in pres_candidates[1:]])
    presidentielle = {
        "id": f"{FAKE_YEAR}_presidentielle_t1",
        "type": "presidentielle",
        "year": FAKE_YEAR,
        "round": 1,
        "label": f"Présidentielle fictive {FAKE_YEAR} (1er tour)",
        "pcs_level": 1,
        "sources": [SOURCE],
        "margin_pts": 3.0,
        "candidates": [
            {"id": cid, "label": label, "color": color, "is_abstention": True,
             "national_share_pct": 25.3}
            if cid == "abstention"
            else {"id": cid, "label": label, "color": color,
                  "national_share_pct": pres_shares[i - 1]}
            for i, (cid, label, color, _, _) in enumerate(pres_candidates)
        ],
        "composition": {
            cid: _composition(rng, group_base, tilt, zeros)
            for cid, _, _, tilt, zeros in pres_candidates
        },
    }

    group_of = {it["code"]: it["group"] for it in pcs["items"]}
    pcs_base = {it["code"]: max(1, it["population"] // 100_000) for it in pcs["items"]}
    pcs_base["81"] = 3  # hors nomenclature : doit être ignoré par les méthodes
    euro_candidates = [
        ("abstention", "Abstention", "#000000", set()),
        ("liste-e", "Liste E", "#8b0000", {"5", "6"}),
        ("liste-f", "Liste F", "#4169e1", {"3"}),
        ("liste-g", "Liste G", "#556b2f", {"1", "2"}),
    ]
    euro_shares = to_tenths([int(rng.integers(10, 40)) for _ in euro_candidates[1:]])
    europeennes = {
        "id": f"{FAKE_YEAR}_europeennes",
        "type": "europeennes",
        "year": FAKE_YEAR,
        "round": 1,
        "label": f"Européennes fictives {FAKE_YEAR}",
        "pcs_level": 2,
        "sources": [SOURCE],
        "candidates": [
            {"id": cid, "label": label, "color": color, "is_abstention": True,
             "national_share_pct": 49.9}
            if cid == "abstention"
            else {"id": cid, "label": label, "color": color,
                  "national_share_pct": euro_shares[i - 1]}
            for i, (cid, label, color, _) in enumerate(euro_candidates)
        ],
        "composition": {
            cid: _composition(rng, pcs_base, {c for c, g in group_of.items() if g in tilt})
            for cid, _, _, tilt in euro_candidates
        },
    }
    return [presidentielle, europeennes]


def generate(seed: int = DEFAULT_SEED) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """Jeu fictif complet (pcs.json, élections), validé contre les schémas."""
    with (ROOT / "config" / "pcs.yaml").open(encoding="utf-8") as f:
        pcs_config = yaml.safe_load(f)
    rng = np.random.default_rng(seed)
    pcs = make_pcs(rng, pcs_config)
    elections = make_elections(rng, pcs)
    validate_instance(pcs, "pcs.schema.json", "pcs.json fictif")
    for election in elections:
        validate_instance(election, "election.schema.json", f"{election['id']} fictive")
    return pcs, elections


def write_json(path: Path, obj: Any) -> None:
    """Écrit un JSON indenté en UTF-8, fins de ligne Unix."""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=2) + "\n", encoding="utf-8",
                    newline="\n")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("out_dir", nargs="?", type=Path, default=DEFAULT_OUT,
                    help="dossier de sortie (défaut : pipeline/tests/fixtures/fake/)")
    ap.add_argument("--seed", type=int, default=DEFAULT_SEED, help="graine du tirage")
    args = ap.parse_args(argv)
    pcs, elections = generate(args.seed)
    write_json(args.out_dir / "pcs.json", pcs)
    for election in elections:
        write_json(args.out_dir / "elections" / f"{election['id']}.json", election)
    print(f"[ok] {len(pcs['items'])} PCS et {len(elections)} élections fictives -> {args.out_dir}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
