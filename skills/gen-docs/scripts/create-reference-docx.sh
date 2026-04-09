#!/bin/bash
# Create GOST-compliant reference.docx files for pandoc
# Uses pandoc to generate a base, then python-docx to tune styles
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TEMPLATES_DIR="$SCRIPT_DIR/../templates"

echo "Creating reference DOCX files..."

# Step 1: Generate base reference from pandoc defaults
pandoc --print-default-data-file reference.docx > "$TEMPLATES_DIR/reference-strict.docx"
cp "$TEMPLATES_DIR/reference-strict.docx" "$TEMPLATES_DIR/reference-lite.docx"

# Step 2: Apply GOST styles via python-docx
python3 "$SCRIPT_DIR/setup-reference-docx.py" "$TEMPLATES_DIR"

echo "Done:"
echo "  $TEMPLATES_DIR/reference-strict.docx"
echo "  $TEMPLATES_DIR/reference-lite.docx"
