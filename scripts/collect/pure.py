"""Fonctions pures de la collecte (bibliothèque standard uniquement, aucun accès réseau).

Ce module ne dépend d'aucun paquet de l'extra « research » (yt-dlp, OpenCV,
imagehash, faster-whisper…) : il est testable partout, y compris en CI.

- normalisation de texte et horodatage ``mm:ss`` ;
- classement de pertinence des vidéos par mots-clés (titre, description) ;
- conversion des sous-titres (WebVTT / SRT / json3 YouTube) en lignes
  horodatées dédoublonnées ;
- repérage des passages où le graphique est commenté et fusion des segments ;
- distance de Hamming entre hashs perceptuels hexadécimaux.
"""

from __future__ import annotations

import html
import re
import unicodedata
from collections import Counter, deque
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from typing import Any

Line = tuple[float, str]
Segment = dict[str, Any]

# --------------------------------------------------------------------------- texte


def normalize(text: str) -> str:
    """Minuscules, sans accents ni caractères de compatibilité, espaces compactés."""
    text = unicodedata.normalize("NFKD", text or "")
    text = "".join(c for c in text if not unicodedata.combining(c))
    text = text.replace("’", "'").replace("‘", "'").replace("`", "'").lower()
    return re.sub(r"\s+", " ", text).strip()


def fmt_mmss(seconds: float) -> str:
    """Formate des secondes en ``mm:ss`` (les minutes peuvent dépasser 59)."""
    total = max(0, int(seconds))
    return f"{total // 60:02d}:{total % 60:02d}"


# --------------------------------------------------------------------------- pertinence

URL_RE = re.compile(r"https?://[^\s<>\"'()\[\]]+")

# Termes propres au graphique : suffisent seuls.
SPECIFIC_TERMS: dict[str, str] = {
    "saint graphique": r"\bsaints?[\s_-]*graph",
    "holy graph": r"\bholy[\s_-]*graph",
    "graphomarxisme": r"\bgraphomarx",
    "marxographique": r"\bmarxograph",
    "graphique de positions/padu": (
        r"\bgraphiques? (?:de|du|des) (?:positions|la paduteam|padu|chris)"
    ),
}
# Termes thématiques et leur poids : ne comptent que dans un contexte PaduTeam / Positions.
TOPIC_TERMS: dict[str, tuple[str, int]] = {
    "graphique": (r"\bgraphiques?\b", 2),
    "sociologie électorale": (r"\bsociologie electorale", 3),
    "barycentre": (r"\bbarycentres?\b", 3),
    "pcs": (r"\bpcs\b", 2),
    "csp": (r"\bcsp\b", 2),
    "catégories socioprofessionnelles": (r"\bcategories? socio[\s-]?professionnelles?", 2),
    "électorat": (r"\belectorats?\b", 2),
    "vote de classe": (r"\bvotes? de classe", 2),
    "géographie électorale": (r"\bgeographie electorale", 2),
    "composition sociale": (r"\bcomposition sociale", 2),
    "domination": (r"\bdomination\b", 1),
    "exploitation": (r"\bexploitation\b", 1),
    "prophétie": (r"\bpropheties?\b", 2),  # « la prophétie » : second tour prédit par le graphique
}
CORE_TOPICS = ("graphique", "sociologie électorale", "barycentre")
CONTEXT_RE = re.compile(r"\bpadu|\bpasduhring|\bpositions[\s_-]*revue|\brevue positions|\bchris\b")
OWN_CHANNEL_RE = re.compile(r"padu|positions")
CURATED_TERM = "playlist:le-graphique-de-positions-revue"
SEARCH_TERM = "recherche:saint graphique"

_SPECIFIC = {k: re.compile(v) for k, v in SPECIFIC_TERMS.items()}
_TOPIC = {k: (re.compile(v), w) for k, (v, w) in TOPIC_TERMS.items()}


def is_own_channel(channel: str | None) -> bool:
    """Chaînes de la PaduTeam, de Padu (pasduhring) ou de Positions Revue."""
    return bool(OWN_CHANNEL_RE.search(normalize(channel or "")))


