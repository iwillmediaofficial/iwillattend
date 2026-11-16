#!/usr/bin/env bash
# Rebuilds the brochure HTML and exports both PDFs with Microsoft Edge (Git Bash on Windows).
# Usage: bash brochure/make-pdf.sh           -> PDFs
#        bash brochure/make-pdf.sh shots DIR -> also one PNG per page into DIR (for checking)
set -e
cd "$(dirname "$0")"
EDGE="/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"
node build.mjs
HERE_W="$(cygpath -w "$PWD")"
HERE_U="file:///$(cygpath -m "$PWD")"
for f in IWILL-Attend-Brochure IWILL-Attend-Brochure-Short; do
  "$EDGE" --headless=new --disable-gpu --no-pdf-header-footer "--print-to-pdf=${HERE_W}\\${f}.pdf" "${HERE_U}/${f}.html" >/dev/null 2>&1
  echo "made ${f}.pdf"
done
if [ "$1" = "shots" ]; then
  OUT_W="$(cygpath -w "$2")"
  shot() { "$EDGE" --headless=new --disable-gpu --hide-scrollbars --window-size=794,1123 "--screenshot=${OUT_W}\\$1-$2.png" "${HERE_U}/$1.html?p=$2" >/dev/null 2>&1; }
  for p in 1 2 3 4 5 6 7 8; do shot IWILL-Attend-Brochure $p; done
  for p in 1 2 3 4; do shot IWILL-Attend-Brochure-Short $p; done
  echo "page images in $2"
fi
