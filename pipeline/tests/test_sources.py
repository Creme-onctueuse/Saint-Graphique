"""Tests des sources : petites fixtures et fichiers du dépôt, jamais de réseau ni de cache."""

from __future__ import annotations

import importlib.util
import json
import re
import socket
import sys
from pathlib import Path

import pandas as pd
import pytest

from pipeline.model import load_elections, load_pcs, validate_instance
from pipeline.sources import (
    _cache,
    _rp2022_indreg,
    insee_diplomes,
    insee_population,
    insee_revenus_patrimoine,
    sondages,
)
from pipeline.sources._common import (
    ACTIVE_PCS_CODES,
    DIPLOMA_KEYS,
    MANUAL_DIR,
    PCS_CODES,
    ROOT,
    load_elections_config,
    load_pcs_config,
)

DATA = ROOT / "data"
ELECTION_IDS = [e["id"] for e in load_elections_config()]


@pytest.fixture(autouse=True)
def no_network(monkeypatch: pytest.MonkeyPatch) -> None:
    """Tout accès réseau fait échouer le test."""

    def refuse(*_args: object, **_kwargs: object) -> None:
        raise AssertionError("accès réseau interdit dans les tests")

    monkeypatch.setattr(socket.socket, "connect", refuse)


# --- Cache ----------------------------------------------------------------------------------


def test_cache_dir_uses_environment_variable(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    target = tmp_path / "ailleurs"
    monkeypatch.setenv("SG_CACHE_DIR", str(target))
    assert _cache.cache_dir("a", "b") == target / "a" / "b"
    assert (target / "a" / "b").is_dir()


def test_cache_dir_defaults_by_platform(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.delenv("SG_CACHE_DIR", raising=False)
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path / "local"))
    monkeypatch.setattr(_cache.sys, "platform", "win32")
    assert _cache.default_cache_dir() == tmp_path / "local" / "saint-graphique" / "cache"

    monkeypatch.setattr(_cache.sys, "platform", "linux")
    monkeypatch.setenv("XDG_CACHE_HOME", str(tmp_path / "xdg"))
    assert _cache.default_cache_dir() == tmp_path / "xdg" / "saint-graphique"

    monkeypatch.delenv("XDG_CACHE_HOME")
    monkeypatch.setattr(Path, "home", lambda: tmp_path / "home")
    assert _cache.default_cache_dir() == tmp_path / "home" / ".cache" / "saint-graphique"


def test_modules_do_not_write_cache_in_repository() -> None:
    for module in Path(sondages.__file__).parent.glob("*.py"):
        assert "pipeline/cache" not in module.read_text(encoding="utf-8").replace("\\", "/")


# --- Conversion de Bayes --------------------------------------------------------------------


def test_bayes_matches_hand_computation() -> None:
    vote = pd.DataFrame({"g1": [60.0, 40.0], "g2": [40.0, 60.0]}, index=["a", "b"])
    weights = pd.Series({"g1": 1.0, "g2": 3.0})
    result = sondages.bayes_composition(vote, weights)
    assert result.loc["a", "g1"] == pytest.approx(100 * 60 / 180)
    assert result.loc["a", "g2"] == pytest.approx(100 * 120 / 180)
    assert result.loc["b", "g1"] == pytest.approx(100 * 40 / 220)
    assert result.loc["b", "g2"] == pytest.approx(100 * 180 / 220)


def test_bayes_sums_to_100_per_candidate() -> None:
    vote = pd.DataFrame({"g1": [10.0, 5.0, 85.0], "g2": [20.0, 30.0, 50.0]}, index=list("abc"))
    result = sondages.bayes_composition(vote, pd.Series({"g1": 7.0, "g2": 2.0}))
    assert result.sum(axis=1).to_numpy() == pytest.approx([100.0, 100.0, 100.0])


def test_bayes_with_uniform_vote_gives_group_weights() -> None:
    vote = pd.DataFrame({"g1": [30.0], "g2": [30.0]}, index=["a"])
    result = sondages.bayes_composition(vote, pd.Series({"g1": 1.0, "g2": 4.0}))
    assert result.loc["a"].to_list() == pytest.approx([20.0, 80.0])