def classify(
    title: str,
    description: str,
    channel: str | None,
    curated: bool = False,
    tags: Sequence[str] = (),
    search_hit: bool = False,
) -> tuple[str, list[str]]:
    """Classe une vidéo en ``core`` / ``mention`` / ``unrelated``.

    ``description`` doit déjà être débarrassée des lignes récurrentes de sa
    chaîne (voir :func:`strip_boilerplate`) ; ``tags`` sont les mots-clés
    déclarés par l'auteur ; ``search_hit`` indique que la vidéo est remontée
    par la recherche YouTube « saint graphique ». Règles :

    - ``core`` : vidéo de la playlist dédiée ; terme propre au graphique
      (« saint graphique », « graphomarxisme »…) dans le titre, ou dans la
      description ou les tags d'une vidéo PaduTeam / Positions ; « graphique »,
      « sociologie électorale » ou « barycentre » dans le titre avec un
      contexte PaduTeam / Positions / Chris ;
    - ``mention`` : terme propre au graphique dans la description ou les tags
      d'une autre chaîne ; termes thématiques (poids cumulé ≥ 2) dans un
      contexte PaduTeam / Positions / Chris ; vidéo PaduTeam / Positions
      remontée par la recherche « saint graphique » ;
    - ``unrelated`` sinon.

    Renvoie la pertinence et la liste triée des termes trouvés (pour audit).
    """
    t, d, g = normalize(title), normalize(description), normalize(" ; ".join(tags))
    own = is_own_channel(channel)
    context = own or bool(CONTEXT_RE.search(f"{t} {d} {g}"))
    spec_t = [k for k, rx in _SPECIFIC.items() if rx.search(t)]
    spec_dg = [k for k, rx in _SPECIFIC.items() if rx.search(d) or rx.search(g)]
    topic_t = {k: w for k, (rx, w) in _TOPIC.items() if rx.search(t)}
    topic_dg = {k: w for k, (rx, w) in _TOPIC.items() if rx.search(d) or rx.search(g)}
    terms = sorted(set(spec_t) | set(spec_dg) | set(topic_t) | set(topic_dg))
    if search_hit:
        terms.append(SEARCH_TERM)
    if curated:
        return "core", [CURATED_TERM, *terms]
    if spec_t or (spec_dg and own):
        return "core", terms
    if context and any(k in topic_t for k in CORE_TOPICS):
        return "core", terms
    if spec_dg:
        return "mention", terms
    if context and sum({**topic_dg, **topic_t}.values()) >= 2:
        return "mention", terms
    if own and search_hit:
        return "mention", terms
    return "unrelated", terms


NAV_LINE_RE = re.compile(r"\bplaylist")


def _norm_line(line: str) -> str:
    return normalize(URL_RE.sub("", line)).strip(" :-|•·")


def boilerplate_lines(
    descriptions: Sequence[str], min_count: int = 3, min_ratio: float = 0.01
) -> set[str]:
    """Lignes (normalisées, sans URL) présentes dans au moins
    ``max(min_count, min_ratio × n)`` des descriptions d'une même chaîne."""
    counts: Counter[str] = Counter()
    for desc in descriptions:
        counts.update({_norm_line(ln) for ln in desc.splitlines() if _norm_line(ln)})
    threshold = max(min_count, int(min_ratio * len(descriptions)))
    return {line for line, n in counts.items() if n >= threshold}


def is_navigation_line(line: str) -> bool:
    """Ligne de renvoi vers une playlist (« Playlist du Graphique : https://… »)."""
    return bool(URL_RE.search(line)) and bool(NAV_LINE_RE.search(normalize(line)))


def strip_boilerplate(description: str, boilerplate: set[str]) -> str:
    """Retire d'une description les lignes récurrentes de sa chaîne et les renvois
    vers des playlists."""
    return "\n".join(
        ln
        for ln in description.splitlines()
        if _norm_line(ln) not in boilerplate and not is_navigation_line(ln)
    )


