"""Recodage du fichier détail du recensement et tableau croisé commité, sans réseau."""

from __future__ import annotations

import io
import json
import zipfile
from pathlib import Path

import pandas as pd
import pytest

from pipeline.model import validate_instance
from pipeline.sources import _rp2022_indreg as rp
from pipeline.sources import insee_acm_individus as acm
from pipeline.sources._common import PCS_CODES

COLUMNS = acm.USECOLS


def _frame(*people: dict[str, str | float]) -> pd.DataFrame:
    """Individus du fichier détail ; un salarié stable, à temps complet, par défaut."""
    base = {
        "AGEREV": "040", "DIPL": "18", "EMPL": "16", "ETUD": "2", "IPONDI": 2.0, "STAT": "10",
        "STAT_CS": "138", "STOCD": "10", "TACT": "11", "TP": "1",
    }
    return pd.DataFrame([{**base, **person} for person in people], columns=COLUMNS)


def test_employment_recoding() -> None:
    empl = pd.Series(["22", "21", "23", "16", "16", "15", "11", "ZZ", "ZZ"], dtype="string")
    tp = pd.Series(["1", "2", "1", "1", "2", "1", "2", "Z", "Z"], dtype="string")
    tact = pd.Series(["11"] * 7 + ["12", "21"], dtype="string")
    assert acm.employment(empl, tp, tact).tolist() == [
        "employeur", "independant", "independant", "stable_complet", "stable_partiel",
        "duree_limitee", "duree_limitee", "chomage", acm.RETRAITE,
    ]


def test_field_excludes_students_children_and_inactive_outside_the_30_pcs() -> None:
    agg = acm.aggregate_frame(_frame(
        {},
        {"ETUD": "1"},                                                     # scolarisé
        {"AGEREV": "014"},                                                 # moins de 15 ans
        {"STAT_CS": "000", "TACT": "25", "EMPL": "ZZ", "STAT": "ZZ", "TP": "Z"},  # autre inactif
    ))
    assert agg[["pcs", "diplome", "logement", "emploi", "age", "poids"]].values.tolist() == [
        ["38", "bac5", "proprietaire", "stable_complet", "30-44", 2.0]
    ]


def test_retired_and_unemployed_are_classified() -> None:
    agg = acm.aggregate_frame(_frame(
        {"STAT_CS": "000", "TACT": "21", "EMPL": "ZZ", "STAT": "ZZ", "TP": "Z", "AGEREV": "070",
         "STOCD": "22", "DIPL": "13"},
        {"STAT_CS": "256", "TACT": "12", "EMPL": "ZZ", "STAT": "ZZ", "TP": "Z", "STOCD": "ZZ",
         "DIPL": "11"},
    ))
    rows = agg.set_index("pcs").to_dict("index")
    assert rows["7"]["emploi"] == acm.RETRAITE
    assert (rows["7"]["logement"], rows["7"]["diplome"], rows["7"]["age"]) == ("hlm", "cap", "60+")
    assert rows["56"]["emploi"] == "chomage"
    assert (rows["56"]["logement"], rows["56"]["diplome"]) == ("autre", "certif_aucun")


def test_weights_are_summed_by_profile() -> None:
    agg = acm.aggregate_frame(_frame({"IPONDI": 1.5}, {"IPONDI": 2.25}))
    assert len(agg) == 1
    assert agg["poids"].iloc[0] == 3.75


def test_stat_must_stay_nested_in_empl() -> None:
    with pytest.raises(ValueError, match="STAT"):
        acm.aggregate_frame(_frame({"STAT": "22"}))


def test_unknown_modalities_are_refused_rather_than_dropped() -> None:
    with pytest.raises(ValueError, match="sans modalité"):
        acm.aggregate_frame(_frame({"STOCD": "99"}))