def test_bayes_recovers_composition_from_consistent_scores() -> None:
    """Sur un électorat fictif complet, le score impliqué égale le score national."""
    voters = pd.DataFrame({"g1": [30.0, 70.0], "g2": [90.0, 10.0]}, index=["a", "b"])
    totals = voters.sum()
    vote = voters / totals * 100.0
    result = sondages.bayes_composition(vote, totals)
    expected = voters.div(voters.sum(axis=1), axis=0) * 100.0
    pd.testing.assert_frame_equal(result, expected)
    implied = sondages.implied_national_shares(vote, totals)
    assert implied["a"] == pytest.approx(100 * 120 / 200)


def test_bayes_rejects_missing_weight_and_empty_candidate() -> None:
    vote = pd.DataFrame({"g1": [10.0], "g2": [0.0]}, index=["a"])
    with pytest.raises(ValueError, match="Poids manquants"):
        sondages.bayes_composition(vote, pd.Series({"g1": 1.0}))
    with pytest.raises(ValueError, match="sans voix"):
        sondages.bayes_composition(vote * 0, pd.Series({"g1": 1.0, "g2": 1.0}))


def _table(text: str, tmp_path: Path) -> sondages.PollTable:
    path = tmp_path / "exemple.csv"
    path.write_text(text, encoding="utf-8")
    return sondages.parse_manual_csv(path)


HEADER = """# source_id: exemple
# title: Exemple
# publisher: Ifop
# url: https://example.org/rapport.pdf
# accessed: 2026-10-31
# cache_file: rapport.pdf
# group_labels: 3=Cadre; 6=Ouvrier; 8=Autre inactif
# kind: {kind}
candidate_id,label,famille,national_share_pct,is_abstention,3,6,8
"""


def test_vote_table_weights_candidates_by_turnout(tmp_path: Path) -> None:
    table = _table(
        HEADER.format(kind="vote").replace("3,6,8", "3,6")
        + "a,A,lr,100,,100,100\nabstention,Abstention,abstention,25,true,50,0\n",
        tmp_path,
    )
    result = sondages.composition_from_vote(table, pd.Series({"3": 100.0, "6": 100.0}))
    # 50 votants chez les cadres contre 100 chez les ouvriers.
    assert result.loc["a"].to_list() == pytest.approx([100 / 3, 200 / 3])
    # Les abstentionnistes se calculent sur les inscrits.
    assert result.loc["abstention"].to_list() == pytest.approx([100.0, 0.0])


def test_vote_table_requires_electorate(tmp_path: Path) -> None:
    table = _table(
        HEADER.format(kind="vote").replace("3,6,8", "3,6") + "a,A,lr,100,,10,20\n", tmp_path
    )
    with pytest.raises(ValueError, match="inscrits"):
        sondages.table_composition(table)


def test_compare_with_bayes_on_common_groups(tmp_path: Path) -> None:
    vote = _table(
        HEADER.format(kind="vote").replace("3,6,8", "3,6") + "a,A,lr,100,,100,100\n", tmp_path
    )
    published = _table(
        HEADER.format(kind="composition") + "a,A,lr,100,,30,50,20\nb,B,rn,1,,1,1,98\n", tmp_path
    )
    gaps = sondages.compare_with_bayes(vote, published, pd.Series({"3": 1.0, "6": 1.0}))
    assert list(gaps.index) == ["a"]
    assert gaps.loc["a", "ecart_max_pts"] == pytest.approx(100 * 5 / 8 - 50)


# --- CSV transcrits -------------------------------------------------------------------------


def test_dash_reads_as_zero_and_inactive_is_removed(tmp_path: Path) -> None:
    table = _table(HEADER.format(kind="composition") + "a,A,lr,10,,-,75,25\n", tmp_path)
    assert table.rows.loc["a", "3"] == 0.0
    result = sondages.published_composition(table)
    assert list(result.columns) == ["3", "6"]
    assert result.loc["a"].to_list() == pytest.approx([0.0, 100.0])


