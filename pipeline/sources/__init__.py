"""Modules de sources primaires.

Chaque module de données expose :
- ``fetch()`` : télécharge les fichiers bruts dans le cache, hors du dépôt (voir ``_cache``) ;
- ``load()`` : renvoie un ``pandas.DataFrame`` normalisé.

Chaque valeur provient d'un fichier publié (Insee, instituts de sondage), d'une transcription
référencée dans ``pipeline/sources/manual/``, ou d'un calcul décrit et signalé comme tel.
"""
