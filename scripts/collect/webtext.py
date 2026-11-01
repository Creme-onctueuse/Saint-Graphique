"""Conversion de pages web en Markdown (bibliothèque standard uniquement, aucun réseau).

Fonctions pures utilisées par ``archive_web.py`` et testables partout :
conversion HTML -> Markdown, extraction des métadonnées de page (Open Graph,
JSON-LD), détection des pages de blocage et mise en forme du flux Bluesky.
"""

from __future__ import annotations

import contextlib
import json
import re
from html.parser import HTMLParser
from typing import Any

SKIPPED_TAGS = frozenset(
    {"script", "style", "noscript", "svg", "head", "nav", "footer", "form", "button", "iframe"}
)
VOID_TAGS = frozenset({"br", "hr", "img", "meta", "link", "input", "wbr", "area", "base", "col"})
HEADINGS = {f"h{i}": "#" * i for i in range(1, 7)}
BLOCK_TAGS = frozenset(
    {"p", "div", "section", "article", "main", "aside", "header", "ul", "ol", "table", "tr",
     "blockquote", "pre", "figure", "figcaption", "dl", "dt", "dd"}
)
BLOCK_MARKERS = (
    "just a moment", "cf-browser-verification", "challenge-platform",
    "enable javascript and cookies", "attention required", "access denied",
    "verify you are human",
)


class _MarkdownParser(HTMLParser):
    """Convertit du HTML en Markdown simple (titres, listes, liens, tableaux, citations)."""

    def __init__(self, root_id: str | None = None) -> None:
        super().__init__(convert_charrefs=True)
        self.out: list[str] = []
        self.root_id = root_id
        self.active = root_id is None
        self.root_depth = 0
        self.skip_depth = 0
        self.links: list[str | None] = []
        self.list_depth = 0
        self.in_pre = False
        self.cell_count = 0

    def _emit(self, text: str) -> None:
        if self.active and not self.skip_depth:
            self.out.append(text)

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attr = dict(attrs)
        if not self.active and attr.get("id") == self.root_id:
            self.active = True
            self.root_depth = 1
            return
        if self.active and self.root_id is not None and tag not in VOID_TAGS:
            self.root_depth += 1
        if tag in SKIPPED_TAGS:
            if tag not in VOID_TAGS:
                self.skip_depth += 1
            return
        if tag in HEADINGS:
            self._emit(f"\n\n{HEADINGS[tag]} ")
        elif tag == "br":
            self._emit("  \n")
        elif tag == "hr":
            self._emit("\n\n---\n\n")
        elif tag == "li":
            self._emit("\n" + "  " * max(0, self.list_depth - 1) + "- ")
        elif tag in ("ul", "ol"):
            self.list_depth += 1
            self._emit("\n")
        elif tag in ("strong", "b"):
            self._emit("**")
        elif tag in ("em", "i"):
            self._emit("*")
        elif tag == "code" and not self.in_pre:
            self._emit("`")
        elif tag == "pre":
            self.in_pre = True
            self._emit("\n\n```\n")
        elif tag == "a":
            self.links.append(attr.get("href"))
            self._emit("[")
        elif tag == "img":
            src = attr.get("src") or ""
            if src and not src.startswith("data:"):
                self._emit(f"![{attr.get('alt') or ''}]({src})")
        elif tag == "blockquote":
            self._emit("\n\n> ")
        elif tag == "tr":
            self.cell_count = 0
            self._emit("\n|")
        elif tag in ("td", "th"):
            self.cell_count += 1
            self._emit(" ")
        elif tag in BLOCK_TAGS:
            self._emit("\n\n")

    def handle_endtag(self, tag: str) -> None:
        if self.active and self.root_id is not None and tag not in VOID_TAGS:
            self.root_depth -= 1
            if self.root_depth <= 0:
                self.active = False
                return
        if tag in SKIPPED_TAGS:
            if self.skip_depth:
                self.skip_depth -= 1
            return
        if tag in HEADINGS:
            self._emit("\n\n")
        elif tag in ("ul", "ol"):
            self.list_depth = max(0, self.list_depth - 1)
            self._emit("\n")
        elif tag in ("strong", "b"):
            self._emit("**")
        elif tag in ("em", "i"):
            self._emit("*")
        elif tag == "code" and not self.in_pre:
            self._emit("`")
        elif tag == "pre":
            self.in_pre = False
            self._emit("\n```\n\n")
        elif tag == "a":
            href = self.links.pop() if self.links else None
            self._emit(f"]({href})" if href else "]")
        elif tag in ("td", "th"):
            self._emit(" |")
        elif tag in BLOCK_TAGS and tag != "tr":
            self._emit("\n\n")

    def handle_data(self, data: str) -> None:
        if self.in_pre:
            self._emit(data)
        else:
            self._emit(re.sub(r"\s+", " ", data))