def test_missing_header_is_rejected(tmp_path: Path) -> None:
    text = HEADER.format(kind="composition").replace("# url: https://example.org/rapport.pdf\n", "")
    with pytest.raises(ValueError, match="url"):
        _table(text + "a,A,lr,10,,1,2,3\n", tmp_path)


def test_unknown_family_is_rejected(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="sans couleur"):
        _table(HEADER.format(kind="composition") + "a,A,inconnue,10,,1,2,3\n", tmp_path)


@pytest.mark.parametrize("election_id", ELECTION_IDS)
def test_transcribed_table_is_complete(election_id: str) -> None:
    table = sondages.load_table(election_id)
    assert table.kind == "composition"
    assert table.meta["url"].startswith("https://")
    assert re.fullmatch(r"[0-9a-f]{64}", table.meta["sha256"])
    assert int(table.rows["is_abstention"].sum()) == 1
    assert table.groups == ("2", "3", "4", "5", "6", "7", "8")
    # Parts telles que publiées, inactifs compris : 100 aux arrondis près. Les européennes 2019
    # descendent à 96,5 : une part de « Catégorie supérieure » n'y est pas détaillée.
    totals = table.rows[list(table.groups)].astype(float).sum(axis=1)
    assert totals.between(96.0, 101.5).all(), totals.to_dict()


def test_control_table_is_a_vote_table_excluded_from_data() -> None:
    table = sondages.control_table()
    assert table.kind == "vote"
    assert table.groups == ("3", "4", "5", "6", "7")
    assert not (DATA / "elections" / f"{table.meta['source_id']}.json").exists()


def test_election_document_follows_schema(tmp_path: Path) -> None:
    table = _table(
        HEADER.format(kind="composition")
        + "a,Candidat A,lr,10,,20,60,20\nabstention,Abstention,abstention,30,true,40,40,20\n",
        tmp_path,
    )
    config = {"id": "2099_test", "type": "presidentielle", "year": 2099, "round": 1, "label": "T"}
    document = sondages.election_document(config, table)
    validate_instance(document, "election.schema.json", "fixture")
    assert document["composition"]["a"] == {"3": 25.0, "6": 75.0}
    assert document["candidates"][1]["is_abstention"] is True
    assert "is_abstention" not in document["candidates"][0]
    assert "accord exprès" in document["sources"][0]["license"]


# --- Recensement ----------------------------------------------------------------------------


def test_classify_rules() -> None:
    stat_cs = pd.Series(["153", "246", "343", "338", "199", "299", "300", "200", "ZZZ"])
    tact = pd.Series(["11", "12", "24", "21", "11", "12", "22", "12", "23"])
    expected = ["53", "46", "8", "7", "8", "8", "8", "8", "8"]
    assert _rp2022_indreg.classify(stat_cs, tact).to_list() == expected


def test_aggregate_frame_excludes_under_15_and_flags_electorate() -> None:
    frame = pd.DataFrame(
        {
            "AGEREV": ["014", "016", "040", "040"],
            "DIPL": ["ZZ", "12", "18", "18"],
            "ETUD": ["1", "1", "2", "2"],
            "INAT": ["11", "11", "21", "12"],
            "IPONDI": [5.0, 2.0, 3.0, 4.0],
            "STAT_CS": ["ZZZ", "156", "138", "138"],
            "TACT": ["23", "11", "11", "11"],
        }
    ).astype({c: "string" for c in ["AGEREV", "DIPL", "ETUD", "INAT", "STAT_CS", "TACT"]})
    agg = _rp2022_indreg.aggregate_frame(frame)
    assert agg["poids"].sum() == pytest.approx(9.0)
    young = agg[agg["pcs"] == "56"].iloc[0]
    assert (young["adulte18"], young["francais"], young["diplome"]) == ("0", "1", "brevet")
    adults = agg[agg["pcs"] == "38"].set_index("francais")["poids"]
    assert adults.to_dict() == {"0": 3.0, "1": 4.0}


