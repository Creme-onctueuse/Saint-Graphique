"""Étape 2 : transcriptions horodatées des vidéos core et mention.

Pour chaque vidéo ``core`` ou ``mention`` de ``research/index/videos.jsonl`` :

1. télécharge les sous-titres français, manuels de préférence, sinon
   automatiques (piste originale ``fr-orig`` puis ``fr``), au format vtt (json3
   à défaut) : ``research/transcripts/<id>.<langue>.vtt`` ;
2. les convertit en texte horodaté dédoublonné ``research/transcripts/<id>.txt``
   (une ligne ``[mm:ss] texte`` ; les minutes peuvent dépasser 59) ;
3. sans aucun sous-titre français, transcrit l'audio seul avec faster-whisper
   (modèle small, CPU, int8) ; l'audio est supprimé ensuite et les segments
   bruts sont gardés dans ``<id>.whisper.json`` ;
4. met à jour ``transcript_path`` et ``transcript_source`` dans l'index.

Reprise : une vidéo qui a déjà ``<id>.txt`` et un ``transcript_path`` est
sautée (sauf ``--force``) ; un fichier de sous-titres déjà présent n'est pas
retéléchargé.

Usage :
    uv run python scripts/collect/fetch_transcripts.py [--limit N] [--ids ID ...]
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import subprocess
import sys
import tempfile
import threading
import time
from collections.abc import Sequence
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scripts.collect.common import (  # noqa: E402
    META_CACHE_DIR,
    TRANSCRIPTS_DIR,
    Video,
    YouTubeBlocked,
    is_throttled,
    load_index,
    read_json,
    rel,
    select_videos,
    setup_logging,
    stderr_tail,
    update_index,
    video_url,
    write_json_atomic,
    write_text_atomic,
    ytdlp,
)
from scripts.collect.pure import (  # noqa: E402
    Line,
    choose_subtitle,
    dedupe,
    format_transcript,
    is_complete_meta,
    json3_to_lines,
    vtt_to_lines,
)

log = logging.getLogger("collect.transcripts")

SUB_EXTS = ("vtt", "json3", "srt")


def subtitle_file_to_lines(path: Path) -> list[Line]:
    """Convertit un fichier de sous-titres téléchargé (vtt, srt ou json3)."""
    text = path.read_text(encoding="utf-8", errors="replace")
    if path.suffix == ".json3":
        return json3_to_lines(json.loads(text))
    return vtt_to_lines(text)


def find_subtitle_file(video_id: str, lang: str | None = None) -> Path | None:
    """Fichier de sous-titres déjà téléchargé pour cette vidéo (et cette langue)."""
    for ext in SUB_EXTS:
        pattern = f"{video_id}.{lang}.{ext}" if lang else f"{video_id}.*.{ext}"
        hits = sorted(TRANSCRIPTS_DIR.glob(pattern))
        if hits:
            return hits[0]
    return None


def download_subtitle(
    video_id: str, lang: str, kind: str, attempts: int = 3, max_wait: float = 1800
) -> Path | None:
    """Télécharge une piste de sous-titres (vtt de préférence) dans research/transcripts/.

    Renvoie ``None`` si elle n'a pas pu être obtenue (YouTube bridé : à réessayer)."""
    existing = find_subtitle_file(video_id, lang)
    if existing:
        return existing
    TRANSCRIPTS_DIR.mkdir(parents=True, exist_ok=True)
    args = [
        "--skip-download",
        "--write-subs" if kind == "manual" else "--write-auto-subs",
        "--sub-langs",
        lang,
        "--sub-format",
        "vtt/json3/best",
        "-o",
        str(TRANSCRIPTS_DIR / "%(id)s.%(ext)s"),
        video_url(video_id),
    ]
    for attempt in range(1, attempts + 1):
        try:
            proc = ytdlp(args, timeout=600, max_wait=max_wait)
        except YouTubeBlocked as exc:
            log.warning("%s : sous-titres remis à plus tard (%s)", video_id, exc)
            return None
        found = find_subtitle_file(video_id, lang)
        if found:
            return found
        log.warning(
            "%s : sous-titres %s non obtenus (essai %d/%d) : %s",
            video_id,
            lang,
            attempt,
            attempts,
            stderr_tail(proc)[-300:] or proc.returncode,
        )
        if not is_throttled(proc):
            time.sleep(5 * attempt)
    return None