def is_complete_meta(meta: dict[str, Any]) -> bool:
    """Fiche de métadonnées exploitable : erreur permanente notée, ou réponse complète.

    Quand YouTube refuse le lecteur (« not a bot »), ``yt-dlp --ignore-no-formats-error``
    réussit quand même avec les seules données de la page : ni durée, ni tags, ni
    sous-titres. Une telle fiche doit être redemandée.
    """
    return "error" in meta or meta.get("duration") is not None


def extract_links(text: str) -> list[str]:
    """URL d'un texte, sans doublons, dans l'ordre d'apparition."""
    seen: dict[str, None] = {}
    for url in URL_RE.findall(text or ""):
        seen.setdefault(url.rstrip(".,;:!?"), None)
    return list(seen)


# --------------------------------------------------------------------------- sous-titres

_TS = r"(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})"
CUE_RE = re.compile(rf"^\s*{_TS}\s+-->\s+{_TS}")
TAG_RE = re.compile(r"<[^>]*>")


@dataclass(frozen=True)
class Cue:
    """Un bloc de sous-titres : début, fin (secondes) et lignes de texte nettoyées."""

    start: float
    end: float
    lines: tuple[str, ...]


def _seconds(h: str | None, m: str, s: str, ms: str) -> float:
    return int(h or 0) * 3600 + int(m) * 60 + int(s) + int(ms.ljust(3, "0")) / 1000


def clean_caption(text: str) -> str:
    """Retire les balises (horodatages mot à mot, ``<c>``) et décode les entités HTML."""
    text = html.unescape(TAG_RE.sub("", text))
    return re.sub(r"\s+", " ", text).strip()


def parse_vtt(text: str) -> list[Cue]:
    """Analyse un WebVTT (ou un SRT).

    Seule une ligne réellement vide termine un bloc : les sous-titres
    automatiques YouTube contiennent des lignes formées d'une seule espace.
    """
    raw_cues: list[tuple[float, float, list[str]]] = []
    current: list[str] | None = None
    for raw in text.replace("\r\n", "\n").replace("\r", "\n").lstrip("﻿").split("\n"):
        m = CUE_RE.match(raw)
        if m:
            g = m.groups()
            current = []
            raw_cues.append((_seconds(*g[:4]), _seconds(*g[4:]), current))
        elif raw == "":
            current = None
        elif current is not None:
            current.append(raw)
    return [
        Cue(start, end, tuple(c for c in (clean_caption(ln) for ln in lines) if c))
        for start, end, lines in raw_cues
    ]


def dedupe(lines: Iterable[Line], memory: int = 4) -> list[Line]:
    """Supprime les répétitions des sous-titres « roulants ».

    Une ligne identique (casse ignorée) à l'une des ``memory`` dernières lignes
    retenues est écartée ; une ligne qui prolonge la précédente la remplace en
    gardant l'horodatage le plus ancien.
    """
    out: list[Line] = []
    recent: deque[str] = deque(maxlen=memory)
    for t, text in lines:
        key = text.casefold()
        if not key or key in recent:
            continue
        if out and key.startswith(out[-1][1].casefold()):
            out[-1] = (out[-1][0], text)
            recent.append(key)
            continue
        out.append((t, text))
        recent.append(key)
    return out


def vtt_to_lines(text: str) -> list[Line]:
    """WebVTT -> lignes ``(début_s, texte)`` dédoublonnées."""
    return dedupe((cue.start, line) for cue in parse_vtt(text) for line in cue.lines)


def json3_to_lines(data: dict[str, Any]) -> list[Line]:
    """Sous-titres YouTube json3 -> lignes ``(début_s, texte)`` dédoublonnées."""
    out: list[Line] = []
    for ev in data.get("events") or []:
        segs = ev.get("segs")
        if not segs:
            continue
        text = clean_caption("".join(s.get("utf8", "") for s in segs).replace("\n", " "))
        if text:
            out.append((ev.get("tStartMs", 0) / 1000, text))
    return dedupe(out)


