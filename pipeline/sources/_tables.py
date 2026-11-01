"""Lecture des tableaux publiés : libellés normalisés, feuilles Excel, tableaux par libellé."""

from __future__ import annotations

import io
import re
import unicodedata
import warnings
from collections.abc import Iterable, Sequence
from pathlib import Path
from typing import Any

import openpyxl


def normalize_label(text: Any) -> str:
    """Libellé sans accents, en minuscules, sans renvoi de note ni préfixe « dont : »."""
    s = unicodedata.normalize("NFKD", str(text))
    s = "".join(ch for ch in s if not unicodedata.combining(ch))
    s = s.replace("’", "'").lower()
    s = re.sub(r"^\s*dont\s*:\s*", "", s)
    s = re.sub(r"\(\d+\)", "", s)
    return re.sub(r"\s+", " ", s).strip()


def number(value: Any) -> float | None:
    """Nombre d'une cellule, y compris écrit en texte ; ``None`` pour « ns » ou une cellule vide."""
    if isinstance(value, bool):
        return None
    if isinstance(value, int | float):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value.replace(",", ".").strip())
        except ValueError:
            return None
    return None


def xlsx_rows(
    source: Path | bytes, sheet: str | None = None, max_row: int = 60, max_col: int = 24
) -> list[tuple[Any, ...]]:
    """Premières lignes d'une feuille Excel (certaines déclarent 1 048 576 lignes vides)."""
    handle = io.BytesIO(source) if isinstance(source, bytes) else source
    with warnings.catch_warnings():
        # Certains classeurs de l'Insee n'ont pas de style par défaut : sans effet sur les valeurs.
        warnings.filterwarnings("ignore", message="Workbook contains no default style")
        workbook = openpyxl.load_workbook(handle, read_only=True, data_only=True)
    try:
        worksheet = workbook[sheet] if sheet else workbook.worksheets[0]
        return list(worksheet.iter_rows(max_row=max_row, max_col=max_col, values_only=True))
    finally:
        workbook.close()


def table_by_label(rows: Iterable[Sequence[Any]]) -> dict[str, dict[str, float | None]]:
    """Tableau à en-tête -> ``{libellé de ligne : {libellé de colonne : valeur}}``, normalisés.

    L'en-tête est la première ligne dont la première cellule est vide et la suivante renseignée.
    Une valeur non significative (« ns ») donne ``None``.
    """
    header: list[str] | None = None
    table: dict[str, dict[str, float | None]] = {}
    for row in rows:
        if not row:
            continue
        if header is None:
            if row[0] in (None, "") and any(isinstance(c, str) and c.strip() for c in row[1:]):
                header = [normalize_label(c) if c not in (None, "") else "" for c in row]
            continue
        if row[0] in (None, "") or not isinstance(row[0], str):
            continue
        values = {
            name: number(value)
            for name, value in zip(header, row, strict=False)
            if name and value not in (None, "")
        }
        if values:
            table[normalize_label(row[0])] = values
    return table
