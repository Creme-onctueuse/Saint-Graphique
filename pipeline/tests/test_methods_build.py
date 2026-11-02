"""CLI ``pipeline.build``, chargeurs, jeu fictif et fixture de parité (jeu FICTIF, CI publique)."""

from __future__ import annotations

import copy
import importlib.util
import json
import sys
from pathlib import Path
from types import ModuleType
from typing import Any

import pytest

from pipeline import build
from pipeline.model import (
    ROOT,
    DataValidationError,
    load_election,
    load_elections,
    load_methods_config,
    load_pcs,
    load_pcs_config,
    read_json,
    validate_instance,
)

FAKE = ROOT / "pipeline" / "tests" / "fixtures" / "fake"
PRES = "2099_presidentielle_t1"
EURO = "2099_europeennes"
TARGETS = ("population", EURO, PRES)
BOOTSTRAPPED = ("read_positions", "ranks_jnthnbs", "continuous")
PARITY = ("ranks_jnthnbs", "continuous")
ALL_METHODS = ("read_positions", "ranks_jnthnbs", "continuous", "mca")


def _load_fake_data_module() -> ModuleType:
    """Charge scripts/fake_data.py par chemin (scripts/ n'est pas un paquet)."""
    spec = importlib.util.spec_from_file_location("sg_fake_data", ROOT / "scripts" / "fake_data.py")
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def _build(out_dir: Path, *options: str) -> int:
    return build.main(["--data-dir", str(FAKE), "--out-dir", str(out_dir), *options])


def _write(path: Path, document: Any) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(document, ensure_ascii=False), encoding="utf-8")
    return path


def _assert_close(actual: Any, expected: Any, where: str = "$") -> None:
    """Égalité structurelle, à 1e-12 près sur les flottants (plateformes différentes en CI)."""
    if isinstance(expected, dict):
        assert actual.keys() == expected.keys(), where
        for key, value in expected.items():
            _assert_close(actual[key], value, f"{where}.{key}")
    elif isinstance(expected, list):
        assert len(actual) == len(expected), where
        for i, value in enumerate(expected):
            _assert_close(actual[i], value, f"{where}[{i}]")
    elif isinstance(expected, float):
        assert actual == pytest.approx(expected, abs=1e-12), where
    else:
        assert actual == expected, where


@pytest.fixture(scope="module")
def built(tmp_path_factory: pytest.TempPathFactory) -> Path:
    """Construction complète du jeu fictif, partagée par les tests de lecture."""
    out_dir = tmp_path_factory.mktemp("computed")
    assert _build(out_dir, "--n-boot", "50") == 0
    return out_dir


# --- Fichiers calculés -----------------------------------------------------------------------


@pytest.mark.parametrize("method", ALL_METHODS)
@pytest.mark.parametrize("target", TARGETS)
def test_methods_build_documents_follow_the_schema(built: Path, method: str, target: str) -> None:
    document = read_json(built / method / f"{target}.json")
    validate_instance(document, "computed.schema.json", f"{method}/{target}")
    assert document["method"] == method and document["election_id"] == target
    assert document["axes"] == {"x_label": "Exploitation", "y_label": "Domination",
                                "range": [-10, 10]}
    assert "description" not in document["params"]
    if method == "read_positions":
        # Postes lus : 41 points, poids lus ou estimés, donc une somme proche de 100 seulement.
        assert len(document["pcs"]) == 41
        assert sum(p["weight"] for p in document["pcs"]) == pytest.approx(100, abs=3)
        assert all(p["note"] for p in document["pcs"])
        assert document["sources"]
    else:
        assert len(document["pcs"]) == 30
        # Somme des poids : 100 % à l'arrondi de publication près (1e-6 par PCS).
        assert sum(p["weight"] for p in document["pcs"]) == pytest.approx(100, abs=1e-4)
        assert sum(g["weight"] for g in document["groups"]) == pytest.approx(100, abs=1e-4)
        # Les libellés viennent de config/pcs.yaml, pas des fichiers de données.
        labels = {p["code"]: p["label"] for p in document["pcs"]}
        assert labels == {str(i["code"]): i["label"] for i in load_pcs_config()["items"]}
    if target == "population":
        assert document["candidates"] == []
    else:
        assert document["candidates"]