def format_transcript(lines: Iterable[Line]) -> str:
    """Lignes -> texte ``[mm:ss] texte`` (une ligne par entrée)."""
    return "".join(f"[{fmt_mmss(t)}] {text}\n" for t, text in lines)


TRANSCRIPT_LINE_RE = re.compile(r"^\[(\d+):(\d{2})\]\s?(.*)$")


def parse_transcript(text: str) -> list[Line]:
    """Relit un fichier ``[mm:ss] texte`` en lignes ``(secondes, texte)``."""
    out: list[Line] = []
    for raw in text.splitlines():
        m = TRANSCRIPT_LINE_RE.match(raw.strip())
        if m:
            out.append((int(m[1]) * 60 + int(m[2]), m[3].strip()))
    return out


def choose_subtitle(meta: dict[str, Any]) -> tuple[str, str] | None:
    """Piste à télécharger : ``(langue, "manual" | "auto")`` ou ``None``.

    Sous-titres manuels français d'abord, puis automatiques : piste originale
    ``fr-orig``, puis ``fr``, puis toute autre variante ``fr-*``.
    """
    manual = [lg for lg in meta.get("subtitle_langs") or [] if re.match(r"^fr(?:[-_]|$)", lg)]
    if manual:
        return sorted(manual, key=lambda lg: (lg != "fr", lg))[0], "manual"
    autos = meta.get("auto_caption_langs") or []
    for cand in ("fr-orig", "fr"):
        if cand in autos:
            return cand, "auto"
    others = sorted(lg for lg in autos if lg.startswith("fr"))
    return (others[0], "auto") if others else None


# --------------------------------------------------------------------------- dépistage

# « graphique » prononcé : étalonné sur les vidéos de la playlist dédiée (13 à 93 occurrences
# pour la plupart) et sur des vidéos sans graphique (0 à 2).
SPOKEN_CORE = 10
SPOKEN_MENTION = 3
_GRAPH_RX = re.compile(r"\bgraphiques?\b")
_SAINT_RX = re.compile(r"\bsaints?[ -]?graphiques?\b")
_RELEVANCE_RANK = {"unrelated": 0, "mention": 1, "core": 2}


def spoken_signal(lines: Iterable[Line]) -> dict[str, int]:
    """Nombre de « graphique » et de « saint graphique » prononcés dans une transcription."""
    text = " ".join(t for _, t in lines).lower()
    return {
        "graphique": len(_GRAPH_RX.findall(text)),
        "saint_graphique": len(_SAINT_RX.findall(text)),
    }


def screening_relevance(signal: dict[str, int]) -> str | None:
    """Pertinence déduite de ce qui est dit dans la vidéo (``None`` sans signal)."""
    n = signal.get("graphique", 0)
    if n >= SPOKEN_CORE:
        return "core"
    return "mention" if n >= SPOKEN_MENTION else None


def upgrade_relevance(relevance: str, screened: str | None) -> str:
    """La plus forte de la pertinence par mots-clés et de celle du dépistage."""
    if screened and _RELEVANCE_RANK[screened] > _RELEVANCE_RANK[relevance]:
        return screened
    return relevance


# --------------------------------------------------------------------------- segments