def test_chunked_reading_matches_a_single_pass(tmp_path: Path) -> None:
    """Le résultat ne dépend pas de la taille des morceaux, et le zip reste la seule entrée."""
    frame = _frame(*({"IPONDI": 1.0 + i, "STOCD": "10" if i % 2 else "21"} for i in range(9)))
    buffer = io.StringIO()
    frame.to_csv(buffer, sep=";", index=False)
    path = tmp_path / "rp.zip"
    with zipfile.ZipFile(path, "w") as zf:
        zf.writestr(rp.MEMBER, buffer.getvalue())
    one = acm.aggregate_zip(path, chunksize=100).sort_values("logement").reset_index(drop=True)
    two = acm.aggregate_zip(path, chunksize=2).sort_values("logement").reset_index(drop=True)
    pd.testing.assert_frame_equal(one, two)
    assert one["poids"].sum() == frame["IPONDI"].sum()


def _aggregate() -> pd.DataFrame:
    """Une ligne par PCS, plus quelques variantes, pour construire un document."""
    rows = [
        (code, "bac", "hlm", acm.RETRAITE if code == "7" else "chomage", "60+", 10.4)
        for code in PCS_CODES
    ]
    rows.append(("47", "bac", "hlm", "chomage", "60+", 0.2))  # s'ajoute à la ligne déjà là
    rows.append(("10", "cap", "autre", "employeur", "15-29", 0.3))  # arrondi à 0 : retiré
    return pd.DataFrame(rows, columns=[*acm.KEYS, "poids"])


def test_document_rows_are_indexed_rounded_and_null_for_the_retired() -> None:
    document = acm.document(_aggregate(), {"id": "x", "title": "t", "url": "u", "accessed": "a"})
    by_group = {row[0]: row for row in document["rows"]}
    assert set(by_group) == set(PCS_CODES)
    assert by_group["47"] == ["47", 3, 2, 5, 11]
    assert by_group["7"] == ["7", 3, 2, None, 10]
    assert [row[0] for row in document["rows"]] == list(PCS_CODES)
    assert document["sources"][0]["id"] == "x"
    # Les retraités ne figurent pas parmi les individus actifs comptés par âge.
    # 29 PCS actives × 10,4 + 0,2 = 301,8.
    assert document["age_rows"] == [["60+", 3, 2, 5, 302]]


def test_document_refuses_a_missing_pcs() -> None:
    agg = _aggregate()
    with pytest.raises(ValueError, match="PCS absente"):
        acm.document(agg[agg["pcs"] != "47"], {"id": "x"})


def test_dumps_round_trips_with_one_row_per_line() -> None:
    document = acm.document(_aggregate(), {"id": "x", "title": "t", "url": "u", "accessed": "a"})
    text = acm.dumps(document)
    assert json.loads(text) == json.loads(json.dumps(document))
    assert any(line.strip().rstrip(",") == '["7",3,2,null,10]' for line in text.splitlines())
    assert text.endswith("}\n")


# --- Fichier commité ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def committed() -> dict:
    return json.loads(acm.OUTPUT.read_text(encoding="utf-8"))


def test_committed_aggregate_follows_its_schema(committed: dict) -> None:
    validate_instance(committed, "acm_individus.schema.json", "data/acm_individus.json")


def test_committed_aggregate_has_source_and_licence(committed: dict) -> None:
    source = committed["sources"][0]
    assert source["id"] == rp.SOURCE["id"]
    assert source["publisher"] == "Insee"
    assert "Licence Ouverte" in source["license"]
    assert source["accessed"]


def test_committed_aggregate_is_aggregated_and_complete(committed: dict) -> None:
    rows = committed["rows"]
    keys = [tuple(r[:4]) for r in rows]
    assert len(keys) == len(set(keys))
    assert {r[0] for r in rows} == set(PCS_CODES)
    assert all(r[-1] > 0 for r in rows)
    # Champ : environ 45,5 millions de personnes, dont 15,5 millions de retraités.
    total = sum(r[-1] for r in rows)
    retired = sum(r[-1] for r in rows if r[0] == "7")
    assert 45e6 < total < 46e6
    assert 15e6 < retired < 16e6
    assert sum(r[-1] for r in committed["age_rows"]) == pytest.approx(total - retired, abs=2000)
