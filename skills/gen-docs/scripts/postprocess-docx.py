#!/usr/bin/env python3
"""Post-process pandoc-generated DOCX to fix formatting issues.

Fixes:
1. Table borders: adds full grid borders to all tables
2. Table cell indents: removes first-line indent inherited from styles
3. Image sizing: scales images to fit content width, removes indent
4. Figure numbering: adds "Рисунок N —" prefix to image captions
5. Title font: ensures correct GOST font
6. TOC indents: removes first-line indent from TOC paragraphs
7. Compact style: removes first-line indent (used in tables/lists)
8. Emoji replacement: replaces checkbox emoji with text equivalents

Usage:
    python3 postprocess-docx.py <input.docx> [--font "Times New Roman"]
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Emu, Mm, Pt


PLACEHOLDER_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("unresolved-mustache", re.compile(r"(?<!\\)\{[a-z_][a-z0-9_]*\}")),
    ("agent-marker", re.compile(r"AGENT:")),
    ("em-dash-arrow", re.compile(r"–>")),
    ("raw-html-comment", re.compile(r"<!--")),
    ("unresolved-directive", re.compile(r"UNRESOLVED-DIRECTIVE:")),
)


def iter_paragraph_texts(doc: Document):
    """Yield (context, text) pairs covering body paragraphs and table cells.

    Keeping this generic means placeholder detection works even for content
    promoted into table cells (headers, cell text) — the spots where the
    pre-pandoc lint cannot reach once the DOCX has been rendered.
    """
    for idx, paragraph in enumerate(doc.paragraphs, start=1):
        text = paragraph.text.strip()
        if text:
            yield f"¶{idx}", text
    for t_idx, table in enumerate(doc.tables, start=1):
        for r_idx, row in enumerate(table.rows, start=1):
            for c_idx, cell in enumerate(row.cells, start=1):
                for p_idx, paragraph in enumerate(cell.paragraphs, start=1):
                    text = paragraph.text.strip()
                    if text:
                        yield f"table{t_idx}:r{r_idx}c{c_idx}¶{p_idx}", text


def scan_for_placeholders(doc: Document) -> list[tuple[str, str, str]]:
    """Return a list of ``(context, tag, snippet)`` for every placeholder hit.

    The pre-pandoc lint already blocks these in strict mode, but a second
    pass on the materialised DOCX catches leaks that slipped through
    pandoc's own rewriting (for instance, ``-->`` turning into ``–>`` only
    after the markdown → DOCX transformation).
    """
    findings: list[tuple[str, str, str]] = []
    for context, text in iter_paragraph_texts(doc):
        for tag, pattern in PLACEHOLDER_PATTERNS:
            match = pattern.search(text)
            if match is not None:
                snippet = text[:120].replace("\n", " ")
                findings.append((context, tag, snippet))
                break
    return findings


# Content width = page_width - left_margin - right_margin = 210 - 20 - 10 = 180mm
# Use 170mm max to leave some breathing room
MAX_IMAGE_WIDTH_EMU = Mm(170)


def set_paragraph_indent_zero(paragraph_element) -> None:
    """Force first-line indent to 0 on a paragraph element."""
    ppr = paragraph_element.find(qn("w:pPr"))
    if ppr is None:
        ppr = OxmlElement("w:pPr")
        paragraph_element.insert(0, ppr)
    ind = ppr.find(qn("w:ind"))
    if ind is None:
        ind = OxmlElement("w:ind")
        ppr.append(ind)
    ind.set(qn("w:firstLine"), "0")
    # Also remove left indent if it's excessive
    left = ind.get(qn("w:left"))
    if left and int(left) > 500:  # more than ~0.9cm
        ind.set(qn("w:left"), "0")


def add_borders_to_table(table) -> None:
    """Add full grid borders to a single table element."""
    tbl = table._tbl
    tbl_pr = tbl.find(qn("w:tblPr"))
    if tbl_pr is None:
        tbl_pr = OxmlElement("w:tblPr")
        tbl.insert(0, tbl_pr)

    # Remove existing borders
    existing = tbl_pr.find(qn("w:tblBorders"))
    if existing is not None:
        tbl_pr.remove(existing)

    # Add full grid borders
    borders = OxmlElement("w:tblBorders")
    for border_name in ("top", "left", "bottom", "right", "insideH", "insideV"):
        border = OxmlElement(f"w:{border_name}")
        border.set(qn("w:val"), "single")
        border.set(qn("w:sz"), "4")
        border.set(qn("w:space"), "0")
        border.set(qn("w:color"), "000000")
        borders.append(border)
    tbl_pr.append(borders)


def fix_table_cells(table) -> None:
    """Remove first-line indent from all cells. Bold first row (header)."""
    for ri, row in enumerate(table.rows):
        for cell in row.cells:
            for paragraph in cell.paragraphs:
                set_paragraph_indent_zero(paragraph._element)
                # Bold header row
                if ri == 0:
                    for run in paragraph.runs:
                        run.bold = True


def fix_images(doc: Document) -> None:
    """Scale oversized images and remove indents from image paragraphs."""
    for paragraph in doc.paragraphs:
        drawings = paragraph._element.findall(f".//{qn('wp:inline')}")
        if not drawings:
            continue

        # Remove paragraph indent
        set_paragraph_indent_zero(paragraph._element)

        # Center the paragraph
        ppr = paragraph._element.find(qn("w:pPr"))
        if ppr is None:
            ppr = OxmlElement("w:pPr")
            paragraph._element.insert(0, ppr)
        jc = ppr.find(qn("w:jc"))
        if jc is None:
            jc = OxmlElement("w:jc")
            ppr.append(jc)
        jc.set(qn("w:val"), "center")

        # Scale image if too wide
        for drawing in drawings:
            extent = drawing.find(qn("wp:extent"))
            if extent is None:
                continue
            cx = int(extent.get("cx", 0))
            if cx > MAX_IMAGE_WIDTH_EMU:
                ratio = MAX_IMAGE_WIDTH_EMU / cx
                new_cx = int(cx * ratio)
                new_cy = int(int(extent.get("cy", 0)) * ratio)
                extent.set("cx", str(new_cx))
                extent.set("cy", str(new_cy))

                # Also update the embedded image extent (a:ext in a:xfrm)
                for ext in drawing.iter(qn("a:ext")):
                    ecx = int(ext.get("cx", 0))
                    if ecx == cx:  # Match the original size
                        ext.set("cx", str(new_cx))
                        ext.set("cy", str(new_cy))


def number_figures(doc: Document) -> None:
    """Add 'Рисунок N —' numbering to figure captions that are not yet numbered.

    The Doc-Model renderer already emits captions like "Рисунок 1.1 — Home" —
    for those we keep the value as-is and do NOT advance the counter so our
    post-hoc numbering stays aligned with any captions the agent added by hand.
    """
    figure_num = 0
    caption_styles = ("Image Caption", "Caption", "Captioned Figure")
    for paragraph in doc.paragraphs:
        style_name = paragraph.style.name if paragraph.style else ""
        if style_name not in caption_styles:
            continue

        text = paragraph.text or ""
        if text.startswith("Рисунок ") or text.startswith("Figure "):
            set_paragraph_indent_zero(paragraph._element)
            continue

        if not text.strip():
            continue

        figure_num += 1
        prefix = f"Рисунок {figure_num} — "
        if paragraph.runs:
            paragraph.runs[0].text = prefix + paragraph.runs[0].text
        else:
            paragraph.text = prefix + text
        set_paragraph_indent_zero(paragraph._element)


def force_update_fields_on_open(doc: Document) -> None:
    """Add ``w:updateFields`` to ``word/settings.xml`` so Word recomputes the
    TOC page numbers automatically when the document is opened.

    Idempotent — existing element is flipped to ``val="true"`` instead of
    duplicated.
    """
    settings = doc.settings.element
    tag = qn("w:updateFields")
    existing = settings.find(tag)
    if existing is None:
        element = OxmlElement("w:updateFields")
        element.set(qn("w:val"), "true")
        settings.append(element)
    else:
        existing.set(qn("w:val"), "true")


def fix_toc(doc: Document) -> None:
    """Fix TOC formatting — add proper tab stops, remove indents."""
    # Content width in twips: 180mm ≈ 10205 twips
    content_width_twips = 10205
    toc_left_indents = {0: 0, 1: 480, 2: 960}  # level -> left indent twips

    body = doc.element.body

    # Find SDT (structured document tag) containing TOC
    for sdt in body.findall(qn("w:sdt")):
        sdt_content = sdt.find(qn("w:sdtContent"))
        if sdt_content is None:
            continue

        for p in sdt_content.findall(qn("w:p")):
            ppr = p.find(qn("w:pPr"))
            if ppr is None:
                ppr = OxmlElement("w:pPr")
                p.insert(0, ppr)

            # Determine TOC level from style
            ps = ppr.find(qn("w:pStyle"))
            style_val = ps.get(qn("w:val")) if ps is not None else ""
            level = -1
            if style_val == "TOC1":
                level = 0
            elif style_val == "TOC2":
                level = 1
            elif style_val == "TOC3":
                level = 2
            elif "TOC" in style_val and "Heading" not in style_val:
                level = 0

            if level >= 0:
                # Remove existing tabs
                existing_tabs = ppr.find(qn("w:tabs"))
                if existing_tabs is not None:
                    ppr.remove(existing_tabs)

                # Add right-aligned tab with dot leader
                tabs = OxmlElement("w:tabs")
                tab = OxmlElement("w:tab")
                tab.set(qn("w:val"), "right")
                tab.set(qn("w:leader"), "dot")
                tab.set(qn("w:pos"), str(content_width_twips))
                tabs.append(tab)
                ppr.append(tabs)

                # Set proper indent
                ind = ppr.find(qn("w:ind"))
                if ind is None:
                    ind = OxmlElement("w:ind")
                    ppr.append(ind)
                left = toc_left_indents.get(level, 0)
                ind.set(qn("w:left"), str(left))
                ind.set(qn("w:firstLine"), "0")
                # Remove hanging indent if present
                for attr in ("w:hanging", "w:firstLineChars"):
                    qattr = qn(attr)
                    if qattr in ind.attrib:
                        del ind.attrib[qattr]

            # Remove right/end alignment
            jc = ppr.find(qn("w:jc"))
            if jc is not None:
                val = jc.get(qn("w:val"))
                if val in ("right", "end"):
                    ppr.remove(jc)

            # firstLine=0 for TOC heading too
            if "Heading" in style_val:
                ind = ppr.find(qn("w:ind"))
                if ind is None:
                    ind = OxmlElement("w:ind")
                    ppr.append(ind)
                ind.set(qn("w:firstLine"), "0")


def fix_compact_style(doc: Document) -> None:
    """Remove first-line indent from Compact style (used in tables and lists)."""
    for style_name in ("Compact", "First Paragraph", "Body Text"):
        if style_name not in doc.styles:
            continue
        style = doc.styles[style_name]
        style_ppr = style.element.find(qn("w:pPr"))
        if style_ppr is not None:
            ind = style_ppr.find(qn("w:ind"))
            if ind is not None:
                for attr in ("w:firstLine", "w:firstLineChars"):
                    qattr = qn(attr)
                    if qattr in ind.attrib:
                        del ind.attrib[qattr]
                ind.set(qn("w:firstLine"), "0")
            else:
                ind = OxmlElement("w:ind")
                ind.set(qn("w:firstLine"), "0")
                style_ppr.append(ind)


def ensure_toc_styles(doc: Document, font_name: str, body_size: Pt) -> None:
    """Ensure TOC 1/2/3 styles exist with right tab stop and dot leader.

    When Word updates the TOC field, it uses these styles. If they're
    missing or misconfigured, the TOC looks broken.
    """
    from docx.enum.style import WD_STYLE_TYPE

    content_width_twips = 10205
    toc_configs = [
        ("TOC 1", 0),       # no indent
        ("TOC 2", 480),     # ~8mm indent
        ("TOC 3", 960),     # ~16mm indent
    ]

    for style_name, left_indent in toc_configs:
        # Get or create the style
        if style_name in doc.styles:
            style = doc.styles[style_name]
        else:
            style = doc.styles.add_style(style_name, WD_STYLE_TYPE.PARAGRAPH)
            style.base_style = doc.styles["Normal"]

        style.font.name = font_name
        style.font.size = body_size
        style.paragraph_format.first_line_indent = None
        style.paragraph_format.alignment = WD_ALIGN_PARAGRAPH.LEFT
        style.paragraph_format.space_before = Pt(2)
        style.paragraph_format.space_after = Pt(2)

        # Set font on all faces
        rpr = style.element.get_or_add_rPr()
        rfonts = rpr.find(qn("w:rFonts"))
        if rfonts is None:
            rfonts = OxmlElement("w:rFonts")
            rpr.insert(0, rfonts)
        for attr in ("w:ascii", "w:hAnsi", "w:eastAsia", "w:cs"):
            rfonts.set(qn(attr), font_name)
        for theme_attr in ("w:asciiTheme", "w:hAnsiTheme", "w:eastAsiaTheme", "w:cstheme"):
            qattr = qn(theme_attr)
            if qattr in rfonts.attrib:
                del rfonts.attrib[qattr]

        # Configure pPr
        style_ppr = style.element.find(qn("w:pPr"))
        if style_ppr is None:
            style_ppr = OxmlElement("w:pPr")
            style.element.append(style_ppr)

        # Remove existing tabs and ind
        for tag in ("w:tabs", "w:ind"):
            existing = style_ppr.find(qn(tag))
            if existing is not None:
                style_ppr.remove(existing)

        # Add right tab with dot leader
        tabs = OxmlElement("w:tabs")
        tab = OxmlElement("w:tab")
        tab.set(qn("w:val"), "right")
        tab.set(qn("w:leader"), "dot")
        tab.set(qn("w:pos"), str(content_width_twips))
        tabs.append(tab)
        style_ppr.append(tabs)

        # Set indent
        ind = OxmlElement("w:ind")
        ind.set(qn("w:left"), str(left_indent))
        ind.set(qn("w:firstLine"), "0")
        style_ppr.append(ind)


def fix_title_font(doc: Document, font_name: str) -> None:
    """Ensure Title style uses the correct font."""
    if "Title" not in doc.styles:
        return
    title = doc.styles["Title"]
    title.font.name = font_name
    title.font.bold = True
    title.font.size = Pt(18)
    rpr = title.element.get_or_add_rPr()
    rfonts = rpr.find(qn("w:rFonts"))
    if rfonts is None:
        rfonts = rpr.makeelement(qn("w:rFonts"), {})
        rpr.insert(0, rfonts)
    for attr in ("w:ascii", "w:hAnsi", "w:eastAsia", "w:cs"):
        rfonts.set(qn(attr), font_name)
    for theme_attr in ("w:asciiTheme", "w:hAnsiTheme", "w:eastAsiaTheme", "w:cstheme"):
        qattr = qn(theme_attr)
        if qattr in rfonts.attrib:
            del rfonts.attrib[qattr]


def replace_emoji(doc: Document) -> None:
    """Replace emoji/checkbox characters with text equivalents."""
    replacements = {
        "\u2611": "[V]",    # ☑ ballot box with check
        "\u2610": "[ ]",    # ☐ ballot box
        "\u2612": "[X]",    # ☒ ballot box with X
        "\u2713": "[V]",    # ✓ check mark
        "\u2714": "[V]",    # ✔ heavy check mark
        "\u2717": "[X]",    # ✗ ballot X
        "\u2718": "[X]",    # ✘ heavy ballot X
        "\u274c": "[X]",    # ❌ cross mark
        "\u2705": "[V]",    # ✅ white heavy check mark
        "\u26a0": "[!]",    # ⚠ warning sign
        "\U0001f512": "",   # 🔒 lock
        "\U0001f513": "",   # 🔓 unlock
    }
    for paragraph in doc.paragraphs:
        for run in paragraph.runs:
            if run.text:
                for emoji, replacement in replacements.items():
                    if emoji in run.text:
                        run.text = run.text.replace(emoji, replacement)

    # Also check table cells
    for table in doc.tables:
        for row in table.rows:
            for cell in row.cells:
                for paragraph in cell.paragraphs:
                    for run in paragraph.runs:
                        if run.text:
                            for emoji, replacement in replacements.items():
                                if emoji in run.text:
                                    run.text = run.text.replace(emoji, replacement)


def add_body_text_indent(doc: Document) -> None:
    """Add 1.25cm first-line indent to body text paragraphs only.

    We do NOT set this on the Normal style (it bleeds into TOC, tables,
    figures). Instead we apply it per-paragraph to text-only paragraphs.
    """
    skip_styles = {
        "Title", "Subtitle",
        "Heading 1", "Heading 2", "Heading 3", "Heading 4",
        "TOC Heading", "TOC 1", "TOC 2", "TOC 3",
        "Caption", "Image Caption", "Table Caption",
        "Figure", "Captioned Figure",
        "Source Code",
        "Header", "Footer",
    }
    indent_val = "709"  # 1.25cm in twips

    for paragraph in doc.paragraphs:
        style_name = paragraph.style.name if paragraph.style else ""

        # Skip non-body styles
        if style_name in skip_styles:
            continue

        # Skip paragraphs with images
        has_image = bool(paragraph._element.findall(f".//{qn('wp:inline')}") or
                        paragraph._element.findall(f".//{qn('wp:anchor')}"))
        if has_image:
            continue

        # Skip empty paragraphs
        if not paragraph.text.strip():
            continue

        # Skip list items (they have their own indent)
        ppr = paragraph._element.find(qn("w:pPr"))
        if ppr is not None:
            num_pr = ppr.find(qn("w:numPr"))
            if num_pr is not None:
                continue

        # Apply first-line indent
        if ppr is None:
            ppr = OxmlElement("w:pPr")
            paragraph._element.insert(0, ppr)
        ind = ppr.find(qn("w:ind"))
        if ind is None:
            ind = OxmlElement("w:ind")
            ppr.append(ind)
        # Only set if not already explicitly set to 0 (e.g., by fix_table_cells)
        current = ind.get(qn("w:firstLine"))
        if current != "0":
            ind.set(qn("w:firstLine"), indent_val)


def main() -> None:
    if len(sys.argv) < 2:
        print(f"Usage: {sys.argv[0]} <input.docx> [--font 'Times New Roman']")
        sys.exit(1)

    docx_path = Path(sys.argv[1])
    font_name = "Times New Roman"
    if "--font" in sys.argv:
        idx = sys.argv.index("--font")
        if idx + 1 < len(sys.argv):
            font_name = sys.argv[idx + 1]

    doc = Document(str(docx_path))

    # Fix styles first (affects all paragraphs)
    fix_compact_style(doc)
    fix_title_font(doc, font_name)
    ensure_toc_styles(doc, font_name, Pt(14) if font_name == "Times New Roman" else Pt(12))

    # Fix TOC
    fix_toc(doc)

    # Fix tables
    for table in doc.tables:
        add_borders_to_table(table)
        fix_table_cells(table)

    # Fix images
    fix_images(doc)

    # Number figures
    number_figures(doc)

    # Replace emoji
    replace_emoji(doc)

    # Force Word to refresh TOC page numbers on open
    force_update_fields_on_open(doc)

    # Add paragraph indent to body text only (strict GOST mode)
    if font_name == "Times New Roman":
        add_body_text_indent(doc)

    # Final safety net — scan the materialised DOCX for placeholder text
    # that slipped through the pre-pandoc lint (e.g., pandoc rewriting
    # `-->` to `–>` after lint ran). Findings are reported on stderr so
    # callers can surface them without failing the DOCX itself, since by
    # this point the file is already written.
    findings = scan_for_placeholders(doc)
    if findings:
        print(
            f"[postprocess] {len(findings)} placeholder leak(s) in {docx_path.name}:",
            file=sys.stderr,
        )
        for context, tag, snippet in findings:
            print(f"  - [{tag}] {context}: {snippet}", file=sys.stderr)

    doc.save(str(docx_path))
    print(f"Post-processed: {docx_path}")


if __name__ == "__main__":
    main()
