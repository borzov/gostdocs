#!/usr/bin/env python3
"""Modify pandoc's default reference.docx to apply GOST-compliant styles.

IMPORTANT: This script expects that pandoc's default reference.docx already
exists at <output_dir>/reference-strict.docx and reference-lite.docx.
Generate them first with: pandoc --print-default-data-file reference.docx > file.docx

Usage:
    python3 setup-reference-docx.py <output_dir>
"""

from __future__ import annotations

import sys
from pathlib import Path

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_LINE_SPACING
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Mm, Pt


def set_font_all_faces(element: object, font_name: str) -> None:
    """Set font name for all faces and REMOVE theme overrides."""
    rpr = element.get_or_add_rPr()  # type: ignore[attr-defined]
    rfonts = rpr.find(qn("w:rFonts"))
    if rfonts is None:
        rfonts = rpr.makeelement(qn("w:rFonts"), {})
        rpr.insert(0, rfonts)
    # Set explicit font names
    for attr in ("w:ascii", "w:hAnsi", "w:eastAsia", "w:cs"):
        rfonts.set(qn(attr), font_name)
    # REMOVE theme attributes — they override explicit fonts in Word
    for theme_attr in ("w:asciiTheme", "w:hAnsiTheme", "w:eastAsiaTheme", "w:cstheme"):
        qname = qn(theme_attr)
        if qname in rfonts.attrib:
            del rfonts.attrib[qname]


def set_table_borders(doc: Document) -> None:
    """Configure Table style with full grid borders."""
    # Find or work with the default Table style
    for style in doc.styles:
        if style.name in ("Table", "Table Grid", "Table Normal"):
            style_elem = style.element

            # Create tblPr if not exists
            tbl_pr = style_elem.find(qn("w:tblPr"))
            if tbl_pr is None:
                tbl_pr = OxmlElement("w:tblPr")
                style_elem.append(tbl_pr)

            # Remove existing borders
            existing = tbl_pr.find(qn("w:tblBorders"))
            if existing is not None:
                tbl_pr.remove(existing)

            # Add full grid borders
            borders = OxmlElement("w:tblBorders")
            for border_name in ("top", "left", "bottom", "right", "insideH", "insideV"):
                border = OxmlElement(f"w:{border_name}")
                border.set(qn("w:val"), "single")
                border.set(qn("w:sz"), "4")  # 0.5pt
                border.set(qn("w:space"), "0")
                border.set(qn("w:color"), "000000")
                borders.append(border)
            tbl_pr.append(borders)

            # Remove cell margins/padding that cause indents
            existing_margins = tbl_pr.find(qn("w:tblCellMar"))
            if existing_margins is not None:
                tbl_pr.remove(existing_margins)

            cell_mar = OxmlElement("w:tblCellMar")
            for side in ("top", "left", "bottom", "right"):
                margin = OxmlElement(f"w:{side}")
                margin.set(qn("w:w"), "28")  # ~0.5mm minimal padding
                margin.set(qn("w:type"), "dxa")
                cell_mar.append(margin)
            tbl_pr.append(cell_mar)


