#!/usr/bin/env bash
# Side-by-side sheets of the screenshots and the reference photographs they are compared with
# (docs/reference.md), written into docs/reference/ (gitignored, like the photographs themselves).
# Needs ImageMagick.
#
#   scripts/compare.sh [docs/shots]
set -euo pipefail
shots=${1:-docs/shots}
ref=docs/reference
declare -A match=(
  [noon]="01-noon-lower-manhattan-2021 02-noon-whole-island-2021 03-day-haze-long-view-2012"
  [golden]="04-golden-evening-2011 05-golden-dusk-lower-manhattan-2018 06-dusk-from-liberty-2018"
  [night]="07-night-southern-end-2010 08-night-from-plane-2016 09-night-midtown-2023"
  [rain]="10-rain-across-bay 11-rain-shaft-across-bay 12-overcast-helicopter-2010"
)
for k in noon golden night rain; do
  files=("$shots/$k.png")
  for r in ${match[$k]}; do files+=("$ref/$r.jpg"); done
  montage "${files[@]}" -tile 2x2 -geometry 960x540+6+6 -background '#111' "$ref/compare-$k.jpg"
  echo "$ref/compare-$k.jpg"
done