@pytest.mark.parametrize("target", [PRES, EURO])
def test_methods_build_ellipses_only_where_requested(built: Path, target: str) -> None:
    for method in BOOTSTRAPPED:
        document = read_json(built / method / f"{target}.json")
        assert document["bootstrap"]["n_boot"] == 50 and document["bootstrap"]["level"] == 0.95
        for candidate in document["candidates"]:
            assert candidate["ellipse"]["rx"] >= candidate["ellipse"]["ry"] > 0
    document = read_json(built / "mca" / f"{target}.json")
    assert "bootstrap" not in document
    assert all("ellipse" not in c for c in document["candidates"])


def test_methods_build_candidate_fields_come_from_the_election(built: Path) -> None:
    document = read_json(built / "ranks_jnthnbs" / f"{PRES}.json")
    election = load_election(FAKE / "elections" / f"{PRES}.json")
    assert [c["id"] for c in document["candidates"]] == [c.id for c in election.candidates]
    by_id = {c["id"]: c for c in document["candidates"]}
    assert by_id["abstention"]["is_abstention"] is True
    assert by_id["abstention"]["national_share_pct"] == 25.3
    assert by_id["candidat-a"]["is_abstention"] is False
    assert by_id["candidat-a"]["color"] == "#c9191e"


def test_methods_build_is_reproducible(built: Path, tmp_path: Path) -> None:
    """Graine fixe : relancer ne change aucun fichier, hormis la date de l'index."""
    assert _build(tmp_path, "--n-boot", "50") == 0
    for method in ALL_METHODS:
        for target in TARGETS:
            relative = Path(method) / f"{target}.json"
            assert (tmp_path / relative).read_bytes() == (built / relative).read_bytes()
    first, second = read_json(built / "index.json"), read_json(tmp_path / "index.json")
    del first["generated_at"], second["generated_at"]
    assert first == second


# --- index.json ------------------------------------------------------------------------------


def test_methods_build_index(built: Path) -> None:
    index = read_json(built / "index.json")
    assert index["generated_at"]
    assert index["path_template"] == "{method}/{election}.json"
    assert index["axes"]["x_label"] == "Exploitation" and index["axes"]["y_label"] == "Domination"
    assert index["axes"]["x_hint"] and index["axes"]["y_hint"]
    assert index["axes"]["range"] == [-10, 10]
    assert [m["id"] for m in index["methods"]] == list(ALL_METHODS)  # ordre de methods.yaml
    assert index["default_method"] == "read_positions"
    for method in index["methods"]:
        assert method["label"] and method["description"]
        assert method["elections"][0] == "population"
        assert set(method["elections"]) == set(TARGETS)
        assert method["ellipses"] is (method["id"] in BOOTSTRAPPED)
    elections = {e["id"]: e for e in index["elections"]}
    assert index["elections"][0]["id"] == "population"
    assert set(elections) == set(TARGETS)
    assert elections[PRES] == {"id": PRES, "label": "Présidentielle fictive 2099 (1er tour)",
                               "type": "presidentielle", "year": 2099, "round": 1}
    assert [g["code"] for g in index["groups"]] == list("12345678")
    assert all(g["label"] and g["color"].startswith("#") for g in index["groups"])


# --- Options de la CLI -----------------------------------------------------------------------


def test_methods_build_filters(tmp_path: Path) -> None:
    assert _build(tmp_path, "--method", "continuous", "--election", "population") == 0
    written = sorted(p.relative_to(tmp_path).as_posix() for p in tmp_path.rglob("*.json"))
    assert written == ["continuous/population.json", "index.json"]
    index = read_json(tmp_path / "index.json")
    assert [(m["id"], m["elections"]) for m in index["methods"]] == [("continuous", ["population"])]
    # Un second filtre complète l'index sans effacer le fichier déjà construit.
    assert _build(tmp_path, "--method", "continuous", "--election", PRES, "--no-bootstrap") == 0
    index = read_json(tmp_path / "index.json")
    assert index["methods"][0]["elections"] == ["population", PRES]
    assert index["methods"][0]["ellipses"] is False


def test_methods_build_no_bootstrap(tmp_path: Path) -> None:
    assert _build(tmp_path, "--method", "ranks_jnthnbs", "--no-bootstrap") == 0
    document = read_json(tmp_path / "ranks_jnthnbs" / f"{PRES}.json")
    assert "bootstrap" not in document
    assert all("ellipse" not in c for c in document["candidates"])


