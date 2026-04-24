"""Pytest suite for skills/gostdocs/scripts/postprocess-docx.py.

Covers the post-processing invariants added in Phase 6C:

* ``number_figures`` must skip captions already numbered by the Doc-Model
  renderer (``Рисунок N.M — ...``) without advancing the counter.
* ``number_figures`` must add the ``Рисунок N —`` prefix to plain captions.
* ``force_update_fields_on_open`` must add a ``w:updateFields`` element that
  forces Word to refresh the TOC page numbers on open, and must be
  idempotent across repeated runs.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest
from docx import Document
from docx.oxml.ns import qn

_SPEC_PATH = (
    Path(__file__).resolve().parent.parent
    / "skills"
    / "gostdocs"
    / "scripts"
    / "postprocess-docx.py"
)


def _load_module():
    spec = importlib.util.spec_from_file_location("postprocess_docx", _SPEC_PATH)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


postprocess = _load_module()


def _caption_paragraph(doc, text: str) -> None:
    paragraph = doc.add_paragraph(text)
    paragraph.style = doc.styles["Caption"] if "Caption" in doc.styles else doc.styles["Normal"]
    return paragraph


def test_number_figures_skips_already_numbered(tmp_path: Path) -> None:
    """Captions that already start with ``Рисунок `` keep their text."""

    doc = Document()
    paragraph = _caption_paragraph(doc, "Рисунок 1.1 — Главная страница")

    postprocess.number_figures(doc)

    assert paragraph.text == "Рисунок 1.1 — Главная страница"


def test_number_figures_does_not_increment_counter_for_existing(tmp_path: Path) -> None:
    """A pre-numbered caption followed by a plain one must yield ``Рисунок 1``, not ``2``."""

    doc = Document()
    _caption_paragraph(doc, "Рисунок 1.1 — Главная страница")
    plain = _caption_paragraph(doc, "Каталог мероприятий")

    postprocess.number_figures(doc)

    assert plain.text.startswith("Рисунок 1 — ")


def test_number_figures_adds_prefix_when_missing(tmp_path: Path) -> None:
    doc = Document()
    paragraph = _caption_paragraph(doc, "Главная страница")

    postprocess.number_figures(doc)

    assert paragraph.text == "Рисунок 1 — Главная страница"


def test_force_update_fields_adds_element(tmp_path: Path) -> None:
    doc = Document()

    postprocess.force_update_fields_on_open(doc)

    element = doc.settings.element.find(qn("w:updateFields"))
    assert element is not None
    assert element.get(qn("w:val")) == "true"


def test_force_update_fields_is_idempotent(tmp_path: Path) -> None:
    doc = Document()

    postprocess.force_update_fields_on_open(doc)
    postprocess.force_update_fields_on_open(doc)
    postprocess.force_update_fields_on_open(doc)

    elements = doc.settings.element.findall(qn("w:updateFields"))
    assert len(elements) == 1
    assert elements[0].get(qn("w:val")) == "true"


def test_scan_for_placeholders_detects_leaks(tmp_path: Path) -> None:
    doc = Document()
    doc.add_paragraph("Нормальный текст на русском.")
    doc.add_paragraph("Пользователь «{role}» выполняет задачи.")
    doc.add_paragraph("Ошибки –> пример в прозе.")
    table = doc.add_table(rows=1, cols=2)
    table.rows[0].cells[0].text = "AGENT: fill me"
    table.rows[0].cells[1].text = "<!-- unfinished"

    findings = postprocess.scan_for_placeholders(doc)

    tags = [tag for _, tag, _ in findings]
    assert "unresolved-mustache" in tags
    assert "em-dash-arrow" in tags
    assert "agent-marker" in tags
    assert "raw-html-comment" in tags
    assert not any("Нормальный текст" in snippet for _, _, snippet in findings)


def test_scan_for_placeholders_clean_doc_returns_empty(tmp_path: Path) -> None:
    doc = Document()
    doc.add_paragraph("Документ полностью заполнен.")
    doc.add_paragraph("Ещё один нормальный абзац.")

    findings = postprocess.scan_for_placeholders(doc)

    assert findings == []


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(pytest.main([str(Path(__file__))]))
