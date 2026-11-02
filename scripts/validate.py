"""Valide tous les fichiers de contrat contre leurs JSON Schemas.

Usage : python scripts/validate.py [--research]
Code de sortie 1 si au moins un fichier est invalide.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from jsonschema import Draft202012Validator
from referencing import Registry, Resource

ROOT = Path(__file__).resolve().parent.parent
SCHEMAS = ROOT / "schemas"


def load_registry() -> Registry:
    resources = []
    for p in SCHEMAS.glob("*.schema.json"):
        schema = json.loads(p.read_text(encoding="utf-8"))
        resources.append((p.name, Resource.from_contents(schema)))
    return Registry().with_resources(resources)


def validator(name: str, registry: Registry, pointer: str | None = None) -> Draft202012Validator:
    schema = json.loads((SCHEMAS / name).read_text(encoding="utf-8"))
    if pointer:
        schema = {"$ref": f"{name}#{pointer}"}
    return Draft202012Validator(schema, registry=registry)


def check(v: Draft202012Validator, instance: object, label: str) -> int:
    errors = sorted(v.iter_errors(instance), key=lambda e: list(e.path))
    for e in errors:
        path = "/".join(str(x) for x in e.path) or "<racine>"
        print(f"  [x] {label} : {path} : {e.message}")
    return len(errors)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--research", action="store_true", help="valide aussi research/ (local)")
    args = ap.parse_args(argv)
    reg = load_registry()
    n_err = n_files = 0

    targets: list[tuple[str, str | None, list[Path]]] = [
        ("pcs.schema.json", None, [ROOT / "data" / "pcs.json"]),
        ("positions.schema.json", None, [ROOT / "data" / "positions_chris.json"]),
        ("election.schema.json", None, sorted((ROOT / "data" / "elections").glob("*.json"))),
        ("computed.schema.json", None, sorted((ROOT / "data" / "computed").glob("*/*.json"))),
    ]
    for schema, ptr, files in targets:
        v = validator(schema, reg, ptr)
        for f in files:
            if not f.exists():
                continue
            n_files += 1
            n_err += check(v, json.loads(f.read_text(encoding="utf-8")), str(f.relative_to(ROOT)))

    if args.research:
        r = ROOT / "research"
        jsonl = [
            ("/$defs/video", r / "index" / "videos.jsonl"),
            ("/$defs/capture", r / "captures" / "manifest.jsonl"),
        ]
        for ptr, f in jsonl:
            if not f.exists():
                continue
            v = validator("research.schema.json", reg, ptr)
            for i, line in enumerate(f.read_text(encoding="utf-8").splitlines(), 1):
                if line.strip():
                    n_files += 1
                    n_err += check(v, json.loads(line), f"{f.name}:{i}")
        v = validator("research.schema.json", reg, "/$defs/digitized")
        for f in sorted((r / "digitized").glob("*.json")):
            n_files += 1
            n_err += check(v, json.loads(f.read_text(encoding="utf-8")), f.name)

    status = "OK" if n_err == 0 else "ÉCHEC"
    print(f"{status} : {n_files} fichier(s) vérifié(s), {n_err} erreur(s)")
    return 1 if n_err else 0


if __name__ == "__main__":
    sys.exit(main())
