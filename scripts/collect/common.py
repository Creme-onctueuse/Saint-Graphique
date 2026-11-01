"""Utilitaires communs aux scripts de collecte (scripts/collect/).

Chemins du dossier ``research/``, lecture et écriture JSONL atomiques, verrou de
fichier inter-processus (l'index et le manifeste peuvent être mis à jour par
plusieurs processus), journalisation et appels à yt-dlp. Les fonctions pures
(texte, sous-titres, segments) sont dans :mod:`scripts.collect.pure`.

Ce module n'est pas destiné à être lancé directement.
"""

from __future__ import annotations

import contextlib
import json
import logging
import os
import shlex
import shutil
import subprocess
import sys
import tempfile
import time
from collections.abc import Iterable, Iterator, Sequence
from pathlib import Path
from typing import Any

from scripts.collect.pure import normalize

ROOT = Path(__file__).resolve().parents[2]
RESEARCH = ROOT / "research"
INDEX_DIR = RESEARCH / "index"
VIDEOS_JSONL = INDEX_DIR / "videos.jsonl"
CACHE_DIR = INDEX_DIR / "cache"
META_CACHE_DIR = CACHE_DIR / "meta"
LISTING_CACHE_DIR = CACHE_DIR / "listings"
SCREENING_JSON = CACHE_DIR / "screening.json"
TRANSCRIPTS_DIR = RESEARCH / "transcripts"
CAPTURES_DIR = RESEARCH / "captures"
MANIFEST_JSONL = CAPTURES_DIR / "manifest.jsonl"
CAPTURE_STATE_DIR = CAPTURES_DIR / "state"
WEB_DIR = RESEARCH / "web"
LOG_FILE = RESEARCH / "collect.log"

Video = dict[str, Any]

log = logging.getLogger("collect")

LOG_FORMAT = "%(asctime)s %(levelname)-7s [%(processName)s] %(name)s: %(message)s"


# --------------------------------------------------------------------------- fichiers


def rel(path: Path) -> str:
    """Chemin relatif à la racine du projet, au format POSIX (pour les fichiers JSONL)."""
    return path.resolve().relative_to(ROOT).as_posix()


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    """Lit un fichier JSONL (liste vide si absent ; lignes vides ignorées)."""
    if not path.exists():
        return []
    rows: list[dict[str, Any]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.strip():
            rows.append(json.loads(line))
    return rows


def read_json(path: Path, default: Any = None) -> Any:
    """Lit un fichier JSON, ou renvoie ``default`` s'il est absent ou illisible."""
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return default


def _replace_with_retry(src: Path, dst: Path, attempts: int = 30) -> None:
    """``os.replace`` avec réessais : OneDrive ou un antivirus peut verrouiller ``dst``."""
    for i in range(attempts):
        try:
            os.replace(src, dst)
            return
        except PermissionError:
            if i == attempts - 1:
                raise
            time.sleep(0.1 * (i + 1))


def write_text_atomic(path: Path, text: str) -> None:
    """Écrit un fichier texte UTF-8 de façon atomique (fichier temporaire puis remplacement)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(text)
        _replace_with_retry(Path(tmp), path)
    except BaseException:
        with contextlib.suppress(OSError):
            os.unlink(tmp)
        raise


def write_bytes_atomic(path: Path, data: bytes) -> None:
    """Écrit un fichier binaire de façon atomique."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as fh:
            fh.write(data)
        _replace_with_retry(Path(tmp), path)
    except BaseException:
        with contextlib.suppress(OSError):
            os.unlink(tmp)
        raise


def write_json_atomic(path: Path, obj: Any) -> None:
    """Écrit un objet JSON indenté de façon atomique."""
    write_text_atomic(path, json.dumps(obj, ensure_ascii=False, indent=2) + "\n")


def write_jsonl_atomic(path: Path, rows: Iterable[dict[str, Any]]) -> None:
    """Écrit un fichier JSONL de façon atomique."""
    write_text_atomic(path, "".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows))


@contextlib.contextmanager
def file_lock(target: Path, timeout: float = 600.0, stale_after: float = 1800.0) -> Iterator[None]:
    """Verrou exclusif inter-processus (fichier ``<target>.lock`` créé avec O_EXCL).

    Un verrou plus vieux que ``stale_after`` secondes est considéré comme abandonné.
    """
    lock = target.with_name(target.name + ".lock")
    lock.parent.mkdir(parents=True, exist_ok=True)
    deadline = time.monotonic() + timeout
    while True:
        try:
            fd = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        except FileExistsError:
            try:
                if time.time() - lock.stat().st_mtime > stale_after:
                    lock.unlink()
                    continue
            except OSError:
                pass
        except PermissionError:  # Windows : verrou en cours de suppression
            pass
        else:
            os.write(fd, str(os.getpid()).encode())
            os.close(fd)
            break
        if time.monotonic() > deadline:
            raise TimeoutError(f"verrou non obtenu : {lock}")
        time.sleep(0.05)
    try:
        yield
    finally:
        for _ in range(20):
            try:
                lock.unlink()
                break
            except FileNotFoundError:
                break
            except PermissionError:
                time.sleep(0.05)


