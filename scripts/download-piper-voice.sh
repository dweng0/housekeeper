#!/usr/bin/env bash
set -euo pipefail

VOICE="${1:-en_US-lessac-medium}"
DEST="data/piper-voices"
BASE_URL="https://huggingface.co/rhasspy/piper-voices/resolve/main"

# Derive path components from voice name: lang_REGION-name-quality
# e.g. en_US-lessac-medium → en/en_US/lessac/medium
IFS='-' read -r lang_region name quality <<< "$VOICE"
lang="${lang_region%%_*}"
path="${lang}/${lang_region}/${name}/${quality}"

mkdir -p "$DEST"

for ext in onnx onnx.json; do
  file="${VOICE}.${ext}"
  dest_file="${DEST}/${file}"
  if [ -f "$dest_file" ]; then
    echo "Already exists: $dest_file"
  else
    echo "Downloading $file..."
    curl -L --fail --progress-bar \
      "${BASE_URL}/${path}/${file}" \
      -o "$dest_file"
  fi
done

echo "Done. Voice model at ${DEST}/${VOICE}.onnx"