_MODEL: Any = None
_MODEL_LOCK = threading.Lock()


def decode_audio_16k(path: Path) -> Any:
    """Décode un fichier audio avec ffmpeg en tableau numpy mono 16 kHz (float32).

    faster-whisper 1.2 ne sait plus ouvrir un fichier avec PyAV ≥ 19
    (``av.open(metadata_errors=…)`` a disparu) ; il accepte en revanche un tableau.
    """
    import numpy as np

    proc = subprocess.run(
        [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-nostdin",
            "-i",
            str(path),
            "-vn",
            "-ac",
            "1",
            "-ar",
            "16000",
            "-f",
            "f32le",
            "pipe:1",
        ],
        capture_output=True,
        check=True,
    )
    return np.frombuffer(proc.stdout, dtype=np.float32)


def whisper_transcribe(
    video_id: str, model_size: str = "small", threads: int = 4
) -> list[tuple[float, float, str]]:
    """Télécharge l'audio seul dans un dossier temporaire, le transcrit avec
    faster-whisper (CPU, int8) puis le supprime. Renvoie ``(début, fin, texte)``."""
    global _MODEL
    from faster_whisper import WhisperModel

    with tempfile.TemporaryDirectory(prefix="sg_audio_", ignore_cleanup_errors=True) as tmp:
        proc = ytdlp(
            [
                "-f",
                "ba[ext=m4a]/ba/b",
                "--no-part",
                "-o",
                str(Path(tmp) / "%(id)s.%(ext)s"),
                video_url(video_id),
            ],
            timeout=7200,
            max_wait=1800,
        )
        audio = next(Path(tmp).glob(f"{video_id}.*"), None)
        if proc.returncode != 0 or audio is None:
            raise RuntimeError(f"audio non téléchargé : {stderr_tail(proc)}")
        with _MODEL_LOCK:
            if _MODEL is None:
                log.info(
                    "chargement de faster-whisper %s (cpu, int8, %d threads)", model_size, threads
                )
                _MODEL = WhisperModel(
                    model_size, device="cpu", compute_type="int8", cpu_threads=threads
                )
            t0 = time.monotonic()
            segments, info = _MODEL.transcribe(
                decode_audio_16k(audio), language="fr", vad_filter=True
            )
            result = [(s.start, s.end, s.text.strip()) for s in segments]
            log.info(
                "%s : whisper, %.0f s d'audio en %.0f s",
                video_id,
                info.duration,
                time.monotonic() - t0,
            )
    return result


def is_done(video: Video) -> bool:
    """Transcription déjà produite et référencée dans l'index."""
    return bool(video.get("transcript_path")) and (TRANSCRIPTS_DIR / f"{video['id']}.txt").exists()


