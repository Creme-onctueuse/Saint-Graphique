"""Construit les coordonnées publiées : ``<out>/<méthode>/<élection>.json`` et ``<out>/index.json``.

Usage :
    uv run python -m pipeline.build                      # data/ -> data/computed/
    uv run python -m pipeline.build --data-dir DIR [--out-dir DIR] [--method NOM ...]
        [--election ID ...] [--no-bootstrap] [--n-boot 500] [--seed 0]
        [--bootstrap-kind dirichlet|normal]
    uv run python -m pipeline.build --parity [CHEMIN]    # fixture de parité Python/TypeScript

Pour chaque méthode du registre et chaque élection de ``<data-dir>/elections/*.json``, plus
« population » (sans élection), écrit un fichier conforme à ``schemas/computed.schema.json``.
Les méthodes dont ``bootstrap`` est vrai reçoivent les ellipses de confiance à 95 %, obtenues par
bootstrap des compositions (voir ``pipeline.methods.bootstrap``). Sans ``--election``, les
fichiers d'élections disparues sont supprimés. ``index.json`` décrit ensuite, pour le front, les
méthodes, élections, axes, groupes et fichiers disponibles.

``--parity`` écrit les entrées et sorties attendues de ``ranks``, ``continuous`` et
``espace_social``, calculées sur le jeu FICTIF (``pipeline/tests/fixtures/fake/``, voir
``scripts/fake_data.py``), dans ``web/src/core/__fixtures__/parity.json``. Cette fixture sert aux
tests vitest du portage TypeScript.

Champs facultatifs ajoutés au schéma : ``election_label``, ``pcs[].short``, ``groups``
(barycentres des groupes de niveau 1), ``candidates[].is_abstention`` et ``bootstrap``
(paramètres des ellipses). Les nombres publiés sont arrondis à 1e-6.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections.abc import Mapping, Sequence
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from pipeline.methods import METHODS, get_method
from pipeline.methods.bootstrap import (
    DEFAULT_LEVEL,
    DEFAULT_MARGIN_PTS,
    DEFAULT_N_BOOT,
    bootstrap_ellipses,
)
from pipeline.model import (
    DATA_DIR,
    POPULATION_ID,
    ROOT,
    DataValidationError,
    Election,
    Ellipse,
    PcsData,
    Result,
    load_elections,
    load_elections_config,
    load_methods_config,
    load_pcs,
    read_json,
    validate_instance,
)

FAKE_DIR = ROOT / "pipeline" / "tests" / "fixtures" / "fake"
PARITY_PATH = ROOT / "web" / "src" / "core" / "__fixtures__" / "parity.json"
DEFAULT_METHOD = "read_positions"
PARITY_METHODS = ("ranks", "continuous", "espace_social")
POPULATION_LABEL = "Population (sans élection)"
DECIMALS = 6


def _round(value: float) -> float:
    """Arrondi de publication (1e-6), sans zéro négatif."""
    return round(float(value), DECIMALS) + 0.0


def _display(path: Path) -> str:
    try:
        return path.resolve().relative_to(ROOT).as_posix()
    except ValueError:
        return str(path)


def write_json(path: Path, obj: Any) -> None:
    """Écrit un JSON indenté en UTF-8 avec fins de ligne Unix."""
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(obj, ensure_ascii=False, indent=2) + "\n"
    path.write_text(text, encoding="utf-8", newline="\n")


def method_order(methods_cfg: Mapping[str, Any]) -> list[str]:
    """Méthodes du registre : ordre de ``config/methods.yaml``, puis les autres par nom."""
    configured = [name for name in methods_cfg.get("methods", {}) if name in METHODS]
    return configured + sorted(set(METHODS) - set(configured))


def method_params(name: str, methods_cfg: Mapping[str, Any]) -> dict[str, Any]:
    """Paramètres d'une méthode : bornes des axes, puis section ``methods.<nom>``."""
    params: dict[str, Any] = {"range": list(methods_cfg["axes"].get("range", [-10, 10]))}
    params.update(methods_cfg["methods"].get(name) or {})
    return params


def method_axes(name: str, methods_cfg: Mapping[str, Any]) -> dict[str, Any]:
    """Axes d'une méthode : ceux de la configuration, sauf ``methods.<nom>.axes`` s'il existe."""
    axes = dict(methods_cfg["axes"])
    axes.update((methods_cfg["methods"].get(name) or {}).get("axes") or {})
    return axes


