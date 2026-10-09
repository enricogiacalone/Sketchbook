#!/usr/bin/env bash
# Convert and execute one layer at a time.  This is intentionally a parity
# harness, not inference: it keeps disk and model residency bounded while the
# native streaming session is being implemented.
set -euo pipefail

if [[ $# -ne 6 ]]; then
    echo "usage: $0 BUILD_DIR FIXTURE_DIR cpu|vulkan FIRST_LAYER LAST_LAYER STATE.f32" >&2
    exit 2
fi

build_dir=$1
fixture_dir=$2
backend=$3
first=$4
last=$5
state_file=$6
root=$(cd "$(dirname "$0")/.." && pwd)
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT
if (( first == 0 )); then
    cp "$fixture_dir/token_embeddings.f32" "$state_file"
fi
state=$state_file

for layer in $(seq "$first" "$last"); do
    gguf="$scratch/layer.gguf"
    next="$scratch/state-$layer.f32"
    python3 "$root/scripts/convert_llm2vec_layer_to_gguf.py" \
        --base "$root/models/llama3-8b-instruct-base" \
        --mntp-adapter "$root/models/llm2vec-mntp-adapter" \
        --supervised-adapter "$root/models/llm2vec-adapter" \
        --layer "$layer" --output "$gguf"
    "$build_dir/kimodo-llm-layer-parity" "$gguf" "$fixture_dir" "$layer" "$backend" "$state" "$next" || true
    mv "$next" "$state_file"
done