def process_video(
    video: Video,
    force: bool = False,
    allow_whisper: bool = True,
    whisper_model: str = "small",
    whisper_threads: int = 4,
) -> dict[str, Any] | None:
    """Produit ``<id>.txt`` pour une vidéo et met l'index à jour.

    Renvoie les champs écrits dans l'index, ou ``None`` si rien n'a été fait.
    """
    vid = video["id"]
    if is_done(video) and not force:
        return None
    meta = read_json(META_CACHE_DIR / f"{vid}.json")
    if meta is None or "error" in meta or not is_complete_meta(meta):
        from scripts.collect.list_videos import MetaFetcher

        meta = MetaFetcher()(vid)
        if meta is None:  # YouTube bride : ne pas conclure à l'absence de sous-titres
            log.warning("%s : métadonnées indisponibles, à réessayer plus tard", vid)
            return None
    choice = choose_subtitle(meta)
    if choice is not None:
        lang, kind = choice
        sub = download_subtitle(vid, lang, kind)
        if sub is None:
            log.error("%s : sous-titres %s indisponibles, à réessayer plus tard", vid, lang)
            return None
        lines = subtitle_file_to_lines(sub)
        source = "youtube_manual" if kind == "manual" else "youtube_auto"
        log.info("%s : %d lignes depuis %s (%s)", vid, len(lines), sub.name, source)
    elif allow_whisper:
        log.info("%s : aucun sous-titre français, transcription faster-whisper", vid)
        segments = whisper_transcribe(vid, whisper_model, whisper_threads)
        write_json_atomic(
            TRANSCRIPTS_DIR / f"{vid}.whisper.json",
            {
                "video_id": vid,
                "model": whisper_model,
                "language": "fr",
                "segments": [
                    {"start": round(s, 2), "end": round(e, 2), "text": t} for s, e, t in segments
                ],
            },
        )
        lines = dedupe((s, t) for s, _, t in segments if t)
        source = "whisper"
    else:
        log.info("%s : aucun sous-titre français et whisper désactivé", vid)
        return None
    txt = TRANSCRIPTS_DIR / f"{vid}.txt"
    write_text_atomic(txt, format_transcript(lines))
    fields = {"transcript_path": rel(txt), "transcript_source": source}
    update_index({vid: fields})
    return fields


def run_batch(
    videos: Sequence[Video],
    workers: int = 3,
    force: bool = False,
    allow_whisper: bool = True,
    whisper_model: str = "small",
    whisper_threads: int = 4,
) -> int:
    """Traite une liste de vidéos (sous-titres en parallèle, whisper un à la fois)."""
    n_ok = 0
    with ThreadPoolExecutor(max_workers=max(1, workers)) as pool:
        futures = {
            pool.submit(process_video, v, force, allow_whisper, whisper_model, whisper_threads): v[
                "id"
            ]
            for v in videos
        }
        for fut in as_completed(futures):
            try:
                if fut.result() is not None:
                    n_ok += 1
            except Exception:
                log.exception("%s : échec de la transcription", futures[fut])
    return n_ok


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument("--ids", nargs="*", help="restreint à ces identifiants de vidéo")
    ap.add_argument(
        "--limit",
        type=int,
        default=None,
        help="au plus N vidéos (par priorité : core, « graphique » dans le titre)",
    )
    ap.add_argument(
        "--relevance",
        nargs="+",
        default=["core", "mention"],
        choices=["core", "mention"],
        help="pertinences traitées",
    )
    ap.add_argument("--workers", type=int, default=3, help="téléchargements parallèles (3)")
    ap.add_argument("--force", action="store_true", help="refait les transcriptions existantes")
    ap.add_argument("--no-whisper", action="store_true", help="n'utilise jamais faster-whisper")
    ap.add_argument("--whisper-model", default="small", help="modèle faster-whisper (small)")
    ap.add_argument(
        "--whisper-threads",
        type=int,
        default=max(1, (os.cpu_count() or 4) // 2),
        help="threads CPU de faster-whisper",
    )
    ap.add_argument("-v", "--verbose", action="store_true")
    return ap.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    setup_logging(args.verbose)
    videos = select_videos(load_index(), args.relevance, args.ids, args.limit)
    todo = [v for v in videos if args.force or not is_done(v)]
    log.info("transcriptions : %d vidéos retenues, %d à traiter", len(videos), len(todo))
    n_ok = run_batch(
        todo,
        args.workers,
        args.force,
        not args.no_whisper,
        args.whisper_model,
        args.whisper_threads,
    )
    log.info("transcriptions : %d produites", n_ok)
    return 0


if __name__ == "__main__":
    sys.exit(main())