def test_methods_build_bootstrap_options(tmp_path: Path) -> None:
    options = ("--method", "continuous", "--election", EURO, "--n-boot", "20", "--seed", "4",
               "--bootstrap-kind", "normal")
    assert _build(tmp_path, *options) == 0
    bootstrap = read_json(tmp_path / "continuous" / f"{EURO}.json")["bootstrap"]
    assert bootstrap == {"n_boot": 20, "margin_pts": 3.0, "kind": "normal", "seed": 4,
                         "level": 0.95}


def test_methods_build_removes_stale_files_on_full_build_only(tmp_path: Path) -> None:
    stale = _write(tmp_path / "continuous" / "ancienne_election.json", {"obsolete": True})
    assert _build(tmp_path, "--method", "continuous", "--election", "population") == 0
    assert stale.exists()  # build partiel : rien n'est supprimé
    assert _build(tmp_path, "--method", "continuous", "--no-bootstrap") == 0
    assert not stale.exists()
    assert (tmp_path / "continuous" / "population.json").exists()


def test_methods_build_out_dir_defaults_inside_data_dir(tmp_path: Path) -> None:
    data_dir = tmp_path / "jeu"
    for source in [FAKE / "pcs.json", *sorted((FAKE / "elections").glob("*.json"))]:
        _write(data_dir / source.relative_to(FAKE), read_json(source))
    argv = ["--data-dir", str(data_dir), "--method", "continuous", "--election", "population"]
    assert build.main(argv) == 0
    assert (data_dir / "computed" / "continuous" / "population.json").exists()
    assert (data_dir / "computed" / "index.json").exists()