@pytest.mark.parametrize(
    ("code", "key"),
    [("01", "certif_aucun"), ("03", "certif_aucun"), ("11", "certif_aucun"), ("12", "brevet"),
     ("13", "cap"), ("14", "bac"), ("15", "bac"), ("16", "bac2"), ("17", "bac3"),
     ("18", "bac5"), ("19", "bac5")],
)  # fmt: skip
def test_diploma_mapping(code: str, key: str) -> None:
    assert _rp2022_indreg.DIPL_TO_KEY[code] == key


def _fake_aggregate() -> pd.DataFrame:
    rows = []
    for index, code in enumerate(PCS_CODES):
        for diplome in DIPLOMA_KEYS:
            rows.append((code, diplome, "2", "1", "1", 10.0 + index))
        rows.append((code, "bac5", "1", "1", "1", 1000.0))  # scolarisés : hors diplômes
        rows.append((code, "bac", "2", "1", "0", 5.0))  # étrangers : hors corps électoral
    rows.append(("8", "bac", "2", "1", "1", 50.0))
    columns = ["pcs", "diplome", "etud", "adulte18", "francais", "poids"]
    return pd.DataFrame(rows, columns=columns)


def test_population_covers_the_30_pcs() -> None:
    population = insee_population.population_from_aggregate(_fake_aggregate())
    assert population["code"].to_list() == list(PCS_CODES)
    assert len(population) == 30
    assert population.set_index("code").loc["7", "group"] == "7"
    assert population.set_index("code").loc["10", "group"] == "1"


def test_population_rejects_missing_pcs() -> None:
    agg = _fake_aggregate()
    with pytest.raises(ValueError, match="absentes"):
        insee_population.population_from_aggregate(agg[agg["pcs"] != "44"])


def test_electorate_keeps_french_adults_by_group() -> None:
    electorate = insee_population.electorate_from_aggregate(_fake_aggregate())
    assert list(electorate.index) == [str(g) for g in range(1, 9)]
    assert electorate["8"] == pytest.approx(50.0)
    # PCS 10 (indice 0) : 7 diplômes à 10, plus les scolarisés, sans les étrangers.
    assert electorate["1"] == pytest.approx(7 * 10.0 + 1000.0)


def test_diplomas_sum_to_100_without_students() -> None:
    diplomas = insee_diplomes.diplomas_from_aggregate(_fake_aggregate()).set_index("code")
    assert len(diplomas) == 30
    totals = diplomas[list(DIPLOMA_KEYS)].sum(axis=1)
    assert totals.to_numpy() == pytest.approx([100.0] * 30)
    assert diplomas.loc["10", "bac5"] == pytest.approx(10 / 75 * 100)  # 7 × 10 + 5 de « bac »


# --- Revenus et patrimoine ------------------------------------------------------------------


def _erfs_detail() -> dict[str, tuple[float | None, float | None]]:
    rows: list[tuple[object, ...]] = [
        ("TI02D - titre", None),
        ("dont\xa0: Agriculteurs exploitants et assimilés, artisans", 2000, 4.5, 31000.0, 24000.0),
    ]
    for index, (code, label) in enumerate(insee_revenus_patrimoine.ERFS_LABELS.items()):
        if code == "44":
            rows.append(("   Ministres du culte et religieux consacrés", "ns", "ns", "ns", "ns"))
        else:
            rows.append((f"  {label} (1) ", 100, 1.0, 30000.0 + index, 25000.0 + index))
    return insee_revenus_patrimoine.parse_erfs_rows(rows)


def _niveau_vie() -> pd.DataFrame:
    aggregate = insee_revenus_patrimoine.parse_erfs_rows(
        [("Professions intermédiaires", 6980, 13.3, 30510.0, 28370.0)]
    )
    return insee_revenus_patrimoine.niveau_vie_table(_erfs_detail(), aggregate)


def test_normalize_label_handles_accents_and_notes() -> None:
    label = "dont\xa0: Ingénieurs d’entreprise  (2) "
    assert insee_revenus_patrimoine.normalize_label(label) == "ingenieurs d'entreprise"


def test_ns_is_kept_as_missing() -> None:
    detail = insee_revenus_patrimoine.parse_erfs_rows([("Clergé", "ns", "ns", "ns", "ns")])
    assert detail == {"clerge": (None, None)}


