"""Tests des fonctions pures de la collecte : aucun appel réseau.

Seul le dernier test dépend de l'extra « research » (OpenCV, imagehash, Pillow), via
``pytest.importorskip`` : la CI publique, qui n'installe que « dev », le saute.
"""

from __future__ import annotations

from collections import Counter

import pytest

from scripts.collect import poids_recensements
from scripts.collect.pure import (
    axes_kind,
    boilerplate_lines,
    chart_segments,
    choose_subtitle,
    classify,
    cluster_hits,
    dedupe,
    extract_links,
    find_hits,
    fmt_mmss,
    format_transcript,
    hamming_hex,
    is_complete_meta,
    is_grid,
    json3_to_lines,
    merge_segments,
    nearest_duplicate,
    normalize,
    parse_transcript,
    parse_vtt,
    sampling_plan,
    screening_relevance,
    spoken_signal,
    strip_boilerplate,
    upgrade_relevance,
    vtt_to_lines,
)
from scripts.collect.webtext import (
    bsky_images,
    bsky_post_to_markdown,
    extract_page_meta,
    html_to_markdown,
    looks_blocked,
)

# Les sous-titres automatiques YouTube contiennent des lignes d'une seule espace (\x20).
ROLLING_VTT = """WEBVTT
Kind: captions
Language: fr

00:00:00.199 --> 00:00:02.830 align:start position:0%
\x20
le<00:00:00.399><c> graphique</c><00:00:00.960><c> est-il</c>

00:00:02.830 --> 00:00:02.840 align:start position:0%
le graphique est-il
\x20

00:00:02.840 --> 00:00:04.670 align:start position:0%
le graphique est-il
c'est<00:00:03.080><c> la</c><00:00:03.199><c> question</c>

00:00:04.670 --> 00:00:04.680 align:start position:0%
c'est la question
\x20
"""


# ------------------------------------------------------------------ sous-titres


def test_parse_vtt_keeps_payload_after_space_only_line():
    cues = parse_vtt(ROLLING_VTT)
    assert len(cues) == 4
    assert cues[0].lines == ("le graphique est-il",)
    assert cues[0].start == pytest.approx(0.199)


def test_vtt_to_lines_removes_rolling_duplicates():
    assert vtt_to_lines(ROLLING_VTT) == [
        (pytest.approx(0.199), "le graphique est-il"),
        (pytest.approx(2.84), "c'est la question"),
    ]


def test_vtt_handles_hours_srt_commas_and_entities():
    cues = parse_vtt("1\n01:02:03,500 --> 01:02:04,000\nA &amp; B\n")
    assert cues[0].start == pytest.approx(3723.5)
    assert cues[0].lines == ("A & B",)


def test_dedupe_keeps_distant_repeats_and_extends_prefixes():
    lines = [(0.0, "a"), (1.0, "b"), (2.0, "c"), (3.0, "d"), (4.0, "e"), (5.0, "a")]
    assert [t for _, t in dedupe(lines)] == ["a", "b", "c", "d", "e", "a"]
    assert dedupe([(0.0, "bonjour"), (1.0, "bonjour à tous")]) == [(0.0, "bonjour à tous")]


def test_json3_to_lines_skips_newline_events():
    data = {
        "events": [
            {"tStartMs": 0, "dDurationMs": 10},
            {"tStartMs": 199, "segs": [{"utf8": "le"}, {"utf8": " graphique"}]},
            {"tStartMs": 2830, "aAppend": 1, "segs": [{"utf8": "\n"}]},
            {"tStartMs": 2840, "segs": [{"utf8": "suite"}]},
        ]
    }
    assert json3_to_lines(data) == [
        (pytest.approx(0.199), "le graphique"),
        (pytest.approx(2.84), "suite"),
    ]


def test_transcript_round_trip_beyond_one_hour():
    assert fmt_mmss(3725) == "62:05"
    text = format_transcript([(5.0, "début"), (3725.9, "fin")])
    assert text == "[00:05] début\n[62:05] fin\n"
    assert parse_transcript(text + "ligne sans horodatage\n") == [(5, "début"), (3725, "fin")]


def test_choose_subtitle_prefers_manual_then_original_auto():
    assert choose_subtitle({"subtitle_langs": ["en", "fr-FR", "live_chat"]}) == ("fr-FR", "manual")
    meta = {"subtitle_langs": ["frp"], "auto_caption_langs": ["fr", "fr-orig"]}
    assert choose_subtitle(meta) == ("fr-orig", "auto")
    assert choose_subtitle({"auto_caption_langs": ["fr"]}) == ("fr", "auto")
    assert choose_subtitle({"subtitle_langs": [], "auto_caption_langs": ["en-orig"]}) is None