def test_methods_build_error_codes(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    assert build.main(["--data-dir", str(tmp_path)]) == 1
    assert "introuvable" in capsys.readouterr().err
    assert _build(tmp_path, "--method", "inconnue") == 1
    assert "inconnue" in capsys.readouterr().err
    assert _build(tmp_path, "--election", "2099_inconnue") == 1
    assert "2099_inconnue" in capsys.readouterr().err
    invalid = tmp_path / "invalide"
    _write(invalid / "pcs.json", {"nomenclature": "x"})
    assert build.main(["--data-dir", str(invalid)]) == 1
    assert "non conforme" in capsys.readouterr().err
    assert not list(tmp_path.rglob("index.json"))


# --- Fixture de parité Python/TypeScript -----------------------------------------------------


def test_methods_parity_fixture_is_up_to_date(tmp_path: Path) -> None:
    """``web/src/core/__fixtures__/parity.json`` est à jour : régénérer ne change rien."""
    assert build.PARITY_PATH.exists(), "uv run python -m pipeline.build --parity"
    regenerated = tmp_path / "parity.json"
    assert build.main(["--parity", str(regenerated)]) == 0
    _assert_close(read_json(regenerated), read_json(build.PARITY_PATH))


def test_methods_parity_fixture_only_contains_fictitious_data() -> None:
    parity = read_json(build.PARITY_PATH)
    assert parity["source"] == "pipeline/tests/fixtures/fake"
    assert parity["generated_by"] == "uv run python -m pipeline.build --parity"
    assert [e["id"] for e in parity["input"]["elections"]] == [EURO, PRES]
    assert [p["code"] for p in parity["input"]["pcs"]] == [
        p.code for p in load_pcs(FAKE / "pcs.json").items
    ]
    fake_population = {p.code: p.population for p in load_pcs(FAKE / "pcs.json").items}
    assert {p["code"]: p["population"] for p in parity["input"]["pcs"]} == fake_population
    cases = {(c["method"], c["election_id"]) for c in parity["cases"]}
    assert cases == {(m, e) for m in PARITY for e in (EURO, PRES)}
    # Mêmes ex æquo que le jeu fictif : le portage doit appliquer le même départage.
    by_code = {p["code"]: p for p in parity["input"]["pcs"]}
    assert by_code["62"]["patrimoine_keur"] == by_code["63"]["patrimoine_keur"]
    assert by_code["67"]["diplomes"] == by_code["68"]["diplomes"]


def test_methods_parity_uses_the_declared_parameters() -> None:
    """Les paramètres publiés sont ceux de ``config/methods.yaml``."""
    config = load_methods_config()
    for case in read_json(build.PARITY_PATH)["cases"]:
        declared = config["methods"][case["method"]]
        assert case["params"]["y_weights"] == declared["y_weights"]
        assert case["params"]["retired_y_override"] == declared["retired_y_override"]
        assert case["params"]["range"] == config["axes"]["range"]


# --- Jeu fictif ------------------------------------------------------------------------------


def test_methods_fake_data_matches_the_committed_fixture(tmp_path: Path) -> None:
    """Tirage entier : même graine, mêmes fichiers, sur toutes les plateformes."""
    fake_data = _load_fake_data_module()
    pcs, elections = fake_data.generate()
    assert pcs == read_json(FAKE / "pcs.json")
    assert {e["id"]: e for e in elections} == {
        path.stem: read_json(path) for path in (FAKE / "elections").glob("*.json")
    }
    assert fake_data.generate(seed=1)[0] != pcs
    assert fake_data.main([str(tmp_path)]) == 0
    assert read_json(tmp_path / "pcs.json") == pcs
    assert len(list((tmp_path / "elections").glob("*.json"))) == 2


def test_methods_fake_data_has_the_announced_particularities() -> None:
    pcs = load_pcs(FAKE / "pcs.json")
    assert len(pcs.items) == 30 and pcs.reference_year == 2099
    elections = {e.id: e for e in load_elections(FAKE / "elections")}
    assert elections[PRES].pcs_level == 1 and elections[PRES].margin_pts == 3.0
    assert elections[PRES].composition["candidate-d"]["1"] == 0
    assert elections[EURO].pcs_level == 2 and elections[EURO].margin_pts is None
    assert all("81" in shares for shares in elections[EURO].composition.values())
    for election in elections.values():
        for shares in election.composition.values():
            assert sum(shares.values()) == pytest.approx(100)
    for item in pcs.items:
        assert sum(item.diplomes.values()) == pytest.approx(100)


# --- Chargeurs -------------------------------------------------------------------------------


def test_methods_model_adds_labels_from_config() -> None:
    pcs = load_pcs(FAKE / "pcs.json")
    by_code = {p.code: p for p in pcs.items}
    assert by_code["23"].short == "Chefs d'entreprise"
    assert pcs.groups["3"].label == "Cadres et professions intellectuelles supérieures"
    assert pcs.groups["3"].color == "#4b0082"


def test_methods_model_falls_back_for_codes_absent_from_config(tmp_path: Path) -> None:
    document = read_json(FAKE / "pcs.json")
    document["items"][0].update(code="99", group="8")
    config = load_pcs_config()
    del config["groups"]["8"]
    pcs = load_pcs(_write(tmp_path / "pcs.json", document), pcs_config=config)
    assert (pcs.items[0].label, pcs.items[0].short) == ("99", "99")
    assert pcs.groups["8"].label == "Groupe 8"


def test_methods_model_rejects_invalid_pcs(tmp_path: Path) -> None:
    source = read_json(FAKE / "pcs.json")
    missing = copy.deepcopy(source)
    del missing["items"][0]["diplomes"]["bac5"]
    with pytest.raises(DataValidationError, match="bac5"):
        load_pcs(_write(tmp_path / "manque.json", missing))
    duplicate = copy.deepcopy(source)
    duplicate["items"][1]["code"] = duplicate["items"][0]["code"]
    with pytest.raises(DataValidationError, match="en double"):
        load_pcs(_write(tmp_path / "double.json", duplicate))
    empty = copy.deepcopy(source)
    for item in empty["items"]:
        item["population"] = 0
    with pytest.raises(DataValidationError, match="population totale nulle"):
        load_pcs(_write(tmp_path / "vide.json", empty))


def test_methods_model_rejects_invalid_elections(tmp_path: Path) -> None:
    source = read_json(FAKE / "elections" / f"{PRES}.json")
    color = copy.deepcopy(source)
    color["candidates"][1]["color"] = "rouge"
    with pytest.raises(DataValidationError, match="rouge"):
        load_election(_write(tmp_path / "couleur.json", color))
    duplicate = copy.deepcopy(source)
    duplicate["candidates"][1]["id"] = duplicate["candidates"][0]["id"]
    with pytest.raises(DataValidationError, match="en double"):
        load_election(_write(tmp_path / "double.json", duplicate))
    unknown = copy.deepcopy(source)
    unknown["composition"]["fantome"] = {"1": 100}
    with pytest.raises(DataValidationError, match="fantome"):
        load_election(_write(tmp_path / "fantome.json", unknown))
    _write(tmp_path / "dossier" / "autre_nom.json", source)
    with pytest.raises(DataValidationError, match="ne correspond pas"):
        load_elections(tmp_path / "dossier")
