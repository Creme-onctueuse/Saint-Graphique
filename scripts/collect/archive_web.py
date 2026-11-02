"""Étape 6 : archive en Markdown du contenu public lié au Saint-Graphique.

Enregistre dans ``research/web/`` (jamais publié) :

- la page Politiwiki de Positions Revue ;
- le README de JnthnBS/saint-graphique (copie locale ``research/ref/jnthnbs``) ;
- le fil Threads d'albertonorato ;
- le profil Bluesky saintgraphique.bsky.social (API publique ``getAuthorFeed``,
  images dans ``research/web/bsky/``) ;
- la critique SensCritique de la PaduTeam.

Une page qui bloque (HTTP 4xx/5xx, page de vérification, mur de connexion) est
notée telle quelle dans ``research/web/_index.md`` et la suivante est traitée :
aucun contournement n'est tenté. Reprise : une source déjà archivée (état
``research/web/_status.json``) n'est pas redemandée, sauf ``--force`` ; les
sources bloquées sont retentées à chaque exécution.

Usage :
    uv run python scripts/collect/archive_web.py [--force] [--no-images]
"""

from __future__ import annotations

import argparse
import logging
import sys
import time
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import requests

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scripts.collect.common import (  # noqa: E402
    RESEARCH,
    WEB_DIR,
    read_json,
    setup_logging,
    write_bytes_atomic,
    write_json_atomic,
    write_text_atomic,
)
from scripts.collect.webtext import (  # noqa: E402
    bsky_images,
    bsky_post_to_markdown,
    extract_page_meta,
    html_to_markdown,
    looks_blocked,
)

log = logging.getLogger("collect.web")

USER_AGENT = "Mozilla/5.0 (compatible; saint-graphique-archive/0.1; recherche personnelle)"
TIMEOUT = 30
STATUS_FILE = WEB_DIR / "_status.json"
BSKY_FEED = "https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed"
BSKY_ACTOR = "saintgraphique.bsky.social"
OK, PARTIAL, BLOCKED = "ok", "partiel", "bloqué"


@dataclass
class Result:
    """Issue de l'archivage d'une source."""

    status: str
    file: str | None
    note: str = ""


def _now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


def _header(title: str, url: str, note: str = "") -> str:
    lines = [f"# {title}", "", f"- Source : {url}", f"- Archivé le : {_now()}"]
    if note:
        lines.append(f"- Note : {note}")
    return "\n".join(lines) + "\n\n---\n\n"


def _get(session: requests.Session, url: str, **kwargs: Any) -> requests.Response:
    return session.get(url, timeout=TIMEOUT, **kwargs)


def _meta_section(meta: dict[str, Any]) -> str:
    """Métadonnées de page (Open Graph) en Markdown."""
    tags = meta["meta"]
    lines = []
    for key in (
        "og:title",
        "og:description",
        "description",
        "og:image",
        "article:published_time",
        "article:author",
        "author",
    ):
        if tags.get(key):
            lines.append(f"- **{key}** : {tags[key]}")
    return "\n".join(lines)


def archive_page(
    session: requests.Session,
    title: str,
    url: str,
    filename: str,
    root_id: str | None = None,
    min_body: int = 400,
) -> Result:
    """Archive une page HTML ; ``partiel`` si seules les métadonnées sont exploitables."""
    try:
        resp = _get(session, url, headers={"Accept-Language": "fr,en;q=0.8"})
    except requests.RequestException as exc:
        return Result(BLOCKED, None, f"erreur réseau : {type(exc).__name__}")
    blocked = looks_blocked(resp.status_code, resp.text)
    if blocked:
        return Result(BLOCKED, None, blocked)
    meta = extract_page_meta(resp.text)
    body = html_to_markdown(resp.text, root_id)
    meta_md = _meta_section(meta)
    if len(body) < min_body and not meta_md:
        return Result(BLOCKED, None, f"page vide ou mur de connexion ({len(body)} caractères)")
    status = OK if len(body) >= min_body else PARTIAL
    note = "" if status == OK else "contenu rendu en JavaScript : seules les métadonnées sont lues"
    text = _header(title, url, note)
    if meta["title"]:
        text += f"**Titre de la page :** {meta['title']}\n\n"
    if meta_md:
        text += f"## Métadonnées\n\n{meta_md}\n\n"
    if meta["json_ld"]:
        import json

        text += "## Données structurées\n\n```json\n"
        text += json.dumps(meta["json_ld"], ensure_ascii=False, indent=1)[:20000]
        text += "\n```\n\n"
    if body:
        text += f"## Contenu\n\n{body}"
    path = WEB_DIR / filename
    write_text_atomic(path, text)
    return Result(status, filename, note)


def archive_readme(session: requests.Session) -> Result:
    """Copie le README de JnthnBS/saint-graphique depuis le clone local (sans licence :
    consultation seulement, jamais recopié dans le code du projet)."""
    src = RESEARCH / "ref" / "jnthnbs" / "README.md"
    url = "https://github.com/JnthnBS/saint-graphique"
    if not src.exists():
        return Result(BLOCKED, None, "clone local research/ref/jnthnbs absent")
    note = "copie du clone local ; dépôt sans licence : information seulement"
    write_text_atomic(
        WEB_DIR / "jnthnbs_readme.md",
        _header("JnthnBS/saint-graphique : README", url, note) + src.read_text(encoding="utf-8"),
    )
    return Result(OK, "jnthnbs_readme.md", note)


