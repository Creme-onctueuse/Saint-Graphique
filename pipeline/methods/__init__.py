"""Méthodes de placement des PCS et des électorats.

Tous les modules de ce paquet sont importés ci-dessous. Une classe décorée par ``@register``
dans un nouveau fichier ``pipeline/methods/<nom>.py`` s'inscrit donc d'elle-même dans
``METHODS``, sans rien modifier d'autre.
"""

import importlib
import pkgutil

from pipeline.methods.base import METHODS, Method, assemble_result, get_method, register

for _module in pkgutil.iter_modules(__path__):
    if not _module.name.startswith("_"):
        importlib.import_module(f"{__name__}.{_module.name}")

__all__ = ["METHODS", "Method", "assemble_result", "get_method", "register"]