def computed_document(
    result: Result,
    pcs_data: PcsData,
    election: Election | None,
    axes: Mapping[str, Any],
    ellipses: Mapping[str, Ellipse] | None = None,
    bootstrap: Mapping[str, Any] | None = None,
    weight_total: float | None = None,
    sources: Sequence[Mapping[str, Any]] = (),
    pcs_notes: Mapping[str, str] | None = None,
) -> dict[str, Any]:
    """Document ``computed.schema.json`` pour un résultat.

    ``weight_total`` fixe le dénominateur des poids (somme des populations par défaut).
    ``sources`` cite les sources propres à la méthode, ``pcs_notes`` commente certaines PCS.
    """
    pcs_notes = pcs_notes or {}
    total = weight_total or sum(p.population for p in pcs_data.items)
    group_population: dict[str, float] = {}
    for p in pcs_data.items:
        group_population[p.group] = group_population.get(p.group, 0.0) + p.population
    candidates = []
    for c in election.candidates if election is not None else ():
        point = result.candidates.get(c.id)
        if point is None:
            continue
        entry: dict[str, Any] = {
            "id": c.id, "label": c.label, "color": c.color,
            "x": _round(point.x), "y": _round(point.y), "is_abstention": c.is_abstention,
        }
        if c.national_share_pct is not None:
            entry["national_share_pct"] = c.national_share_pct
        if ellipses and c.id in ellipses:
            e = ellipses[c.id]
            entry["ellipse"] = {
                "rx": _round(e.rx), "ry": _round(e.ry), "angle_deg": _round(e.angle_deg)
            }
        candidates.append(entry)
    doc: dict[str, Any] = {
        "method": result.method,
        "params": dict(result.params),
        "election_id": result.election_id,
        "election_label": election.label if election is not None else POPULATION_LABEL,
        "axes": {
            "x_label": axes["x"]["label"],
            "y_label": axes["y"]["label"],
            "range": list(axes["range"]),
        },
        "pcs": [
            {
                "code": p.code, "group": p.group, "label": p.label, "short": p.short,
                "x": _round(result.pcs[p.code].x), "y": _round(result.pcs[p.code].y),
                "weight": _round(100 * p.population / total),
                **({"note": pcs_notes[p.code]} if p.code in pcs_notes else {}),
            }
            for p in pcs_data.items
        ],
        "groups": [
            {
                "code": code, "label": pcs_data.groups[code].label,
                "color": pcs_data.groups[code].color,
                "x": _round(point.x), "y": _round(point.y),
                "weight": _round(100 * group_population[code] / total),
            }
            for code, point in result.groups.items()
        ],
        "candidates": candidates,
        "population_barycenter": {
            "x": _round(result.population.x), "y": _round(result.population.y)
        },
    }
    if bootstrap:
        doc["bootstrap"] = dict(bootstrap)
    if sources:
        doc["sources"] = [dict(s) for s in sources]
    return doc


def build_index(
    out_dir: Path,
    pcs_data: PcsData,
    elections: Sequence[Election],
    methods_cfg: Mapping[str, Any],
) -> dict[str, Any]:
    """Index pour le front, établi d'après les fichiers présents dans ``out_dir``."""
    meta: dict[str, dict[str, Any]] = {
        POPULATION_ID: {"id": POPULATION_ID, "label": POPULATION_LABEL, "type": "population",
                        "year": pcs_data.reference_year},
    }
    for e in load_elections_config():
        meta.setdefault(e["id"], {k: e[k] for k in ("id", "label", "type", "year", "round")
                                  if k in e})
    for e in elections:
        meta[e.id] = {"id": e.id, "label": e.label, "type": e.type, "year": e.year}
        if e.round is not None:
            meta[e.id]["round"] = e.round
    order = list(meta)

    def sort_key(election_id: str) -> tuple[int, str]:
        return (order.index(election_id) if election_id in order else len(order), election_id)

    methods: list[dict[str, Any]] = []
    available: set[str] = set()
    for name in method_order(methods_cfg):
        docs = {f.stem: read_json(f) for f in sorted((out_dir / name).glob("*.json"))}
        if not docs:
            continue
        available.update(docs)
        methods.append({
            "id": name,
            "label": METHODS[name].label,
            "description": (methods_cfg["methods"].get(name) or {}).get("description", ""),
            "ellipses": any("ellipse" in c for d in docs.values() for c in d.get("candidates", [])),
            "elections": sorted(docs, key=sort_key),
        })
    axes = methods_cfg["axes"]
    ids = [m["id"] for m in methods]
    return {
        "generated_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "path_template": "{method}/{election}.json",
        "axes": {
            "x_label": axes["x"]["label"], "x_hint": axes["x"].get("hint", ""),
            "y_label": axes["y"]["label"], "y_hint": axes["y"].get("hint", ""),
            "range": list(axes["range"]),
        },
        "default_method": DEFAULT_METHOD if DEFAULT_METHOD in ids else (ids or [None])[0],
        "methods": methods,
        "elections": [meta.get(i, {"id": i, "label": i}) for i in sorted(available, key=sort_key)],
        "groups": [{"code": g.code, "label": g.label, "color": g.color}
                   for g in pcs_data.groups.values()],
    }