def archive_bluesky(session: requests.Session, images: bool = True, pages: int = 50) -> Result:
    """Archive le flux Bluesky (pagination par curseur) et ses images."""
    posts: list[dict[str, Any]] = []
    cursor: str | None = None
    for _ in range(pages):
        params: dict[str, Any] = {"actor": BSKY_ACTOR, "limit": 100}
        if cursor:
            params["cursor"] = cursor
        try:
            resp = _get(session, BSKY_FEED, params=params)
        except requests.RequestException as exc:
            return Result(BLOCKED, None, f"erreur réseau : {type(exc).__name__}")
        if resp.status_code != 200:
            return Result(BLOCKED, None, f"HTTP {resp.status_code}")
        data = resp.json()
        posts.extend(data.get("feed") or [])
        cursor = data.get("cursor")
        if not cursor:
            break
        time.sleep(0.5)
    n_images = 0
    if images:
        for item in posts:
            post = item.get("post") or {}
            rkey = (post.get("uri") or "").rsplit("/", 1)[-1]
            for i, img in enumerate(bsky_images(post)):
                path = WEB_DIR / "bsky" / f"{rkey}_{i}.jpg"
                if path.exists():
                    n_images += 1
                    continue
                try:
                    r = _get(session, img["url"])
                except requests.RequestException:
                    continue
                if r.status_code == 200:
                    write_bytes_atomic(path, r.content)
                    n_images += 1
                time.sleep(0.2)
    url = f"https://bsky.app/profile/{BSKY_ACTOR}"
    note = f"{len(posts)} message(s), {n_images} image(s) dans research/web/bsky/"
    text = _header(f"Bluesky : {BSKY_ACTOR}", url, note)
    text += "\n".join(bsky_post_to_markdown(item) for item in posts)
    write_text_atomic(WEB_DIR / "bsky_saintgraphique.md", text)
    write_json_atomic(WEB_DIR / "bsky" / "feed.json", {"actor": BSKY_ACTOR, "feed": posts})
    return Result(OK if posts else PARTIAL, "bsky_saintgraphique.md", note)


def run_step(force: bool = False, images: bool = True) -> dict[str, dict[str, Any]]:
    """Archive toutes les sources et écrit ``_index.md`` ; renvoie l'état par source."""
    WEB_DIR.mkdir(parents=True, exist_ok=True)
    session = requests.Session()
    session.headers["User-Agent"] = USER_AGENT
    sources: dict[str, tuple[str, Callable[[], Result]]] = {
        "politiwiki": (
            "https://politiwiki.fr/wiki/Positions_Revue",
            lambda: archive_page(
                session,
                "Politiwiki : Positions Revue",
                "https://politiwiki.fr/wiki/Positions_Revue",
                "politiwiki.md",
                root_id="mw-content-text",
            ),
        ),
        "jnthnbs": ("https://github.com/JnthnBS/saint-graphique", lambda: archive_readme(session)),
        "threads": (
            "https://www.threads.com/@albertonorato/post/DKCKDj6Nmlr",
            lambda: archive_page(
                session,
                "Threads : fil d'albertonorato",
                "https://www.threads.com/@albertonorato/post/DKCKDj6Nmlr",
                "threads_albertonorato.md",
            ),
        ),
        "bluesky": (
            f"https://bsky.app/profile/{BSKY_ACTOR}",
            lambda: archive_bluesky(session, images=images),
        ),
        "senscritique": (
            "https://www.senscritique.com/serie/paduteam/critique/335478435",
            lambda: archive_page(
                session,
                "SensCritique : critique de la PaduTeam",
                "https://www.senscritique.com/serie/paduteam/critique/335478435",
                "senscritique.md",
            ),
        ),
    }
    state: dict[str, dict[str, Any]] = read_json(STATUS_FILE) or {}
    for name, (url, action) in sources.items():
        previous = state.get(name) or {}
        if previous.get("status") == OK and not force:
            log.info("%s : déjà archivé", name)
            continue
        result = action()
        state[name] = {
            "url": url,
            "status": result.status,
            "file": result.file,
            "note": result.note,
            "at": _now(),
        }
        write_json_atomic(STATUS_FILE, state)
        log.log(
            logging.INFO if result.status == OK else logging.WARNING,
            "%s : %s %s",
            name,
            result.status,
            result.note,
        )
    lines = [
        "# Archive web du Saint-Graphique",
        "",
        "Matériel de recherche local, jamais publié.",
        "",
        "| Source | État | Fichier | Note | Date |",
        "|---|---|---|---|---|",
    ]
    for entry in state.values():
        lines.append(
            f"| {entry['url']} | {entry['status']} | {entry['file'] or ''} | "
            f"{entry['note']} | {entry['at']} |"
        )
    write_text_atomic(WEB_DIR / "_index.md", "\n".join(lines) + "\n")
    return state


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument("--force", action="store_true", help="réarchive les sources déjà archivées")
    ap.add_argument("--no-images", action="store_true", help="ne télécharge pas les images Bluesky")
    ap.add_argument("-v", "--verbose", action="store_true")
    return ap.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    setup_logging(args.verbose)
    run_step(args.force, not args.no_images)
    return 0


if __name__ == "__main__":
    sys.exit(main())
