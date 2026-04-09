#!/usr/bin/env python3
"""Post-process pandoc-generated DOCX to fix formatting issues.

Fixes:
- Add full grid borders to all tables
- Remove first-line indent from table cells
- Remove first-line indent from figure/image paragraphs
- Fix Title style font

Usage:
    python3 postprocess-docx.py <input.docx> [--font "Times New Roman"]
"""

from __future__ import annotations

import sys
from pathlib import Path

from docx import Document
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Pt


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


def fix_table_cell_indents(table) -> None:
    """Remove first-line indent from all paragraphs in table cells."""
    for row in table.rows:
        for cell in row.cells:
            for paragraph in cell.paragraphs:
                ppr = paragraph._element.find(qn("w:pPr"))
                if ppr is not None:
                    ind = ppr.find(qn("w:ind"))
                    if ind is not None:
                        # Remove first line indent
                        for attr in ("w:firstLine", "w:firstLineChars"):
                            qattr = qn(attr)
                            if qattr in ind.attrib:
                                del ind.attrib[qattr]


def fix_figure_indents(doc: Document) -> None:
    """Remove indent from figure/image paragraphs."""
    for paragraph in doc.paragraphs:
        style_name = paragraph.style.name if paragraph.style else ""
        # Check if paragraph contains an image
        has_image = bool(paragraph._element.findall(f".//{qn('wp:inline')}") or
                        paragraph._element.findall(f".//{qn('wp:anchor')}"))

        if has_image or style_name in ("Figure", "Captioned Figure", "Image Caption", "Caption"):
            ppr = paragraph._element.find(qn("w:pPr"))
            if ppr is not None:
                ind = ppr.find(qn("w:ind"))
                if ind is not None:
                    for attr in ("w:firstLine", "w:firstLineChars", "w:left", "w:start"):
                        qattr = qn(attr)
                        if qattr in ind.attrib:
                            del ind.attrib[qattr]
                # Center images
                jc = ppr.find(qn("w:jc"))
                if jc is None:
                    jc = OxmlElement("w:jc")
                    ppr.append(jc)
                jc.set(qn("w:val"), "center")


def fix_title_font(doc: Document, font_name: str) -> None:
    """Ensure Title style uses the correct font."""
    if "Title" in doc.styles:
        title = doc.styles["Title"]
        title.font.name = font_name
        title.font.bold = True
        title.font.size = Pt(18)
        # Remove theme overrides
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

    # Fix tables
    for table in doc.tables:
        add_borders_to_table(table)
        fix_table_cell_indents(table)

    # Fix figures
    fix_figure_indents(doc)

    # Fix title font
    fix_title_font(doc, font_name)

    doc.save(str(docx_path))
    print(f"Post-processed: {docx_path}")


if __name__ == "__main__":
    main()