def test_niveau_vie_imputations_are_flagged() -> None:
    table = _niveau_vie().set_index("code")
    imputed = table.index[table["niveau_vie_statut"] == insee_revenus_patrimoine.IMPUTE]
    assert sorted(imputed) == ["10", "21", "22", "23", "44"]
    assert table.loc["23", "niveau_vie_annuel_median_eur"] == 24000.0
    assert table.loc["44", "niveau_vie_annuel_median_eur"] == 28370.0  # groupe, car « ns »
    assert (table["niveau_vie_statut"] == insee_revenus_patrimoine.PUBLIE).sum() == 25


def test_missing_row_in_a_table_raises() -> None:
    detail = _erfs_detail()
    del detail["techniciens"]
    aggregate = {"professions intermediaires": (1.0, 1.0)}
    with pytest.raises(ValueError, match="techniciens"):
        insee_revenus_patrimoine.niveau_vie_table(detail, aggregate)


def test_median_from_bands_of_the_whole_population_is_d5() -> None:
    seuils = [10.0, 20.0, 30.0, 40.0, 50.0, 60.0, 70.0, 80.0, 90.0]
    median, low, high = insee_revenus_patrimoine.median_from_bands([10.0] * 10, seuils)
    assert (median, low, high) == (50.0, 40.0, 50.0)


def test_median_from_bands_interpolates_inside_the_band() -> None:
    seuils = [10.0, 20.0, 30.0, 40.0, 50.0, 60.0, 70.0, 80.0, 90.0]
    shares = [0.0, 0.0, 0.0, 0.0, 20.0, 40.0, 20.0, 10.0, 5.0, 5.0]  # total 100, moitié à 50
    median, low, high = insee_revenus_patrimoine.median_from_bands(shares, seuils)
    assert (low, high) == (50.0, 60.0)
    assert median == pytest.approx(50.0 + 30 / 40 * 10.0)
    assert low <= median <= high


def test_median_in_extreme_band_has_no_bound() -> None:
    seuils = [float(i) for i in range(1, 10)]
    with pytest.raises(ValueError, match="extrême"):
        insee_revenus_patrimoine.median_from_bands([90.0] + [1.0] * 9, seuils)


def _hvp() -> pd.DataFrame:
    labels = [
        "Agriculteurs",
        "Artisans, commerçants et chefs d'entreprise",
        "Professions libérales",
        "Cadres (autre que professions libérales)",
        "Professions intermédiaires",
        "Employés",
        "Ouvriers",
        "Retraités anciens agriculteurs, artisans, commerçants, chefs d'entreprise",
        "Retraités anciens cadres ou professions libérales",
        "Retraités anciennes professions intermédiaires ",
        "Retraités anciens employés et ouvriers ",
    ]
    montants = insee_revenus_patrimoine.parse_hvp_montants(
        [("Montants", None), (None, "moyen", "D1", "médian", "D9")]
        + [(lab, 1000.0 * (i + 2), 1, 1000.0 * (i + 1), 9) for i, lab in enumerate(labels)]
    )
    retired = labels[7:]
    bands = [
        "Inférieur au 1ᵉʳ décile ",
        *[f"Entre le {i}ᵉ et le {i + 1}ᵉ décile" for i in range(1, 9)],
        "Supérieur au 9e décile",
        "Entre le 9ᵉ décile et le 95ᵉ centile ",
    ]
    rows: list[tuple[object, ...]] = [(None, *retired)]
    rows += [(band, 10.0, 10.0, 10.0, 10.0) for band in bands]
    rows.append(("Ensemble", 1.0, 1.0, 1.0, 1.0))
    profil = insee_revenus_patrimoine.parse_hvp_profil(rows)
    seuils = insee_revenus_patrimoine.parse_hvp_seuils(
        [(None, "moyen"), ("Ensemble", 999.0, 1, 2, 3, 4, 5, 6, 7, 8, 9), ("Ensemble", 0, 0)]
    )
    return insee_revenus_patrimoine.patrimoine_table(montants, profil, seuils)


