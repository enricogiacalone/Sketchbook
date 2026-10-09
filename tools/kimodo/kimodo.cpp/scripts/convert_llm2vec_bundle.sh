#!/usr/bin/env bash
# Build the serial native text bundle. Run this once inside `nix develop`;
# the Python converter itself has no network or framework dependency.
set -euo pipefail

if [[ $# -ne 2 && $# -ne 4 ]]; then
    echo "usage: $0 BASE_MODEL_DIR OUTPUT_DIR [FIRST_LAYER LAST_LAYER]" >&2
    exit 2
fi

base=$1
output=$2
root=$(cd "$(dirname "$0")/.." && pwd)
mkdir -p "$output"
first=0
last=31
if [[ $# -eq 2 ]]; then
    python3 "$root/scripts/convert_llm2vec_tokenizer_to_gguf.py" \
        --tokenizer "$base/tokenizer.json" --output "$output/tokenizer.gguf"
    python3 "$root/scripts/convert_llm2vec_layer_to_gguf.py" \
        --base "$base" --mntp-adapter "$root/models/llm2vec-mntp-adapter" \
        --supervised-adapter "$root/models/llm2vec-adapter" --embedding \
        --output "$output/embedding.gguf"
    python3 "$root/scripts/convert_llm2vec_layer_to_gguf.py" \
        --base "$base" --mntp-adapter "$root/models/llm2vec-mntp-adapter" \
        --supervised-adapter "$root/models/llm2vec-adapter" --final-norm \
        --output "$output/final-norm.gguf"
else
    first=$3
    last=$4
fi
for layer in $(seq "$first" "$last"); do
    printf -v name 'layer-%02d.gguf' "$layer"
    python3 "$root/scripts/convert_llm2vec_layer_to_gguf.py" \
        --base "$base" --mntp-adapter "$root/models/llm2vec-mntp-adapter" \
        --supervised-adapter "$root/models/llm2vec-adapter" --layer "$layer" \
        --output "$output/$name"
done
