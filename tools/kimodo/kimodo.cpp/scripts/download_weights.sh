#!/usr/bin/env bash
# Download Kimodo inputs only after the caller has accepted each HF licence.
# This script resolves `main` once to a commit SHA, then downloads that exact
# revision and writes a content manifest. It never receives a token argument.
set -euo pipefail
export HF_HUB_DISABLE_PROGRESS_BARS=1

usage() {
  printf '%s\n' "usage: $0 --output DIR [--revision REVISION] [--model NAME]... [--with-text]" >&2
  exit 2
}

output='' revision='main' with_text=0
models=()
while [ "$#" -gt 0 ]; do
  case "$1" in
    --output) [ "$#" -ge 2 ] || usage; output=$2; shift 2 ;;
    --revision) [ "$#" -ge 2 ] || usage; revision=$2; shift 2 ;;
    --model) [ "$#" -ge 2 ] || usage; models+=("$2"); shift 2 ;;
    --with-text) with_text=1; shift ;;
    *) usage ;;
  esac
done
[ -n "$output" ] || usage
command -v hf >/dev/null || { echo "hf not found; enter the Nix shell first" >&2; exit 1; }

# The model is gated.  `hf auth login` stores the token in the caller's normal
# HF config; an HF_TOKEN environment variable is also honoured by the client.
if [ -z "${HF_TOKEN:-}" ] && ! hf auth whoami >/dev/null 2>&1; then
  echo "No Hugging Face login found. Accept the model licences, then run: hf auth login" >&2
  exit 1
fi

resolve_revision() {
  local repo=$1
  python - "$repo" "$revision" <<'PY'
from huggingface_hub import HfApi
import sys
info = HfApi().model_info(sys.argv[1], revision=sys.argv[2])
print(info.sha)
PY
}

download() {
  local repo=$1 name=$2 sha
  sha=$(resolve_revision "$repo")
  local target="$output/$name"
  mkdir -p "$target"
  echo "Downloading $repo at $sha"
  # Do not retain legacy pickle checkpoints. The converter accepts only
  # safetensors and the reference container owns any one-time trusted import.
  hf download "$repo" --revision "$sha" --exclude '*.pth' --local-dir "$target"
  (cd "$target" && find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum) > "$target/SHA256SUMS"
  printf '%s  %s\n' "$sha" "$repo" > "$target/REVISION"
}

if [ "${#models[@]}" -eq 0 ]; then models=(smplx-rp-v1); fi
for model in "${models[@]}"; do
  case "$model" in
    smplx-rp-v1) repo=nvidia/Kimodo-SMPLX-RP-v1; folder=Kimodo-SMPLX-RP-v1 ;;
    soma-rp-v1.1) repo=nvidia/Kimodo-SOMA-RP-v1.1; folder=Kimodo-SOMA-RP-v1.1 ;;
    soma-seed-v1.1) repo=nvidia/Kimodo-SOMA-SEED-v1.1; folder=Kimodo-SOMA-SEED-v1.1 ;;
    g1-rp-v1) repo=nvidia/Kimodo-G1-RP-v1; folder=Kimodo-G1-RP-v1 ;;
    g1-seed-v1) repo=nvidia/Kimodo-G1-SEED-v1; folder=Kimodo-G1-SEED-v1 ;;
    *) echo "Unknown Kimodo model: $model" >&2; usage ;;
  esac
  download "$repo" "$folder"
done
if [ "$with_text" -eq 1 ]; then
  # The MNTP repo is a LoRA adapter, not the Llama base checkpoint.  Keep all
  # three identities separately so converter provenance cannot confuse them.
  download meta-llama/Meta-Llama-3-8B-Instruct llama3-8b-instruct-base
  download McGill-NLP/LLM2Vec-Meta-Llama-3-8B-Instruct-mntp llm2vec-mntp-adapter
  download McGill-NLP/LLM2Vec-Meta-Llama-3-8B-Instruct-mntp-supervised llm2vec-adapter
fi