def test_patrimoine_is_imputed_except_published_categories() -> None:
    table = _hvp().set_index("code")
    assert sorted(table.index) == sorted(PCS_CODES)
    published = table.index[table["patrimoine_statut"] == insee_revenus_patrimoine.PUBLIE_MENAGE]
    assert sorted(published) == ["10", "31"]
    assert table.loc["7", "patrimoine_statut"] == insee_revenus_patrimoine.CALCULE
    assert (table["patrimoine_statut"] == insee_revenus_patrimoine.IMPUTE).sum() == 27
    # La médiane de la catégorie est appliquée telle quelle à toutes ses PCS.
    assert table.loc["33", "patrimoine_median_eur"] == table.loc["38", "patrimoine_median_eur"]
    # Répartition uniforme dans les tranches : la médiane des retraités est D5.
    assert table.loc["7", "patrimoine_median_eur"] == pytest.approx(5.0)
    # Moyenne exacte des 4 catégories, à parts égales.
    assert table.loc["7", "patrimoine_moyen_eur"] == pytest.approx(1000.0 * (9 + 10 + 11 + 12) / 4)


def test_notes_never_present_imputed_values_as_insee_data() -> None:
    table = insee_revenus_patrimoine.combine(_niveau_vie(), _hvp()).set_index("code")
    assert "Niveau de vie IMPUTÉ, pas une donnée Insee" in table.loc["21", "notes"]
    assert "Niveau de vie IMPUTÉ, pas une donnée Insee" in table.loc["44", "notes"]
    assert "Patrimoine IMPUTÉ, pas une donnée Insee" in table.loc["37", "notes"]
    assert "Patrimoine CALCULÉ, non publié" in table.loc["7", "notes"]
    assert "Niveau de vie : médiane publiée" in table.loc["37", "notes"]
    assert "pas pour les individus" in table.loc["10", "notes"]
    assert table.loc["10", "niveau_vie_mensuel_eur"] == pytest.approx(24000.0 / 12)


# --- Construction ---------------------------------------------------------------------------


def _load_build_module():
    spec = importlib.util.spec_from_file_location(
        "build_data_for_tests", ROOT / "scripts" / "build_data.py"
    )
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def test_build_pcs_follows_schema(monkeypatch: pytest.MonkeyPatch) -> None:
    build = _load_build_module()
    fake_source = {"id": "x", "title": "x", "url": "https://x.org", "accessed": "2026-10-31"}
    monkeypatch.setattr(insee_population, "sources", lambda: [fake_source])
    monkeypatch.setattr(insee_revenus_patrimoine, "sources", lambda: [fake_source, fake_source])
    agg = _fake_aggregate()
    document = build.build_pcs(
        insee_population.population_from_aggregate(agg),
        insee_diplomes.diplomas_from_aggregate(agg),
        insee_revenus_patrimoine.combine(_niveau_vie(), _hvp()),
    )
    validate_instance(document, "pcs.schema.json", "fixture")
    assert [i["code"] for i in document["items"]] == [
        str(i["code"]) for i in load_pcs_config()["items"]
    ]


# --- Fichiers produits (versionnés dans data/, sans cache) ------------------------------------


def _pcs() -> dict:
    return json.loads((DATA / "pcs.json").read_text(encoding="utf-8"))


def _elections() -> dict[str, dict]:
    return {
        path.stem: json.loads(path.read_text(encoding="utf-8"))
        for path in sorted((DATA / "elections").glob("*.json"))
    }


def test_pcs_file_covers_the_30_pcs_of_the_config() -> None:
    items = _pcs()["items"]
    assert len(items) == 30
    assert [i["code"] for i in items] == [str(i["code"]) for i in load_pcs_config()["items"]]
    assert sorted(i["code"] for i in items) == sorted(PCS_CODES)
    expected_groups = {str(i["code"]): str(i["group"]) for i in load_pcs_config()["items"]}
    assert {i["code"]: i["group"] for i in items} == expected_groups
    assert len(ACTIVE_PCS_CODES) == 29


def test_pcs_file_values_are_plausible() -> None:
    items = {i["code"]: i for i in _pcs()["items"]}
    for code, item in items.items():
        assert item["population"] > 0, code
        assert 1000 < item["niveau_vie_mensuel_eur"] < 6000, code
        assert 10 < item["patrimoine_keur"] < 2000, code
        assert sum(item["diplomes"].values()) == pytest.approx(100.0, abs=0.1), code
    # Repère du recensement 2022 : plus de 15 millions de retraités.
    assert items["7"]["population"] > 15_000_000