def configure_styles(doc: Document, strict: bool = True) -> Document:
    """Configure document styles for GOST compliance."""
    font_name = "Times New Roman" if strict else "Arial"
    body_size = Pt(14) if strict else Pt(12)
    line_spacing = 1.5 if strict else 1.15

    # --- Page setup ---
    for section in doc.sections:
        section.left_margin = Mm(20)
        section.right_margin = Mm(10)
        section.top_margin = Mm(20)
        section.bottom_margin = Mm(20)
        section.page_width = Mm(210)
        section.page_height = Mm(297)

    # --- Normal (base) ---
    normal = doc.styles["Normal"]
    normal.font.name = font_name
    normal.font.size = body_size
    normal.paragraph_format.line_spacing_rule = WD_LINE_SPACING.MULTIPLE
    normal.paragraph_format.line_spacing = line_spacing
    normal.paragraph_format.space_after = Pt(0)
    normal.paragraph_format.space_before = Pt(0)
    normal.paragraph_format.first_line_indent = Cm(1.25) if strict else None
    set_font_all_faces(normal.element, font_name)

    # --- Headings ---
    heading_configs: list[tuple[str, Pt, bool]] = [
        ("Heading 1", Pt(16) if strict else Pt(16), True),
        ("Heading 2", Pt(15) if strict else Pt(14), True),
        ("Heading 3", Pt(14) if strict else Pt(13), True),
        ("Heading 4", Pt(14) if strict else Pt(12), False),
    ]
    for name, size, bold in heading_configs:
        if name not in doc.styles:
            continue
        style = doc.styles[name]
        style.font.name = font_name
        style.font.size = size
        style.font.bold = bold
        style.font.color.rgb = None
        # Remove theme color
        rpr = style.element.get_or_add_rPr()
        color_elem = rpr.find(qn("w:color"))
        if color_elem is not None:
            for attr in ("w:themeColor", "w:themeShade", "w:themeTint"):
                qattr = qn(attr)
                if qattr in color_elem.attrib:
                    del color_elem.attrib[qattr]
        pf = style.paragraph_format
        pf.space_before = Pt(18) if name == "Heading 1" else Pt(12)
        pf.space_after = Pt(6)
        pf.first_line_indent = None
        pf.alignment = WD_ALIGN_PARAGRAPH.LEFT
        pf.keep_with_next = True
        set_font_all_faces(style.element, font_name)

    # --- Body Text styles (pandoc uses these for regular paragraphs) ---
    for body_style_name in ("Body Text", "First Paragraph", "Compact"):
        if body_style_name not in doc.styles:
            continue
        bs = doc.styles[body_style_name]
        bs.font.name = font_name
        bs.font.size = body_size
        bs.paragraph_format.line_spacing_rule = WD_LINE_SPACING.MULTIPLE
        bs.paragraph_format.line_spacing = line_spacing
        bs.paragraph_format.space_after = Pt(0)
        bs.paragraph_format.first_line_indent = Cm(1.25) if strict else None
        set_font_all_faces(bs.element, font_name)

    # --- TOC styles — LEFT aligned ---
    for toc_name in ("TOC Heading", "TOC 1", "TOC 2", "TOC 3"):
        if toc_name not in doc.styles:
            continue
        toc = doc.styles[toc_name]
        toc.font.name = font_name
        toc.paragraph_format.alignment = WD_ALIGN_PARAGRAPH.LEFT
        toc.paragraph_format.first_line_indent = None
        if toc_name == "TOC Heading":
            toc.font.size = Pt(16) if strict else Pt(14)
            toc.font.bold = True
        else:
            toc.font.size = body_size
        set_font_all_faces(toc.element, font_name)

    # --- Figure / Image styles — NO indent ---
    for fig_name in ("Figure", "Captioned Figure", "Image Caption"):
        if fig_name in doc.styles:
            fs = doc.styles[fig_name]
            fs.paragraph_format.first_line_indent = None
            fs.paragraph_format.left_indent = None
            fs.paragraph_format.alignment = WD_ALIGN_PARAGRAPH.CENTER
            if hasattr(fs, 'font'):
                fs.font.name = font_name
                set_font_all_faces(fs.element, font_name)

    # --- Caption style ---
    if "Caption" in doc.styles:
        cap = doc.styles["Caption"]
        cap.font.name = font_name
        cap.font.size = Pt(12) if strict else Pt(11)
        cap.font.italic = True
        cap.paragraph_format.alignment = WD_ALIGN_PARAGRAPH.CENTER
        cap.paragraph_format.first_line_indent = None
        cap.paragraph_format.left_indent = None
        set_font_all_faces(cap.element, font_name)

    # --- Table Caption ---
    if "Table Caption" in doc.styles:
        tc = doc.styles["Table Caption"]
        tc.font.name = font_name
        tc.font.size = Pt(12) if strict else Pt(11)
        tc.font.italic = True
        tc.paragraph_format.alignment = WD_ALIGN_PARAGRAPH.LEFT
        tc.paragraph_format.first_line_indent = None
        set_font_all_faces(tc.element, font_name)

    # --- Table Grid ---
    if "Table" in doc.styles:
        tg = doc.styles["Table"]
        if hasattr(tg, 'font'):
            tg.font.name = font_name
            tg.font.size = Pt(12) if strict else Pt(11)

    # --- Code (Verbatim Char / Source Code) ---
    for code_name in ("Source Code", "Verbatim Char"):
        if code_name in doc.styles:
            cs = doc.styles[code_name]
            cs.font.name = "Courier New"
            cs.font.size = Pt(10)

    # --- Block Text (blockquotes/notes) ---
    if "Block Text" in doc.styles:
        bt = doc.styles["Block Text"]
        bt.font.name = font_name
        bt.font.size = Pt(12) if strict else Pt(11)
        bt.font.italic = True
        bt.paragraph_format.left_indent = Cm(1)
        bt.paragraph_format.first_line_indent = None
        set_font_all_faces(bt.element, font_name)

    # --- Footer ---
    if "Footer" in doc.styles:
        ft = doc.styles["Footer"]
        ft.font.name = font_name
        ft.font.size = Pt(12) if strict else Pt(10)
        ft.paragraph_format.alignment = WD_ALIGN_PARAGRAPH.RIGHT
        set_font_all_faces(ft.element, font_name)

    # --- List styles ---
    for list_name in ("List Bullet", "List Number", "List Paragraph"):
        if list_name not in doc.styles:
            continue
        ls = doc.styles[list_name]
        ls.font.name = font_name
        ls.font.size = body_size
        ls.paragraph_format.first_line_indent = None
        set_font_all_faces(ls.element, font_name)

    # --- Definition styles ---
    for def_name in ("Definition Term", "Definition"):
        if def_name not in doc.styles:
            continue
        ds = doc.styles[def_name]
        ds.font.name = font_name
        ds.font.size = body_size
        set_font_all_faces(ds.element, font_name)

    # --- Table borders ---
    set_table_borders(doc)

    return doc


