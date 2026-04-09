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

import sys
from pathlib import Path

from docx import Document
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Emu, Mm, Pt


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
    """Remove first-line indent from all paragraphs in table cells."""
    for row in table.rows:
        for cell in row.cells:
            for paragraph in cell.paragraphs:
                set_paragraph_indent_zero(paragraph._element)


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
    """Add 'Рисунок N —' numbering to figure captions."""
    figure_num = 0
    for paragraph in doc.paragraphs:
        style_name = paragraph.style.name if paragraph.style else ""

        # Detect image caption: paragraph right after an image, or Caption/Figure style
        if style_name in ("Image Caption", "Caption", "Captioned Figure"):
            if paragraph.text and not paragraph.text.startswith("Рисунок"):
                figure_num += 1
                # Prepend numbering
                if paragraph.runs:
                    paragraph.runs[0].text = f"Рисунок {figure_num} — {paragraph.runs[0].text}"
                else:
                    paragraph.text = f"Рисунок {figure_num} — {paragraph.text}"
                set_paragraph_indent_zero(paragraph._element)
                continue

        # Also check for paragraphs that contain ONLY text (no images) right after
        # an image paragraph — pandoc puts alt text as separate paragraph
        has_image = bool(paragraph._element.findall(f".//{qn('wp:inline')}"))
        if has_image:
            # The next paragraph might be the caption
            pass


def fix_toc(doc: Document) -> None:
    """Fix TOC formatting — remove indents, fix alignment."""
    body = doc.element.body

    # Find SDT (structured document tag) containing TOC
    for sdt in body.findall(qn("w:sdt")):
        sdt_content = sdt.find(qn("w:sdtContent"))
        if sdt_content is None:
            continue

        for p in sdt_content.findall(qn("w:p")):
            ppr = p.find(qn("w:pPr"))
            if ppr is None:
                continue

            # Remove first-line indent from TOC entries
            ind = ppr.find(qn("w:ind"))
            if ind is not None:
                # Remove first line indent
                for attr in ("w:firstLine", "w:firstLineChars"):
                    qattr = qn(attr)
                    if qattr in ind.attrib:
                        del ind.attrib[qattr]
            else:
                # Add explicit ind with firstLine=0
                ind = OxmlElement("w:ind")
                ind.set(qn("w:firstLine"), "0")
                ppr.append(ind)

            # Ensure left alignment (remove right alignment if set)
            jc = ppr.find(qn("w:jc"))
            if jc is not None:
                val = jc.get(qn("w:val"))
                if val in ("right", "end"):
                    ppr.remove(jc)

    # Also fix TOC styles in the document
    for style_name in ("TOC Heading", "TOC 1", "TOC 2", "TOC 3"):
        if style_name in doc.styles:
            style = doc.styles[style_name]
            style.paragraph_format.first_line_indent = None
            # Force indent to 0 on style element
            style_ppr = style.element.find(qn("w:pPr"))
            if style_ppr is not None:
                ind = style_ppr.find(qn("w:ind"))
                if ind is not None:
                    for attr in ("w:firstLine", "w:firstLineChars"):
                        qattr = qn(attr)
                        if qattr in ind.attrib:
                            del ind.attrib[qattr]


def fix_compact_style(doc: Document) -> None:
    """Remove first-line indent from Compact style (used in tables and lists)."""
    for style_name in ("Compact", "First Paragraph", "Body Text"):
        if style_name not in doc.styles:
            continue
        style = doc.styles[style_name]
        # Remove first-line indent from style definition
        style_ppr = style.element.find(qn("w:pPr"))
        if style_ppr is not None:
            ind = style_ppr.find(qn("w:ind"))
            if ind is not None:
                for attr in ("w:firstLine", "w:firstLineChars"):
                    qattr = qn(attr)
                    if qattr in ind.attrib:
                        del ind.attrib[qattr]
                # Set explicit 0
                ind.set(qn("w:firstLine"), "0")
            else:
                ind = OxmlElement("w:ind")
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

    doc.save(str(docx_path))
    print(f"Post-processed: {docx_path}")


if __name__ == "__main__":
    main()