def parity_document(
    pcs_data: PcsData,
    elections: Sequence[Election],
    methods_cfg: Mapping[str, Any],
    source: str,
) -> dict[str, Any]:
    """Entrées et sorties attendues (pleine précision) pour le portage TypeScript."""
    cases = []
    for election in elections:
        for name in PARITY_METHODS:
            result = get_method(name).compute(pcs_data.items, election,
                                              method_params(name, methods_cfg))
            cases.append({
                "method": name,
                "election_id": election.id,
                "params": dict(result.params),
                "expected": {
                    "pcs": [{"code": c, "x": p.x, "y": p.y} for c, p in result.pcs.items()],
                    "groups": [{"code": c, "x": p.x, "y": p.y} for c, p in result.groups.items()],
                    "candidates": [{"id": c, "x": p.x, "y": p.y}
                                   for c, p in result.candidates.items()],
                    "population_barycenter": {"x": result.population.x, "y": result.population.y},
                },
            })
    return {
        "description": "Parité Python/TypeScript des méthodes de placement, calculée sur le jeu "
                       "FICTIF de scripts/fake_data.py. Fichier généré : ne pas éditer.",
        "generated_by": "uv run python -m pipeline.build --parity",
        "source": source,
        "tolerance": 1e-9,
        "notes": [
            "x = patrimoine_keur / niveau_vie_mensuel_eur * 100 ; y = somme de gauche à droite, "
            "dans l'ordre bac5..certif_aucun, des y_weights * diplomes, sauf retired_y_override "
            "(score forcé pour un code).",
            "ranks : rang décroissant 1..N, coordonnée = lo + (hi - lo) / (N - 1) * "
            "(N - rang). Ex æquo : le plus petit code PCS (ordre lexicographique) reçoit le "
            "meilleur rang. Le jeu contient des ex æquo volontaires (x : 62/63, y : 67/68).",
            "continuous : z-score non pondéré (écart-type ddof 0) puis min/max : lo + (hi - lo) * "
            "((z - zmin) / (zmax - zmin)).",
            "espace_social : z = (v - m) / s, avec m et s pondérés par la population, retraités "
            "(code '7') exclus de m et de s. E = z(z(ln patrimoine) + z(ln niveau de vie)), "
            "C = z(somme des y_weights * diplomes). x : placement de continuous sur E - C ; "
            "y : placement de continuous sur E + C.",
            "Groupes : barycentre des PCS du groupe pondéré par la population. Population : "
            "barycentre de toutes les PCS pondéré par la population.",
            "Candidats : barycentre des groupes pondéré par composition[candidat][groupe]. Une "
            "composition de niveau 2 (pcs_level 2) est d'abord sommée par groupe. Les clés sans "
            "PCS ni groupe connu (ex. '81') sont ignorées et un candidat de poids nul est omis.",
        ],
        "input": {
            "pcs": [
                {"code": p.code, "group": p.group, "population": p.population,
                 "niveau_vie_mensuel_eur": p.niveau_vie_mensuel_eur,
                 "patrimoine_keur": p.patrimoine_keur, "diplomes": dict(p.diplomes)}
                for p in pcs_data.items
            ],
            "elections": [
                {"id": e.id, "pcs_level": e.pcs_level,
                 "candidates": [{"id": c.id, "label": c.label, "color": c.color}
                                for c in e.candidates],
                 "composition": {cid: dict(shares) for cid, shares in e.composition.items()}}
                for e in elections
            ],
        },
        "cases": cases,
    }


