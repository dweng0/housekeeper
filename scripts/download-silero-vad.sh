#!/bin/bash
set -e

VAD_MODEL_DIR="${VAD_MODEL_DIR:-data/vad-models}"
SILERO_VERSION="${SILERO_VERSION:-v6.2.0}"
MODEL_FILE="ggml-silero-${SILERO_VERSION}.bin"
MODEL_PATH="${VAD_MODEL_DIR}/${MODEL_FILE}"
URL="https://huggingface.co/ggml-org/whisper-vad/resolve/main/${MODEL_FILE}?download=true"

if [ -f "$MODEL_PATH" ]; then
  echo "Silero VAD model already exists at $MODEL_PATH"
  exit 0
fi

mkdir -p "$VAD_MODEL_DIR"
echo "Downloading Silero VAD model $SILERO_VERSION..."
curl -L -o "$MODEL_PATH" "$URL"
echo "Done. Model saved to $MODEL_PATH"