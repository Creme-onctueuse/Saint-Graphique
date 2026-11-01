"""Outils partagés par les modules de sources : chemins, cache, téléchargement, configuration."""

from __future__ import annotations

import datetime as dt
import hashlib
import json
from pathlib import Path
from typing import Any

import yaml

from pipeline.sources._cache import cache_dir

ROOT = Path(__file__).resolve().parents[2]
CONFIG_DIR = ROOT / "config"
MANUAL_DIR = Path(__file__).resolve().parent / "manual"

__all__ = ["cache_dir"]  # ré-export : point d'entrée unique du cache pour les modules

#: Codes des 29 PCS actives de niveau 2 (PCS 2020 / PCS 2003, mêmes codes) + retraités (« 7 »).
ACTIVE_PCS_CODES: tuple[str, ...] = (
    "10", "21", "22", "23", "31", "33", "34", "35", "37", "38",
    "42", "43", "44", "45", "46", "47", "48", "52", "53", "54",
    "55", "56", "62", "63", "64", "65", "67", "68", "69",
)
RETIRED_CODE = "7"
PCS_CODES: tuple[str, ...] = (*ACTIVE_PCS_CODES, RETIRED_CODE)
#: Clés de la répartition des diplômes (du plus élevé au plus faible).
DIPLOMA_KEYS: tuple[str, ...] = ("bac5", "bac3", "bac2", "bac", "cap", "brevet", "certif_aucun")

#: Mentions légales de l'Insee : https://www.insee.fr/fr/information/2008466
LICENCE_INSEE = (
    "Licence Ouverte / Open Licence 2.0 (Etalab), citer « Source : Insee » et la date de mise "
    "à jour, sans altérer le sens des informations ni induire en erreur sur leur interprétation"
)

# Certains serveurs (instituts de sondage) refusent les clients sans User-Agent de navigateur.
_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0 Safari/537.36 saint-graphique-pipeline"
    )
}


def group_of(code: str) -> str:
    """PCS de niveau 1 d'un code de niveau 2 (« 7 » pour les retraités)."""
    return code[0]


def load_pcs_config(path: Path = CONFIG_DIR / "pcs.yaml") -> dict[str, Any]:
    """Contenu de ``config/pcs.yaml`` (nomenclature, groupes, 30 PCS)."""
    with path.open(encoding="utf-8") as f:
        return yaml.safe_load(f)


def load_elections_config(path: Path = CONFIG_DIR / "elections.yaml") -> list[dict[str, Any]]:
    """Liste des élections de ``config/elections.yaml``."""
    with path.open(encoding="utf-8") as f:
        return list((yaml.safe_load(f) or {}).get("elections", []))


def _meta_path(path: Path) -> Path:
    return path.with_name(path.name + ".meta.json")


def file_meta(path: Path) -> dict[str, Any]:
    """Métadonnées d'un fichier en cache (URL, date d'accès) ; date du fichier à défaut."""
    meta_file = _meta_path(path)
    if meta_file.exists():
        return json.loads(meta_file.read_text(encoding="utf-8"))
    accessed = dt.date.fromtimestamp(path.stat().st_mtime).isoformat() if path.exists() else None
    return {"url": None, "accessed": accessed}


def write_meta(path: Path, url: str, accessed: str | None = None) -> None:
    """Écrit (ou complète) la fiche ``<fichier>.meta.json`` d'un fichier en cache."""
    sha = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            sha.update(block)
    meta = {
        "url": url,
        "accessed": accessed or dt.date.today().isoformat(),
        "bytes": path.stat().st_size,
        "sha256": sha.hexdigest(),
    }
    _meta_path(path).write_text(json.dumps(meta, indent=2), encoding="utf-8")


def download(url: str, dest: Path, *, force: bool = False, timeout: int = 120) -> Path:
    """Télécharge ``url`` vers ``dest`` (écriture atomique) sauf s'il est déjà en cache.

    Une fiche ``dest.meta.json`` garde l'URL, la date d'accès et l'empreinte SHA-256.
    """
    import requests  # import local : les tests hors réseau n'en ont pas besoin

    dest = Path(dest)
    if dest.exists() and dest.stat().st_size > 0 and not force:
        if not _meta_path(dest).exists():
            write_meta(dest, url, file_meta(dest)["accessed"])
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_name(dest.name + ".part")
    with requests.get(url, stream=True, timeout=timeout, headers=_HEADERS) as resp:
        resp.raise_for_status()
        with tmp.open("wb") as f:
            for block in resp.iter_content(chunk_size=1 << 20):
                f.write(block)
    tmp.replace(dest)
    write_meta(dest, url)
    return dest


def source_ref(
    id: str,
    title: str,
    url: str,
    accessed: str | None,
    *,
    publisher: str | None = None,
    license: str | None = None,
    notes: str | None = None,
) -> dict[str, str]:
    """Référence de source au format ``schemas/source.schema.json``."""
    ref: dict[str, str] = {
        "id": id,
        "title": title,
        "url": url,
        "accessed": accessed or dt.date.today().isoformat(),
    }
    for key, value in (("publisher", publisher), ("license", license), ("notes", notes)):
        if value:
            ref[key] = value
    return ref