# Mots-clés du commentaire du graphique (texte en minuscules, accents conservés) et poids.
CHART_KEYWORDS: dict[str, tuple[str, int]] = {
    "saint graphique": (r"\bsaints?[ -]?graphiques?\b", 3),
    "graphique": (r"\bgraphiques?\b", 2),
    "barycentre": (r"\bbarycentres?\b", 3),
    "abscisse": (r"\babscisses?\b", 2),
    "ordonnée": (r"\bordonn[ée]es?\b", 2),
    "axe": (r"\baxes?\b", 1),
    "domination": (r"\bdomination\b", 1),
    "exploitation": (r"\bexploitation\b", 1),
    "pcs": (r"\bpcs\b", 2),
    "électorat": (r"\b[ée]lectorats?\b", 2),
    "exécutants": (r"\bex[ée]cutants?\b", 2),
    "professions intermédiaires": (r"\bprofessions? interm[ée]diaires?\b", 2),
    "cadres": (r"\bcadres\b", 1),
    "ouvriers": (r"\bouvri(?:er|ers|ère|ères)\b", 1),
    "employés": (r"\bemploy[ée]s\b", 1),
    "retraités": (r"\bretraité(?:e|es|s)?\b", 1),
    "artisans/commerçants": (r"\bartisans?\b|\bcommer[çc]ants?\b", 1),
    "position sur le graphique": (
        r"\ben (?:haut|bas) (?:[àa] )?(?:droite|gauche)\b|\bvers le (?:haut|bas)\b",
        1,
    ),
}
# Au moins un de ces mots-clés (ou un poids cumulé élevé) pour retenir un passage.
CHART_ANCHORS = frozenset(
    {
        "saint graphique",
        "graphique",
        "barycentre",
        "abscisse",
        "ordonnée",
        "axe",
        "pcs",
        "électorat",
        "exécutants",
        "professions intermédiaires",
        "position sur le graphique",
    }
)
_CHART = {k: (re.compile(v), w) for k, (v, w) in CHART_KEYWORDS.items()}


@dataclass(frozen=True)
class Hit:
    """Occurrence d'un mot-clé dans une ligne de transcription."""

    t: float
    label: str
    weight: int


def find_hits(lines: Iterable[Line]) -> list[Hit]:
    """Occurrences des mots-clés du graphique (un même mot-clé compte une fois par ligne)."""
    hits: list[Hit] = []
    for t, text in lines:
        low = text.lower()
        for label, (rx, w) in _CHART.items():
            if rx.search(low):
                hits.append(Hit(t, label, w))
    return hits


def cluster_hits(hits: Sequence[Hit], max_gap: float = 60.0) -> list[list[Hit]]:
    """Regroupe les occurrences séparées de moins de ``max_gap`` secondes."""
    clusters: list[list[Hit]] = []
    for hit in sorted(hits, key=lambda h: h.t):
        if clusters and hit.t - clusters[-1][-1].t <= max_gap:
            clusters[-1].append(hit)
        else:
            clusters.append([hit])
    return clusters


def merge_segments(segments: Iterable[Segment], gap: float = 30.0) -> list[Segment]:
    """Fusionne les segments qui se chevauchent ou sont séparés de moins de ``gap`` s.

    Les mots-clés sont unis et les scores (s'il y en a) additionnés.
    """
    merged: list[Segment] = []
    for seg in sorted(segments, key=lambda s: (s["start_s"], s["end_s"])):
        if merged and seg["start_s"] <= merged[-1]["end_s"] + gap:
            cur = merged[-1]
            cur["end_s"] = max(cur["end_s"], seg["end_s"])
            cur["keywords"] = sorted(set(cur.get("keywords", [])) | set(seg.get("keywords", [])))
            if "score" in cur or "score" in seg:
                cur["score"] = cur.get("score", 0) + seg.get("score", 0)
        else:
            merged.append({**seg, "keywords": sorted(set(seg.get("keywords", [])))})
    return merged


def chart_segments(
    lines: Sequence[Line],
    duration: float | None = None,
    margin: float = 20.0,
    max_gap: float = 60.0,
    merge_gap: float = 30.0,
    min_score: int = 4,
    strong_score: int = 8,
    line_span: float = 5.0,
) -> list[Segment]:
    """Passages où le graphique est vraisemblablement commenté.

    Les occurrences de mots-clés proches (``max_gap``) forment des fenêtres ;
    une fenêtre est retenue si son poids cumulé atteint ``min_score`` et
    qu'elle contient un mot-clé d'ancrage (« graphique », « axe », « PCS »…),
    ou si son poids atteint ``strong_score``. Une marge de ``margin`` secondes
    est ajoutée de part et d'autre, puis les fenêtres proches sont fusionnées.
    """
    segments: list[Segment] = []
    for cluster in cluster_hits(find_hits(lines), max_gap):
        labels = {h.label for h in cluster}
        score = sum(h.weight for h in cluster)
        if not ((score >= min_score and labels & CHART_ANCHORS) or score >= strong_score):
            continue
        start = max(0.0, cluster[0].t - margin)
        end = cluster[-1].t + line_span + margin
        if duration:
            end = min(end, float(duration))
        segments.append(
            {
                "start_s": float(start),
                "end_s": float(end),
                "keywords": sorted(labels),
                "score": score,
            }
        )
    return merge_segments(segments, merge_gap)