# ------------------------------------------------------------------ segments


def _lines_at(*times: float, text: str = "sur le graphique on voit les cadres") -> list:
    return [(t, text) for t in times]


def test_find_hits_distinguishes_retraites_and_retraites_accentues():
    assert {h.label for h in find_hits([(0, "les retraités votent")])} == {"retraités"}
    assert find_hits([(0, "la réforme des retraites")]) == []


def test_cluster_hits_splits_on_gap():
    hits = find_hits(_lines_at(0, 30, 200))
    clusters = cluster_hits(hits, max_gap=60)
    assert [len(c) for c in clusters] == [4, 2]


def test_merge_segments_unites_keywords_and_scores():
    merged = merge_segments(
        [
            {"start_s": 50.0, "end_s": 60.0, "keywords": ["b"], "score": 2},
            {"start_s": 0.0, "end_s": 30.0, "keywords": ["a"], "score": 1},
            {"start_s": 100.0, "end_s": 110.0, "keywords": ["c"], "score": 5},
        ],
        gap=25.0,
    )
    assert merged == [
        {"start_s": 0.0, "end_s": 60.0, "keywords": ["a", "b"], "score": 3},
        {"start_s": 100.0, "end_s": 110.0, "keywords": ["c"], "score": 5},
    ]


def test_chart_segments_applies_margin_and_clamps():
    segs = chart_segments(_lines_at(10, 40), duration=50)
    assert len(segs) == 1
    assert segs[0]["start_s"] == 0.0  # 10 - 20, borné à 0
    assert segs[0]["end_s"] == 50.0  # 40 + 5 + 20, borné à la durée
    assert "graphique" in segs[0]["keywords"]


def test_chart_segments_ignores_isolated_generic_words():
    assert chart_segments([(100.0, "les cadres"), (500.0, "les ouvriers")]) == []
    assert chart_segments([(100.0, "un graphique")]) == []  # poids 2 < 4


def test_sampling_plan():
    assert sampling_plan([], 100.0) == [(0.0, 100.0, 10.0)]
    assert sampling_plan([], 0.0) == []
    segs = [{"start_s": 20.0, "end_s": 40.0}, {"start_s": 35.0, "end_s": 50.0}]
    assert sampling_plan(segs, 100.0) == [(20.0, 50.0, 2.0)]
    assert sampling_plan(segs, 100.0, full_scan=True) == [
        (0.0, 20.0, 10.0),
        (20.0, 50.0, 2.0),
        (50.0, 100.0, 10.0),
    ]


# ------------------------------------------------------------------ pertinence


@pytest.mark.parametrize(
    ("title", "desc", "channel", "expected"),
    [
        ("Le GRAPHIQUE est-il vraiment SEXISTE ?", "", "PaduTeam", "core"),
        ("Je DÉBUNK le saint GRAPHIQUE", "", "Une autre chaîne", "core"),
        ("Analyse GRAPHOMARXISME", "", "PaduTeam", "core"),
        ("Une vidéo", "on parle du saint graphique ici", "PaduTeam", "core"),
        ("Une vidéo", "on parle du saint graphique ici", "Une autre chaîne", "mention"),
        (
            "Définition du design de communication graphique",
            "",
            "Central Saint Martins",
            "unrelated",
        ),
        ("Saints Row 2 Graphics Mod", "", "KTMX", "unrelated"),
        ("Une vidéo", "l'électorat de gauche", "PaduTeam", "mention"),
        ("Les Voix de l'Exploitation", "", "Revue Positions", "unrelated"),
    ],
)
def test_classify(title, desc, channel, expected):
    assert classify(title, desc, channel)[0] == expected


def test_classify_curated_tags_and_search_signal():
    assert classify("Cannabis", "", "PaduTeam", curated=True)[0] == "core"
    assert classify("Une vidéo", "", "PaduTeam", tags=["saint graphique"])[0] == "core"
    assert classify("Une vidéo", "", "PaduTeam", tags=["graphique"])[0] == "mention"
    assert classify("Une vidéo", "", "PaduTeam", search_hit=True)[0] == "mention"
    assert classify("Une vidéo", "", "Autre", search_hit=True)[0] == "unrelated"


def test_boilerplate_and_navigation_lines_are_stripped():
    descs = [f"Vidéo {i}\nNotre LinkTree : https://x.y/{i}" for i in range(10)]
    boiler = boilerplate_lines(descs, min_count=3, min_ratio=0.2)
    assert "notre linktree" in boiler
    out = strip_boilerplate(
        "Le fond\nNotre LinkTree : https://x.y/z\nPlaylist du Graphique : https://y.t/p", boiler
    )
    assert out == "Le fond"
    assert classify("Une vidéo", out, "PaduTeam")[0] == "unrelated"