def add_page_numbers(doc: Document) -> None:
    """Add page numbers to footer (bottom right)."""
    for section in doc.sections:
        footer = section.footer
        footer.is_linked_to_previous = False
        p = footer.paragraphs[0] if footer.paragraphs else footer.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.RIGHT

        run = p.add_run()
        fld_begin = run.element.makeelement(
            qn("w:fldChar"), {qn("w:fldCharType"): "begin"}
        )
        run.element.append(fld_begin)

        run2 = p.add_run()
        instr = run2.element.makeelement(
            qn("w:instrText"), {qn("xml:space"): "preserve"}
        )
        instr.text = " PAGE "
        run2.element.append(instr)

        run3 = p.add_run()
        fld_end = run3.element.makeelement(
            qn("w:fldChar"), {qn("w:fldCharType"): "end"}
        )
        run3.element.append(fld_end)


def main() -> None:
    if len(sys.argv) < 2:
        print(f"Usage: {sys.argv[0]} <output_dir>")
        sys.exit(1)

    output_dir = Path(sys.argv[1])

    for mode, filename in [("strict", "reference-strict.docx"), ("lite", "reference-lite.docx")]:
        path = output_dir / filename
        if not path.exists():
            print(f"Generating base {filename} from pandoc defaults...")
            import subprocess
            result = subprocess.run(
                ["pandoc", "--print-default-data-file", "reference.docx"],
                capture_output=True,
            )
            path.write_bytes(result.stdout)

        doc = Document(str(path))
        doc = configure_styles(doc, strict=(mode == "strict"))
        add_page_numbers(doc)

        # Remove any sample paragraphs from body
        for p in doc.paragraphs:
            if p.text.strip() in ("", "Sample text"):
                p._element.getparent().remove(p._element)

        doc.save(str(path))
        print(f"Updated: {path}")


if __name__ == "__main__":
    main()