# --------------------------------------------------------------------------- index


def load_index(path: Path = VIDEOS_JSONL) -> dict[str, Video]:
    """Charge ``research/index/videos.jsonl`` sous forme ``{id: vidéo}``."""
    return {row["id"]: row for row in read_jsonl(path)}


def save_index(videos: Iterable[Video], path: Path = VIDEOS_JSONL) -> None:
    """Écrit l'index trié par date de mise en ligne puis identifiant."""
    rows = sorted(videos, key=lambda v: (v.get("upload_date") or "", v["id"]))
    write_jsonl_atomic(path, rows)


def update_index(updates: dict[str, dict[str, Any]], path: Path = VIDEOS_JSONL) -> None:
    """Fusionne des champs dans les vidéos de l'index, sous verrou (sûr en multi-processus)."""
    if not updates:
        return
    with file_lock(path):
        index = load_index(path)
        for vid, fields in updates.items():
            if vid in index:
                index[vid].update(fields)
        save_index(index.values(), path)


def replace_manifest_rows(
    video_id: str, rows: list[dict[str, Any]], path: Path = MANIFEST_JSONL
) -> None:
    """Remplace les lignes du manifeste des captures d'une vidéo, sous verrou."""
    with file_lock(path):
        kept = [r for r in read_jsonl(path) if r.get("video_id") != video_id]
        kept.extend(rows)
        kept.sort(key=lambda r: (r.get("upload_date") or "", r["video_id"], r["timestamp_s"]))
        write_jsonl_atomic(path, kept)


def priority_key(video: Video) -> tuple[int, int, int]:
    """Ordre de traitement : core avant mention, titre contenant « graphique » d'abord,
    puis les plus récentes."""
    rank = {"core": 0, "mention": 1}.get(video.get("relevance", ""), 2)
    in_title = 0 if "graphique" in normalize(video.get("title", "")) else 1
    date = video.get("upload_date") or "0"
    return rank, in_title, -int(date) if date.isdigit() else 0


def select_videos(
    index: dict[str, Video],
    relevances: Sequence[str],
    ids: Sequence[str] | None = None,
    limit: int | None = None,
) -> list[Video]:
    """Vidéos de l'index filtrées par pertinence (et éventuellement par identifiants),
    triées par priorité et tronquées à ``limit``."""
    videos = [v for v in index.values() if v.get("relevance") in relevances]
    if ids:
        wanted = set(ids)
        videos = [v for v in videos if v["id"] in wanted]
    videos.sort(key=priority_key)
    return videos[:limit] if limit else videos


# --------------------------------------------------------------------------- processus


def subprocess_env() -> dict[str, str]:
    """Environnement des sous-processus Python : sortie UTF-8 forcée."""
    env = dict(os.environ)
    env["PYTHONUTF8"] = "1"
    env["PYTHONIOENCODING"] = "utf-8"
    return env


def ytdlp_base() -> list[str]:
    """Commande de base yt-dlp (module du venv courant), sans configuration utilisateur.

    Node.js est déclaré comme moteur JavaScript s'il est présent ; des options
    supplémentaires peuvent être passées par la variable ``SG_YTDLP_ARGS``.
    """
    cmd = [sys.executable, "-m", "yt_dlp", "--ignore-config", "--no-colors", "--no-progress"]
    if shutil.which("node"):
        cmd += ["--js-runtimes", "node"]
    extra = os.environ.get("SG_YTDLP_ARGS")
    if extra:
        cmd += shlex.split(extra)
    return cmd


def run(
    cmd: Sequence[str], timeout: float | None = None, cwd: Path | None = None
) -> subprocess.CompletedProcess[bytes]:
    """Lance une commande en capturant stdout/stderr (octets)."""
    log.debug("$ %s", subprocess.list2cmdline(list(cmd)))
    return subprocess.run(
        list(cmd), capture_output=True, timeout=timeout, cwd=cwd, env=subprocess_env(), check=False
    )


YTDLP_MIN_INTERVAL = float(os.environ.get("SG_YTDLP_MIN_INTERVAL", "2.0"))
YTDLP_COOLDOWN = float(os.environ.get("SG_YTDLP_COOLDOWN", "900"))
THROTTLE_MARKERS = ("not a bot", "HTTP Error 429", "Too Many Requests")
_LAST_CALL_FILE = CACHE_DIR / "ytdlp_last_call"
_BLOCKED_FILE = CACHE_DIR / "ytdlp_blocked_until"


class YouTubeBlocked(RuntimeError):
    """YouTube refuse les requêtes (HTTP 429 / « confirm you're not a bot »)."""


def _read_float(path: Path) -> float:
    try:
        return float(path.read_text(encoding="utf-8").strip() or 0)
    except (OSError, ValueError):
        return 0.0


def is_throttled(proc: subprocess.CompletedProcess[bytes]) -> bool:
    """Échec dû au bridage de YouTube (et non à la vidéo elle-même)."""
    err = proc.stderr.decode("utf-8", "replace")
    return proc.returncode != 0 and any(m in err for m in THROTTLE_MARKERS)


