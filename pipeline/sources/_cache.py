"""Emplacement du cache des téléchargements, hors du dépôt.

Ordre de résolution :

1. variable d'environnement ``SG_CACHE_DIR`` ;
2. Windows : ``%LOCALAPPDATA%\\saint-graphique\\cache`` ;
3. ailleurs : ``$XDG_CACHE_HOME/saint-graphique``, sinon ``~/.cache/saint-graphique``.

Le dossier est créé au besoin. Tous les modules de ``pipeline/sources`` passent par
``cache_dir()`` : aucun fichier téléchargé n'est écrit dans le dépôt.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

APP_NAME = "saint-graphique"


def default_cache_dir() -> Path:
    """Dossier de cache par défaut selon la plateforme (sans le créer)."""
    env = os.environ.get("SG_CACHE_DIR")
    if env:
        return Path(env).expanduser()
    if sys.platform == "win32":
        base = os.environ.get("LOCALAPPDATA") or str(Path.home() / "AppData" / "Local")
        return Path(base) / APP_NAME / "cache"
    xdg = os.environ.get("XDG_CACHE_HOME")
    base = Path(xdg).expanduser() if xdg else Path.home() / ".cache"
    return base / APP_NAME


def cache_dir(*parts: str) -> Path:
    """Dossier de cache (ou sous-dossier ``parts``), créé s'il n'existe pas."""
    path = default_cache_dir().joinpath(*parts)
    path.mkdir(parents=True, exist_ok=True)
    return path