def _parse_args(argv: Sequence[str] | None) -> argparse.Namespace:
    ap = argparse.ArgumentParser(
        prog="python -m pipeline.build",
        description="Calcule data/computed/<méthode>/<élection>.json et index.json.",
    )
    ap.add_argument("--data-dir", type=Path, default=None,
                    help="dossier contenant pcs.json et elections/ (défaut : data/, "
                         "ou le jeu fictif avec --parity)")
    ap.add_argument("--out-dir", type=Path, default=None,
                    help="dossier de sortie (défaut : <data-dir>/computed)")
    ap.add_argument("--method", action="append", metavar="NOM",
                    help="méthode à calculer (répétable ; défaut : toutes)")
    ap.add_argument("--election", action="append", metavar="ID",
                    help=f"élection à calculer ou '{POPULATION_ID}' (répétable ; défaut : toutes)")
    ap.add_argument("--no-bootstrap", action="store_true",
                    help="ne pas calculer les ellipses de confiance")
    ap.add_argument("--n-boot", type=int, default=DEFAULT_N_BOOT,
                    help=f"nombre de tirages du bootstrap (défaut : {DEFAULT_N_BOOT})")
    ap.add_argument("--seed", type=int, default=0, help="graine du bootstrap (défaut : 0)")
    ap.add_argument("--bootstrap-kind", choices=("dirichlet", "normal"), default="dirichlet",
                    help="loi de perturbation des compositions (défaut : dirichlet)")
    ap.add_argument("--parity", nargs="?", type=Path, const=PARITY_PATH, default=None,
                    metavar="CHEMIN",
                    help="écrit la fixture de parité TypeScript (défaut : "
                         "web/src/core/__fixtures__/parity.json) au lieu de construire")
    return ap.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    """Point d'entrée ; renvoie le code de sortie."""
    args = _parse_args(argv)
    data_dir: Path = args.data_dir or (FAKE_DIR if args.parity else DATA_DIR)
    pcs_path = data_dir / "pcs.json"
    if not pcs_path.exists():
        print(f"[x] {_display(pcs_path)} introuvable : produire d'abord les données "
              "(pipeline.sources) ou passer --data-dir.", file=sys.stderr)
        return 1
    methods_cfg = load_methods_config()
    try:
        pcs_data = load_pcs(pcs_path)
        elections = load_elections(data_dir / "elections")
    except DataValidationError as exc:
        print(f"[x] {exc}", file=sys.stderr)
        return 1

    if args.parity:
        if not elections:
            print(f"[x] aucune élection dans {_display(data_dir)}", file=sys.stderr)
            return 1
        write_json(args.parity,
                   parity_document(pcs_data, elections, methods_cfg, _display(data_dir)))
        print(f"[ok] fixture de parité -> {_display(args.parity)}")
        return 0

    names = args.method or method_order(methods_cfg)
    unknown = sorted(set(names) - set(METHODS))
    if unknown:
        print(f"[x] méthode(s) inconnue(s) : {', '.join(unknown)} "
              f"(disponibles : {', '.join(sorted(METHODS))})", file=sys.stderr)
        return 1
    targets: list[Election | None] = [None, *elections]
    if args.election:
        known = {POPULATION_ID, *(e.id for e in elections)}
        unknown = sorted(set(args.election) - known)
        if unknown:
            print(f"[x] élection(s) inconnue(s) : {', '.join(unknown)}", file=sys.stderr)
            return 1
        targets = [t for t in targets if (t.id if t else POPULATION_ID) in args.election]

    out_dir: Path = args.out_dir or data_dir / "computed"
    for name in names:
        method = get_method(name)
        params = method_params(name, methods_cfg)
        written: set[str] = set()
        for election in targets:
            result = method.compute(pcs_data.items, election, params)
            ellipses, info = None, None
            if election is not None and method.bootstrap and not args.no_bootstrap:
                margin = (election.margin_pts if election.margin_pts is not None
                          else DEFAULT_MARGIN_PTS)
                ellipses = bootstrap_ellipses(
                    method, pcs_data.items, election, params, n_boot=args.n_boot,
                    margin_pts=margin, kind=args.bootstrap_kind, seed=args.seed,
                )
                info = {"n_boot": args.n_boot, "margin_pts": margin,
                        "kind": args.bootstrap_kind, "seed": args.seed, "level": DEFAULT_LEVEL}
            display_data = getattr(method, "display_data", None)
            doc = computed_document(
                result,
                display_data(pcs_data) if display_data else pcs_data,
                election,
                method_axes(name, methods_cfg),
                ellipses,
                info,
                weight_total=getattr(method, "weight_total", None),
                sources=getattr(method, "sources", ()),
                pcs_notes=getattr(method, "pcs_notes", None),
            )
            path = out_dir / name / f"{result.election_id}.json"
            validate_instance(doc, "computed.schema.json", _display(path))
            write_json(path, doc)
            written.add(path.name)
            missing = [c.id for c in (election.candidates if election else ())
                       if c.id not in result.candidates]
            note = f", {len(doc['candidates'])} candidats" if election else ""
            note += ", ellipses" if ellipses else ""
            note += f" ; non placés : {', '.join(missing)}" if missing else ""
            print(f"[ok] {_display(path)}{note}")
        if not args.election:
            for stale in sorted((out_dir / name).glob("*.json")):
                if stale.name not in written:
                    stale.unlink()
                    print(f"[-] {_display(stale)} supprimé (élection absente)")

    write_json(out_dir / "index.json", build_index(out_dir, pcs_data, elections, methods_cfg))
    print(f"[ok] {_display(out_dir / 'index.json')}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