def sampling_plan(
    segments: Sequence[Segment] | None,
    duration: float,
    segment_step: float = 2.0,
    full_step: float = 10.0,
    full_scan: bool = False,
) -> list[tuple[float, float, float]]:
    """Fenêtres d'échantillonnage ``(début, fin, pas)`` d'une vidéo, dans l'ordre du temps.

    Les segments sont échantillonnés au pas ``segment_step`` ; sans segment, toute
    la vidéo l'est au pas ``full_step``. Avec ``full_scan``, les intervalles entre
    les segments sont aussi parcourus au pas ``full_step`` (le graphique peut
    rester à l'écran sans être nommé).
    """
    if not segments:
        return [(0.0, float(duration), full_step)] if duration > 0 else []
    plan: list[tuple[float, float, float]] = []
    cursor = 0.0
    for seg in merge_segments([dict(x) for x in segments], gap=0.0):
        start = max(0.0, float(seg["start_s"]))
        end = min(float(seg["end_s"]), duration) if duration else float(seg["end_s"])
        if end <= start:
            continue
        if full_scan and start - cursor >= full_step:
            plan.append((cursor, start, full_step))
        plan.append((start, end, segment_step))
        cursor = end
    if full_scan and duration - cursor >= full_step:
        plan.append((cursor, float(duration), full_step))
    return plan


# --------------------------------------------------------------------------- axes

HSeg = tuple[float, float, float]  # (x1, x2, y) : segment horizontal
VSeg = tuple[float, float, float]  # (y1, y2, x) : segment vertical


def is_grid(hsegs: Sequence[HSeg], vsegs: Sequence[VSeg]) -> bool:
    """Trop de traits francs pour des axes : c'est un tableau."""
    return (len(hsegs) >= 4 and len(vsegs) >= 4) or max(len(hsegs), len(vsegs)) >= 6


def axes_kind(
    hsegs: Sequence[HSeg], vsegs: Sequence[VSeg], tol: float = 3.0, min_arm: float = 0.12
) -> str | None:
    """Nature de la meilleure paire de segments orthogonaux qui se rencontrent.

    ``"cross"`` si un segment horizontal et un vertical se croisent loin de
    leurs extrémités (chaque bras dépasse ``min_arm`` de la longueur du
    segment) : ce sont les axes du graphique, qui se coupent en son centre ;
    ``"corner"`` s'ils se touchent près d'une extrémité (axes en L, cadre) ;
    ``None`` sinon.
    """
    best: str | None = None
    for x1, x2, y in hsegs:
        for y1, y2, x in vsegs:
            if not (x1 - tol <= x <= x2 + tol and y1 - tol <= y <= y2 + tol):
                continue
            h_arm = min(x - x1, x2 - x) / max(1.0, x2 - x1)
            v_arm = min(y - y1, y2 - y) / max(1.0, y2 - y1)
            if h_arm >= min_arm and v_arm >= min_arm:
                return "cross"
            best = "corner"
    return best


# --------------------------------------------------------------------------- hashs


def hamming_hex(a: str, b: str) -> int:
    """Distance de Hamming entre deux hashs perceptuels hexadécimaux."""
    return (int(a, 16) ^ int(b, 16)).bit_count()


def nearest_duplicate(phash: str, kept: Sequence[str], max_dist: int = 6) -> int | None:
    """Indice du hash de ``kept`` le plus proche si sa distance est ≤ ``max_dist``."""
    best: tuple[int, int] | None = None
    for i, other in enumerate(kept):
        d = hamming_hex(phash, other)
        if d <= max_dist and (best is None or d < best[0]):
            best = (d, i)
    return best[1] if best else None
