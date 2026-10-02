#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

version="$(node -e "console.log(JSON.parse(require('fs').readFileSync('manifest.json', 'utf8')).version)")"
out="dist/tfav-extension-v${version}"
zip_file="dist/tfav-extension-v${version}.zip"

if [[ "${out}" =~ ^dist/tfav-extension-v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  rm -rf "${out}"
  rm -f "${zip_file}"
fi

mkdir -p "${out}/lib" "${out}/css" "${out}/ui"

cp manifest.json background.js popup.html popup.js tfav.html tfav.js "${out}/"
cp lib/*.js "${out}/lib/"
cp css/*.css "${out}/css/"
cp ui/*.js "${out}/ui/"

(cd dist && zip -FSqr "$(basename "${zip_file}")" "$(basename "${out}")")

printf 'Built %s\n%s\n' "${out}" "${zip_file}"