def html_to_markdown(html_text: str, root_id: str | None = None) -> str:
    """Convertit du HTML en Markdown ; ``root_id`` restreint à un élément (par son id)."""
    parser = _MarkdownParser(root_id)
    parser.feed(html_text)
    parser.close()
    text = "".join(parser.out)
    text = re.sub(r"\[\s*\]\([^)]*\)", "", text)  # liens vides
    text = re.sub(r"[ \t]+\n", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip() + "\n" if text.strip() else ""


class _MetaParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.meta: dict[str, str] = {}
        self.title_parts: list[str] = []
        self.in_title = False
        self.script_type: str | None = None
        self.script_parts: list[str] = []
        self.json_ld: list[Any] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attr = dict(attrs)
        if tag == "title":
            self.in_title = True
        elif tag == "meta":
            key = attr.get("property") or attr.get("name")
            content = attr.get("content")
            if key and content and key.lower() not in self.meta:
                self.meta[key.lower()] = content
        elif tag == "script":
            self.script_type = (attr.get("type") or "").lower()
            self.script_parts = []

    def handle_endtag(self, tag: str) -> None:
        if tag == "title":
            self.in_title = False
        elif tag == "script":
            if self.script_type == "application/ld+json":
                with contextlib.suppress(ValueError):
                    self.json_ld.append(json.loads("".join(self.script_parts)))
            self.script_type = None

    def handle_data(self, data: str) -> None:
        if self.in_title:
            self.title_parts.append(data)
        elif self.script_type == "application/ld+json":
            self.script_parts.append(data)


def extract_page_meta(html_text: str) -> dict[str, Any]:
    """Titre, balises ``meta`` (Open Graph…) et blocs JSON-LD d'une page."""
    parser = _MetaParser()
    parser.feed(html_text)
    parser.close()
    return {
        "title": re.sub(r"\s+", " ", "".join(parser.title_parts)).strip(),
        "meta": parser.meta,
        "json_ld": parser.json_ld,
    }


def looks_blocked(status: int, html_text: str) -> str | None:
    """Motif de blocage d'une réponse (code HTTP, page de vérification), ou ``None``."""
    if status >= 400:
        return f"HTTP {status}"
    head = html_text[:4000].lower()
    for marker in BLOCK_MARKERS:
        if marker in head:
            return f"page de vérification ({marker})"
    return None


def bsky_post_to_markdown(item: dict[str, Any]) -> str:
    """Un élément de ``app.bsky.feed.getAuthorFeed`` en section Markdown.

    Les images sont renvoyées par leur URL de CDN (voir :func:`bsky_images`).
    """
    post = item.get("post") or {}
    record = post.get("record") or {}
    author = (post.get("author") or {}).get("handle", "?")
    rkey = (post.get("uri") or "").rsplit("/", 1)[-1]
    date = record.get("createdAt", "")
    lines = [f"## {date[:10]} ({rkey})", ""]
    reason = item.get("reason") or {}
    if reason.get("$type", "").endswith("reasonRepost"):
        lines += [f"*Republication d'un message de @{author}*", ""]
    if record.get("text"):
        lines += [record["text"], ""]
    for img in bsky_images(post):
        lines.append(f"![{img['alt']}]({img['url']})")
    embed = post.get("embed") or {}
    external = embed.get("external") or (embed.get("media") or {}).get("external")
    if external:
        uri = external.get("uri")
        lines.append(f"Lien : [{external.get('title') or uri}]({uri})")
    lines += [
        "",
        f"Date : {date} · auteur : @{author} · "
        f"réponses {post.get('replyCount', 0)}, republications {post.get('repostCount', 0)}, "
        f"j'aime {post.get('likeCount', 0)}",
        "",
    ]
    return "\n".join(lines)


def bsky_images(post: dict[str, Any]) -> list[dict[str, str]]:
    """Images d'un message Bluesky : ``[{url, alt}]`` (taille maximale)."""
    embed = post.get("embed") or {}
    images = embed.get("images") or (embed.get("media") or {}).get("images") or []
    return [
        {"url": img.get("fullsize") or img.get("thumb") or "", "alt": img.get("alt") or ""}
        for img in images
        if img.get("fullsize") or img.get("thumb")
    ]