def mark_blocked(cooldown: float = YTDLP_COOLDOWN) -> None:
    """Note, pour tous les processus, que YouTube bloque jusqu'à maintenant + ``cooldown``."""
    with file_lock(_BLOCKED_FILE):
        until = max(_read_float(_BLOCKED_FILE), time.time() + cooldown)
        _BLOCKED_FILE.write_text(f"{until:.0f}", encoding="utf-8")
    log.warning("YouTube bride les requêtes : pause commune de %.0f s", cooldown)


def wait_if_blocked(max_wait: float | None = None) -> None:
    """Attend la fin d'une pause commune ; lève :class:`YouTubeBlocked` si elle dépasse
    ``max_wait`` secondes."""
    remaining = _read_float(_BLOCKED_FILE) - time.time()
    if remaining <= 0:
        return
    if max_wait is not None and remaining > max_wait:
        raise YouTubeBlocked(f"YouTube bloque encore pendant {remaining:.0f} s")
    log.info("YouTube bloque : attente de %.0f s", remaining)
    time.sleep(remaining)


def ytdlp(
    args: Sequence[str], timeout: float | None = None, max_wait: float | None = None
) -> subprocess.CompletedProcess[bytes]:
    """Appelle yt-dlp poliment : attend la fin d'un éventuel blocage, espace les appels
    d'au moins ``SG_YTDLP_MIN_INTERVAL`` secondes (tous processus confondus) et
    déclenche une pause commune si YouTube bride."""
    wait_if_blocked(max_wait)
    if YTDLP_MIN_INTERVAL > 0:
        with file_lock(_LAST_CALL_FILE):
            delay = _read_float(_LAST_CALL_FILE) + YTDLP_MIN_INTERVAL - time.time()
            if delay > 0:
                time.sleep(delay)
            _LAST_CALL_FILE.write_text(f"{time.time():.3f}", encoding="utf-8")
    proc = run([*ytdlp_base(), *args], timeout=timeout)
    if is_throttled(proc):
        mark_blocked()
    return proc


def stderr_tail(proc: subprocess.CompletedProcess[bytes], n: int = 600) -> str:
    """Fin de stderr décodée, sans les avertissements récurrents de yt-dlp."""
    text = proc.stderr.decode("utf-8", "replace")
    lines = [
        ln
        for ln in text.splitlines()
        if ln.strip() and "JavaScript" not in ln and "challenge" not in ln and "EJS" not in ln
    ]
    return "\n".join(lines)[-n:]


def video_url(video_id: str) -> str:
    """URL canonique d'une vidéo YouTube."""
    return f"https://www.youtube.com/watch?v={video_id}"


# --------------------------------------------------------------------------- journal


def setup_logging(verbose: bool = False, log_file: Path | None = LOG_FILE) -> None:
    """Journal vers la console et ``research/collect.log`` (ajout)."""
    with contextlib.suppress(AttributeError, ValueError):
        sys.stderr.reconfigure(errors="backslashreplace")  # type: ignore[union-attr]
    root = logging.getLogger()
    for handler in list(root.handlers):
        root.removeHandler(handler)
    root.setLevel(logging.DEBUG if verbose else logging.INFO)
    fmt = logging.Formatter(LOG_FORMAT)
    console = logging.StreamHandler()
    console.setFormatter(fmt)
    root.addHandler(console)
    if log_file is not None:
        log_file.parent.mkdir(parents=True, exist_ok=True)
        fh = logging.FileHandler(log_file, encoding="utf-8")
        fh.setFormatter(fmt)
        root.addHandler(fh)
    for noisy in ("faster_whisper", "urllib3", "PIL", "httpx", "huggingface_hub"):
        logging.getLogger(noisy).setLevel(logging.WARNING)


def setup_worker_logging(queue: Any, verbose: bool = False) -> None:
    """Initialiseur des processus du pool : tous les messages partent dans ``queue``."""
    import logging.handlers

    root = logging.getLogger()
    for handler in list(root.handlers):
        root.removeHandler(handler)
    root.addHandler(logging.handlers.QueueHandler(queue))
    root.setLevel(logging.DEBUG if verbose else logging.INFO)
    for noisy in ("faster_whisper", "urllib3", "PIL", "httpx", "huggingface_hub"):
        logging.getLogger(noisy).setLevel(logging.WARNING)


@contextlib.contextmanager
def process_pool(workers: int, verbose: bool = False) -> Iterator[Any]:
    """``ProcessPoolExecutor`` dont les processus journalisent via une file d'attente
    relayée vers les gestionnaires du processus principal (console et collect.log)."""
    import logging.handlers
    import multiprocessing
    from concurrent.futures import ProcessPoolExecutor

    manager = multiprocessing.Manager()
    queue = manager.Queue()
    listener = logging.handlers.QueueListener(
        queue, *logging.getLogger().handlers, respect_handler_level=True
    )
    listener.start()
    try:
        with ProcessPoolExecutor(
            max_workers=workers, initializer=setup_worker_logging, initargs=(queue, verbose)
        ) as pool:
            yield pool
    finally:
        listener.stop()
        manager.shutdown()