def test_pcs_file_marks_every_imputation_in_notes() -> None:
    document = _pcs()
    ids = {s["id"] for s in document["sources"]}
    for item in document["items"]:
        code, notes = item["code"], item["notes"]
        assert set(item["source_refs"]) <= ids, code
        if code in ("10", "21", "22", "23", "44"):
            assert "Niveau de vie IMPUTÉ, pas une donnée Insee" in notes, code
        else:
            assert "Niveau de vie : médiane publiée" in notes, code
        if code == "7":
            assert "Patrimoine CALCULÉ, non publié" in notes
        elif code in ("10", "31"):
            assert "Patrimoine : médiane publiée" in notes, code
        else:
            assert "Patrimoine IMPUTÉ, pas une donnée Insee" in notes, code


def test_retired_wealth_lies_between_the_published_deciles() -> None:
    item = next(i for i in _pcs()["items"] if i["code"] == "7")
    assert 205.1 <= item["patrimoine_keur"] <= 283.2
    assert "205,1" in item["notes"] and "283,2" in item["notes"]


def test_each_configured_election_has_a_file_or_is_documented_as_missing() -> None:
    elections = _elections()
    sources_text = (DATA / "SOURCES.md").read_text(encoding="utf-8")
    assert set(elections) <= set(ELECTION_IDS)
    for election_id in set(ELECTION_IDS) - set(elections):
        assert election_id in sources_text


@pytest.mark.parametrize("election_id", sorted(p.stem for p in (DATA / "elections").glob("*.json")))
def test_election_compositions_sum_to_100(election_id: str) -> None:
    document = _elections()[election_id]
    assert document["id"] == election_id
    assert document["pcs_level"] == 1
    candidates = {c["id"] for c in document["candidates"]}
    assert candidates == set(document["composition"])
    assert sum(1 for c in document["candidates"] if c.get("is_abstention")) == 1
    for candidate_id, shares in document["composition"].items():
        assert set(shares) <= {"1", "2", "3", "4", "5", "6", "7"}, candidate_id
        assert "1" not in shares, "aucun sondage consulté ne publie les agriculteurs"
        assert sum(shares.values()) == pytest.approx(100.0, abs=0.05), candidate_id


def test_election_figures_match_the_transcribed_report() -> None:
    """Valeur vérifiée sur le PDF : 14,7 %, à ne pas confondre avec une coquille circulant."""
    table = sondages.load_table("2017_legislatives_t1")
    assert table.rows.loc["extreme-gauche", "3"] == 14.7
    assert sondages.load_table("2024_europeennes").rows.loc["abstention", "7"] == 21.0


def test_sources_document_is_complete() -> None:
    text = (DATA / "SOURCES.md").read_text(encoding="utf-8")
    assert "## Données manquantes / TODO" in text
    assert "Aucune publication totale ou partielle" in text
    for heading in ("Jeu de données", "Source", "URL", "Accès", "Licence", "Limites"):
        assert heading in text
    documents = [_pcs(), *_elections().values()]
    for document in documents:
        for source in document["sources"]:
            assert source["url"] in text, source["id"]


def test_real_files_load_in_the_methods_model() -> None:
    pcs = load_pcs()
    assert len(pcs.items) == 30
    assert pcs.nomenclature == "PCS2020-N2"
    assert {e.id for e in load_elections()} <= set(ELECTION_IDS)


def test_no_fallback_on_the_local_reference() -> None:
    """Le code de production ne lit jamais la référence locale non licenciée."""
    files = [*Path(sondages.__file__).parent.glob("*.py"), ROOT / "scripts" / "build_data.py"]
    for path in files:
        assert "research/ref" not in path.read_text(encoding="utf-8").replace("\\", "/"), path
    for path in MANUAL_DIR.rglob("*.csv"):
        assert "jnthnbs" not in path.read_text(encoding="utf-8").lower(), path