def test_is_complete_meta_rejects_partial_responses():
    assert is_complete_meta({"duration": 12})
    assert is_complete_meta({"error": "Private video"})
    assert not is_complete_meta({"duration": None, "title": "x"})


def test_spoken_signal_and_screening():
    signal = spoken_signal([(0.0, "Le saint graphique"), (1.0, "ce graphique et ces graphiques")])
    assert signal["graphique"] == 3
    assert signal["saint_graphique"] == 1
    assert screening_relevance({"graphique": 0}) is None
    assert screening_relevance({"graphique": 3}) == "mention"
    assert screening_relevance({"graphique": 40}) == "core"
    assert upgrade_relevance("unrelated", "mention") == "mention"
    assert upgrade_relevance("core", "mention") == "core"
    assert upgrade_relevance("mention", None) == "mention"


def test_text_helpers():
    assert normalize("  Électorat’S  DE  ") == "electorat's de"
    assert extract_links("voir https://a.b/c, puis https://a.b/c et http://d.e.") == [
        "https://a.b/c",
        "http://d.e",
    ]


# ------------------------------------------------------------------ axes et hashs


def test_axes_kind():
    h, v = [(0.0, 100.0, 50.0)], [(0.0, 100.0, 50.0)]
    assert axes_kind(h, v) == "cross"
    assert axes_kind([(0.0, 100.0, 0.0)], [(0.0, 100.0, 0.0)]) == "corner"
    assert axes_kind([(0.0, 40.0, 50.0)], [(0.0, 100.0, 80.0)]) is None
    assert axes_kind([], v) is None
    grid_h = [(0.0, 100.0, float(y)) for y in (10, 30, 50, 70)]
    grid_v = [(0.0, 100.0, float(x)) for x in (10, 30, 50, 70)]
    assert is_grid(grid_h, grid_v)
    assert not is_grid(h, v)


def test_hash_helpers():
    assert hamming_hex("ff00", "ff01") == 1
    assert nearest_duplicate("00ff", ["ffff", "00fe", "00f0"], max_dist=6) == 1
    assert nearest_duplicate("0000", ["ffff"], max_dist=6) is None


# ------------------------------------------------------------------ web


def test_html_to_markdown():
    html = (
        "<html><head><title>T</title><script>x()</script></head><body><nav>menu</nav>"
        "<div id='c'><h2>Titre</h2><p>Un <a href='/u'>lien</a> et <b>gras</b>.</p>"
        "<ul><li>a</li><li>b</li></ul></div><p>hors zone</p></body></html>"
    )
    md = html_to_markdown(html, root_id="c")
    assert "## Titre" in md
    assert "[lien](/u)" in md
    assert "**gras**" in md
    assert "- a" in md
    assert "hors zone" not in md
    assert "menu" not in html_to_markdown(html)


def test_extract_page_meta_and_blocking():
    html = (
        '<title> Page </title><meta property="og:description" content="Le texte">'
        '<script type="application/ld+json">{"a": 1}</script>'
    )
    meta = extract_page_meta(html)
    assert meta["title"] == "Page"
    assert meta["meta"]["og:description"] == "Le texte"
    assert meta["json_ld"] == [{"a": 1}]
    assert looks_blocked(403, "") == "HTTP 403"
    assert looks_blocked(200, "<title>Just a moment...</title>") is not None
    assert looks_blocked(200, "<p>ok</p>") is None


def test_bsky_post_to_markdown():
    item = {
        "post": {
            "uri": "at://did:plc:x/app.bsky.feed.post/abc123",
            "author": {"handle": "saintgraphique.bsky.social"},
            "record": {"text": "Bonjour", "createdAt": "2025-05-01T10:00:00Z"},
            "embed": {"images": [{"fullsize": "https://cdn/i.jpg", "alt": "le graphique"}]},
            "likeCount": 3,
        }
    }
    md = bsky_post_to_markdown(item)
    assert "## 2025-05-01 (abc123)" in md
    assert "![le graphique](https://cdn/i.jpg)" in md
    assert bsky_images(item["post"]) == [{"url": "https://cdn/i.jpg", "alt": "le graphique"}]


# ------------------------------------------------------------------ score visuel


