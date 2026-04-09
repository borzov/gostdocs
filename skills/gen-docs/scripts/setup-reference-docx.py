#!/usr/bin/env python3
"""Generate reference.docx files for pandoc with GOST-compliant styles.

Creates two reference documents:
- reference-strict.docx: Full GOST 2.105 compliance (Times New Roman 14pt, strict margins)
- reference-lite.docx: GOST structure with relaxed formatting

Usage:
    python3 setup-reference-docx.py <output_dir>
"""

import sys
from pathlib import Path
from docx import Document
from docx.shared import Pt, Mm, Cm
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_LINE_SPACING
from docx.enum.style import WD_STYLE_TYPE
from docx.oxml.ns import qn


def configure_styles(doc, strict=True):
    """Configure document styles for GOST compliance."""
    font_name = "Times New Roman" if strict else "Arial"
    font_size = Pt(14) if strict else Pt(12)
    line_spacing = 1.5 if strict else 1.15

    # Page setup for all sections
    for section in doc.sections:
        section.left_margin = Mm(20)
        section.right_margin = Mm(10)
        section.top_margin = Mm(20)
        section.bottom_margin = Mm(20)
        section.page_width = Mm(210)
        section.page_height = Mm(297)

    # Normal style (base for all text)
    style = doc.styles["Normal"]
    style.font.name = font_name
    style.font.size = font_size
    style.paragraph_format.line_spacing_rule = WD_LINE_SPACING.MULTIPLE
    style.paragraph_format.line_spacing = line_spacing
    style.paragraph_format.space_after = Pt(0)
    style.paragraph_format.space_before = Pt(0)
    style.paragraph_format.first_line_indent = Cm(1.25) if strict else None
    # Set East Asian font
    rpr = style.element.get_or_add_rPr()
    rfonts = rpr.find(qn("w:rFonts"))
    if rfonts is None:
        rfonts = rpr.makeelement(qn("w:rFonts"), {})
        rpr.insert(0, rfonts)
    rfonts.set(qn("w:eastAsia"), font_name)
    rfonts.set(qn("w:cs"), font_name)

    # Heading styles
    heading_configs = [
        ("Heading 1", Pt(16) if strict else Pt(16), True, True),
        ("Heading 2", Pt(15) if strict else Pt(14), True, True),
        ("Heading 3", Pt(14) if strict else Pt(13), True, False),
        ("Heading 4", Pt(14) if strict else Pt(12), False, False),
    ]

    for name, size, bold, page_break in heading_configs:
        if name in doc.styles:
            style = doc.styles[name]
        else:
            continue
        style.font.name = font_name
        style.font.size = size
        style.font.bold = bold
        style.font.color.rgb = None  # Black
        style.paragraph_format.space_before = Pt(12)
        style.paragraph_format.space_after = Pt(6)
        style.paragraph_format.first_line_indent = None
        style.paragraph_format.alignment = WD_ALIGN_PARAGRAPH.LEFT
        style.paragraph_format.keep_with_next = True
        # Set East Asian font for headings
        rpr = style.element.get_or_add_rPr()
        rfonts = rpr.find(qn("w:rFonts"))
        if rfonts is None:
            rfonts = rpr.makeelement(qn("w:rFonts"), {})
            rpr.insert(0, rfonts)
        rfonts.set(qn("w:eastAsia"), font_name)
        rfonts.set(qn("w:cs"), font_name)

    # TOC heading
    if "TOC Heading" in doc.styles:
        toc_style = doc.styles["TOC Heading"]
        toc_style.font.name = font_name
        toc_style.font.size = Pt(16) if strict else Pt(14)
        toc_style.font.bold = True

    # Table style
    if "Table Grid" in doc.styles:
        table_style = doc.styles["Table Grid"]
        table_style.font.name = font_name
        table_style.font.size = Pt(12) if strict else Pt(11)

    # Code style (Source Code / Verbatim Char)
    for code_style_name in ["Source Code", "Verbatim Char"]:
        if code_style_name in doc.styles:
            code_style = doc.styles[code_style_name]
            code_style.font.name = "Courier New"
            code_style.font.size = Pt(10)

    # Caption style for figures and tables
    if "Caption" in doc.styles:
        caption_style = doc.styles["Caption"]
        caption_style.font.name = font_name
        caption_style.font.size = Pt(12) if strict else Pt(11)
        caption_style.font.italic = True
        caption_style.paragraph_format.alignment = WD_ALIGN_PARAGRAPH.CENTER

    # Image paragraph style
    if "Image Caption" not in [s.name for s in doc.styles]:
        try:
            img_style = doc.styles.add_style("Image Caption", WD_STYLE_TYPE.PARAGRAPH)
            img_style.font.name = font_name
            img_style.font.size = Pt(12)
            img_style.font.italic = True
            img_style.paragraph_format.alignment = WD_ALIGN_PARAGRAPH.CENTER
            img_style.paragraph_format.space_before = Pt(6)
            img_style.paragraph_format.space_after = Pt(12)
        except Exception:
            pass

    # Block quote / Note style
    if "Block Text" in doc.styles:
        block_style = doc.styles["Block Text"]
        block_style.font.name = font_name
        block_style.font.size = Pt(12) if strict else Pt(11)
        block_style.font.italic = True
        block_style.paragraph_format.left_indent = Cm(1)

    # Footer style for page numbers
    if "Footer" in doc.styles:
        footer_style = doc.styles["Footer"]
        footer_style.font.name = font_name
        footer_style.font.size = Pt(12) if strict else Pt(10)
        footer_style.paragraph_format.alignment = WD_ALIGN_PARAGRAPH.RIGHT

    return doc


def add_page_numbers(doc):
    """Add page numbers to footer (bottom right)."""
    for section in doc.sections:
        footer = section.footer
        footer.is_linked_to_previous = False
        p = footer.paragraphs[0] if footer.paragraphs else footer.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.RIGHT

        # Add PAGE field
        run = p.add_run()
        fld_char_begin = run.element.makeelement(qn("w:fldChar"), {qn("w:fldCharType"): "begin"})
        run.element.append(fld_char_begin)

        run2 = p.add_run()
        instr = run2.element.makeelement(qn("w:instrText"), {qn("xml:space"): "preserve"})
        instr.text = " PAGE "
        run2.element.append(instr)

        run3 = p.add_run()
        fld_char_end = run3.element.makeelement(qn("w:fldChar"), {qn("w:fldCharType"): "end"})
        run3.element.append(fld_char_end)


def main():
    if len(sys.argv) < 2:
        print(f"Usage: {sys.argv[0]} <output_dir>")
        sys.exit(1)

    output_dir = Path(sys.argv[1])
    output_dir.mkdir(parents=True, exist_ok=True)

    # Generate strict reference
    doc_strict = Document()
    doc_strict = configure_styles(doc_strict, strict=True)
    add_page_numbers(doc_strict)
    # Add a sample paragraph so pandoc can read styles
    doc_strict.add_paragraph("Sample text", style="Normal")
    strict_path = output_dir / "reference-strict.docx"
    doc_strict.save(str(strict_path))
    print(f"Created: {strict_path}")

    # Generate lite reference
    doc_lite = Document()
    doc_lite = configure_styles(doc_lite, strict=False)
    add_page_numbers(doc_lite)
    doc_lite.add_paragraph("Sample text", style="Normal")
    lite_path = output_dir / "reference-lite.docx"
    doc_lite.save(str(lite_path))
    print(f"Created: {lite_path}")


if __name__ == "__main__":
    main()
