"""Tests de fumée des contrats : schémas valides, références résolues, exemples conformes.

Ces tests ne dépendent que de `jsonschema` (extra « dev ») et tournent donc en CI.
"""

from __future__ import annotations

import copy
import importlib.util
import json
from pathlib import Path
from types import ModuleType

import pytest
from jsonschema import Draft202012Validator

ROOT = Path(__file__).resolve().parents[2]
SCHEMAS = ROOT / "schemas"


def _load_validate_module() -> ModuleType:
    """Charge scripts/validate.py par chemin (scripts/ n'est pas un paquet)."""
    spec = importlib.util.spec_from_file_location("sg_validate", ROOT / "scripts" / "validate.py")
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


validate = _load_validate_module()

SOURCE = {
    "id": "insee-rp",
    "title": "Recensement de la population",
    "url": "https://www.insee.fr",
    "accessed": "2026-10-31",
}
DIPLOMES = {
    "bac5": 10,
    "bac3": 10,
    "bac2": 10,
    "bac": 20,
    "cap": 25,
    "brevet": 10,
    "certif_aucun": 15,
}
PCS_DOC = {
    "nomenclature": "PCS2003-N2",
    "reference_year": 2021,
    "sources": [SOURCE],
    "items": [
        {
            "code": "10",
            "group": "1",
            "population": 400_000.0,
            "niveau_vie_mensuel_eur": 2100.0,
            "patrimoine_keur": 600.0,
            "diplomes": DIPLOMES,
            "source_refs": ["insee-rp"],
        }
    ],
}
ELECTION_DOC = {
    "id": "2022_presidentielle_t1",
    "type": "presidentielle",
    "year": 2022,
    "round": 1,
    "label": "Présidentielle 2022 (1er tour)",
    "pcs_level": 1,
    "sources": [SOURCE],
    "candidates": [{"id": "cand-a", "label": "Candidat A", "color": "#ff9f0e"}],
    "composition": {
        "cand-a": {"1": 1.0, "2": 4.0, "3": 12.0, "4": 14.0, "5": 11.0, "6": 7.0, "7": 51.0}
    },
}
COMPUTED_DOC = {
    "method": "ranks_chris_v1",
    "params": {},
    "election_id": "2022_presidentielle_t1",
    "axes": {"x_label": "Exploitation", "y_label": "Domination", "range": [-10, 10]},
    "pcs": [
        {
            "code": "10",
            "group": "1",
            "label": "Agriculteurs exploitants",
            "x": 1.0,
            "y": -2.0,
            "weight": 1.5,
        }
    ],
    "candidates": [
        {
            "id": "cand-a",
            "label": "Candidat A",
            "color": "#ff9f0e",
            "x": 0.5,
            "y": -3.0,
            "ellipse": {"rx": 0.3, "ry": 0.2, "angle_deg": 12.0},
        }
    ],
    "population_barycenter": {"x": 0.0, "y": -1.0},
}
VIDEO = {
    "id": "abc123",
    "title": "Titre",
    "channel": "Chaîne",
    "upload_date": "20250101",
    "url": "https://www.youtube.com/watch?v=abc123",
    "relevance": "core",
    "chart_segments": [{"start_s": 10.0, "end_s": 50.0, "keywords": ["graphique"]}],
}
CAPTURE = {
    "video_id": "abc123",
    "timestamp_s": 42.0,
    "file": "abc123_42.png",
    "phash": "ffff0000ffff0000",
}
DIGITIZED = {
    "version_id": "v2025-01",
    "date": "2025-01-15",
    "source": {"video_id": "abc123", "timestamp_s": 42.0},
    "axes": {"x_label": "Exploitation", "y_label": "Domination", "range": [-10, 10]},
    "points": [{"kind": "pcs", "label": "Ouvriers", "code": "6", "x": -5.0, "y": -6.0}],
}


@pytest.fixture(scope="module")
def registry():
    return validate.load_registry()


def _errors(registry, schema: str, doc: object, pointer: str | None = None) -> list:
    return list(validate.validator(schema, registry, pointer).iter_errors(doc))


@pytest.mark.parametrize("path", sorted(SCHEMAS.glob("*.schema.json")), ids=lambda p: p.name)
def test_schema_is_valid_draft_2020_12(path: Path) -> None:
    Draft202012Validator.check_schema(json.loads(path.read_text(encoding="utf-8")))


@pytest.mark.parametrize(
    ("schema", "doc"),
    [
        ("pcs.schema.json", PCS_DOC),
        ("election.schema.json", ELECTION_DOC),
        ("computed.schema.json", COMPUTED_DOC),
    ],
)
def test_valid_examples_pass(registry, schema: str, doc: dict) -> None:
    assert _errors(registry, schema, doc) == []


def test_source_reference_is_resolved_and_enforced(registry) -> None:
    bad = copy.deepcopy(ELECTION_DOC)
    bad["sources"] = [{"id": "sans-titre-ni-url"}]
    assert _errors(registry, "election.schema.json", bad), "source.schema.json doit être appliqué"


@pytest.mark.parametrize("missing", ["items", "sources", "reference_year"])
def test_pcs_required_fields(registry, missing: str) -> None:
    bad = copy.deepcopy(PCS_DOC)
    del bad[missing]
    assert _errors(registry, "pcs.schema.json", bad)


def test_unknown_diploma_key_rejected(registry) -> None:
    bad = copy.deepcopy(PCS_DOC)
    bad["items"][0]["diplomes"]["doctorat"] = 1.0
    assert _errors(registry, "pcs.schema.json", bad)


def test_candidate_color_must_be_hex(registry) -> None:
    bad = copy.deepcopy(ELECTION_DOC)
    bad["candidates"][0]["color"] = "orange"
    assert _errors(registry, "election.schema.json", bad)


@pytest.mark.parametrize(
    ("pointer", "doc"),
    [("/$defs/video", VIDEO), ("/$defs/capture", CAPTURE), ("/$defs/digitized", DIGITIZED)],
)
def test_research_definitions(registry, pointer: str, doc: dict) -> None:
    assert _errors(registry, "research.schema.json", doc, pointer) == []


def test_repository_data_is_valid(capsys) -> None:
    """Tous les fichiers de contrat présents dans data/ respectent leur schéma."""
    code = validate.main([])
    assert code == 0, capsys.readouterr().out