def test_chart_features_separates_synthetic_chart_from_plain_frame():
    cv2 = pytest.importorskip("cv2")
    pytest.importorskip("imagehash")
    pytest.importorskip("PIL")
    np = pytest.importorskip("numpy")
    from scripts.collect.extract_frames import DEFAULT_THRESHOLD, chart_features

    frame = np.full((480, 854, 3), (60, 200, 250), dtype=np.uint8)  # fond jaune (BGR)
    cv2.rectangle(frame, (30, 100), (545, 380), (255, 255, 255), -1)
    cv2.line(frame, (30, 240), (545, 240), (90, 90, 90), 1)
    cv2.line(frame, (287, 100), (287, 380), (90, 90, 90), 1)
    for x, y, r in [
        (100, 150, 8),
        (170, 310, 14),
        (230, 170, 10),
        (350, 150, 12),
        (430, 320, 9),
        (480, 170, 16),
        (340, 320, 11),
        (120, 300, 7),
        (400, 200, 8),
        (200, 280, 9),
    ]:
        cv2.circle(frame, (x, y), r, (20, 20, 20), 2, cv2.LINE_AA)
    chart = chart_features(frame)
    assert chart.axes == "cross"
    assert chart.n_circles >= 8
    assert chart.score >= DEFAULT_THRESHOLD

    plain = np.full((480, 854, 3), (60, 200, 250), dtype=np.uint8)
    assert chart_features(plain).score < DEFAULT_THRESHOLD


def test_chart_features_detects_dark_theme_chart():
    cv2 = pytest.importorskip("cv2")
    pytest.importorskip("imagehash")
    pytest.importorskip("PIL")
    np = pytest.importorskip("numpy")
    from scripts.collect.extract_frames import DEFAULT_THRESHOLD, chart_features

    frame = np.full((480, 854, 3), (60, 200, 250), dtype=np.uint8)  # fond jaune (BGR)
    cv2.rectangle(frame, (20, 80), (585, 410), (5, 5, 5), -1)
    cv2.line(frame, (20, 230), (585, 230), (180, 180, 180), 1)
    cv2.line(frame, (300, 80), (300, 410), (180, 180, 180), 1)
    for x, y, r in [
        (100, 150, 8),
        (170, 310, 14),
        (230, 170, 10),
        (350, 150, 12),
        (430, 320, 9),
        (480, 170, 16),
        (340, 320, 11),
        (120, 300, 7),
        (400, 200, 8),
        (200, 280, 9),
    ]:
        cv2.circle(frame, (x, y), r, (170, 170, 170), -1, cv2.LINE_AA)
    chart = chart_features(frame)
    assert chart.dark
    assert chart.n_discs >= 8
    assert chart.score >= DEFAULT_THRESHOLD

    # Interface sombre sans bulles : le thème sombre ne doit pas se déclencher.
    ui = np.full((480, 854, 3), (5, 5, 5), dtype=np.uint8)
    cv2.line(ui, (0, 240), (853, 240), (60, 60, 60), 1)
    assert chart_features(ui).score < DEFAULT_THRESHOLD


# --- Poids des recensements -----------------------------------------------------------------------


def test_census_categories_map_to_project_groups() -> None:
    assert [poids_recensements.group_of_csp(c) for c in "123456"] == list("123456")
    assert poids_recensements.group_of_csp("8") == "7"
    assert poids_recensements.group_of_csp("9") == "8"
    with pytest.raises(ValueError, match="CSP inconnue"):
        poids_recensements.group_of_csp("7")


def test_census_keeps_french_adults_only() -> None:
    assert poids_recensements.is_elector_proxy(18, "000")
    assert poids_recensements.is_elector_proxy(40, "001")
    assert not poids_recensements.is_elector_proxy(17, "000")
    assert not poids_recensements.is_elector_proxy(40, "1PT")


def test_census_rows_add_up_by_year_and_group() -> None:
    totals: Counter[tuple[str, str]] = Counter()
    poids_recensements.add_rows(
        totals,
        [1999, 1999, 1999, 2011],
        ["040", "020", "017", "065"],
        ["000", "001", "000", "3MA"],
        ["3", "3", "6", "8"],
        [4.0, 1.5, 9.0, 2.0],
    )
    assert totals == {("1999", "3"): 5.5}


def test_census_file_lists_a_line_per_year() -> None:
    totals = Counter({("1999", "1"): 10.4, ("1999", "8"): 2.0, ("2011", "7"): 3.0})
    text = poids_recensements.render(totals, "2026-11-02", "abc")
    lines = text.splitlines()
    assert "# accessed: 2026-11-02" in lines
    assert "# sha256: abc" in lines
    assert lines[-3:] == ["annee,1,2,3,4,5,6,7,8", "1999,10,0,0,0,0,0,0,2", "2011,0,0,0,0,0,0,3,0"]
