"""Modules de sources primaires.

Chaque module expose :
- ``fetch()`` : télécharge les fichiers bruts et les met en cache dans ``pipeline/cache/`` ;
- ``load()`` : renvoie un ``pandas.DataFrame`` normalisé ;
- ``SOURCES`` : la liste des références (format ``schemas/source.schema.json``).

Aucune donnée n'est inventée : chaque valeur provient d'un fichier publié (INSEE,
instituts de sondage) ou d'une transcription manuelle référencée dans
``pipeline/sources/manual/``.
"""
