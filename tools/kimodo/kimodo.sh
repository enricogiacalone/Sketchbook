#!/usr/bin/env bash
# Kimodo (NVIDIA, testo -> animazione) per le animazioni custom del manichino.
#
#   tools/kimodo/kimodo.sh setup
#       una volta: compila kimodo.cpp e scarica i pesi (~20 GB) sul disco esterno
#   tools/kimodo/kimodo.sh gen NOME "descrizione in inglese" [secondi 2-5] [seme]
#       genera un'animazione, la adatta al manichino (scripts/kimodo-retarget.mjs)
#       e la mette in public/kimodo-animations.glb con il nome NOME
#   tools/kimodo/kimodo.sh batch
#       genera tutte quelle di tools/kimodo/animations.json che mancano
#   tools/kimodo/kimodo.sh retarget
#       rifa' solo public/kimodo-animations.glb da assets-src/kimodo/
#
# Dove sta cosa (si puo' cambiare con le variabili d'ambiente):
#   KIMODO_DATA   pesi e uscite grezze      /Volumes/STORAGE_E/kimodo
#   KIMODO_SRC    sorgenti kimodo.cpp       tools/kimodo/kimodo.cpp (qui nel progetto)
#   KIMODO_LOCAL  programma compilato e     ~/.kimodo
#                 ambiente Python (pochi MB, sul disco interno: i dischi
#                 formattati per Windows non reggono i collegamenti simbolici)
#
# tools/kimodo/kimodo.cpp: copia di github.com/localai-org/kimodo.cpp
# (commit 568b0253f346fbe369587c7dae73d58594a14c90, Apache-2.0) con dentro
# ggml (github.com/ggml-org/ggml, commit 8c63e70982c95ceb862e3a1073a2c1beef75d60a,
# MIT), presa da simulation-citta senza la storia git.
#
# Modello: Kimodo SOMA RP v1.1 (NVIDIA Open Model License, uso commerciale
# consentito). Il codificatore del testo e' un Llama 3 8B: su un Mac da 16 GB
# ogni animazione richiede qualche minuto.
set -euo pipefail

REPO=$(cd "$(dirname "$0")/../.." && pwd)
KIMODO_DATA=${KIMODO_DATA:-/Volumes/STORAGE_E/kimodo}
KIMODO_SRC=${KIMODO_SRC:-$REPO/tools/kimodo/kimodo.cpp}
KIMODO_LOCAL=${KIMODO_LOCAL:-$HOME/.kimodo}
BUILD="$KIMODO_LOCAL/build"
VENV="$KIMODO_LOCAL/venv"
MODEL="$KIMODO_DATA/models/kimodo-soma-rp-v1.1-f32.gguf"
TEXT="$KIMODO_DATA/generated/llm2vec-text-bundle"
LOG="$KIMODO_DATA/kimodo.log"

say() { printf '\n== %s\n' "$*"; }
die() { printf '\nERRORE: %s\n' "$*" >&2; exit 1; }

check_disk() {
  [ -d "$(dirname "$KIMODO_DATA")" ] || die "$(dirname "$KIMODO_DATA") non c'e': collega il disco esterno"
  mkdir -p "$KIMODO_DATA"
}

setup() {
  check_disk
  [ -f "$KIMODO_SRC/CMakeLists.txt" ] || die "sorgenti di kimodo.cpp non trovati in $KIMODO_SRC"
  local free_gb
  free_gb=$(df -g "$KIMODO_DATA" | awk 'NR==2 {print $4}')
  [ "${free_gb:-0}" -ge 25 ] || die "servono almeno 25 GB liberi su $KIMODO_DATA (ce ne sono $free_gb)"

  say "strumenti (Homebrew: cmake, ninja)"
  command -v brew >/dev/null || die "serve Homebrew: https://brew.sh"
  for f in cmake ninja; do command -v "$f" >/dev/null || brew install "$f"; done

  say "Python per scaricare da Hugging Face ($VENV)"
  mkdir -p "$KIMODO_LOCAL"
  [ -x "$VENV/bin/hf" ] || { python3 -m venv "$VENV" && "$VENV/bin/pip" install -q -U "huggingface_hub[cli]"; }

  say "compilazione di kimodo.cpp ($BUILD)"
  local flags=(-G Ninja -DCMAKE_BUILD_TYPE=Release -DKIMODO_BUILD_TESTS=OFF -DKIMODO_ENABLE_VULKAN=OFF -DGGML_METAL=OFF)
  if ! { cmake -S "$KIMODO_SRC" -B "$BUILD" "${flags[@]}" && cmake --build "$BUILD" --target kmd-generate; } >"$KIMODO_LOCAL/build.log" 2>&1; then
    # il compilatore di Xcode potrebbe non avere tutto il C++23 che serve:
    # si riprova con quello di Homebrew (llvm)
    say "il compilatore di Xcode non basta, riprovo con llvm di Homebrew (log: $KIMODO_LOCAL/build.log)"
    brew list llvm >/dev/null 2>&1 || brew install llvm
    local llvm
    llvm=$(brew --prefix llvm)
    rm -rf "$BUILD"
    CC="$llvm/bin/clang" CXX="$llvm/bin/clang++" \
      LDFLAGS="-L$llvm/lib/c++ -L$llvm/lib/unwind -lunwind -Wl,-rpath,$llvm/lib/c++" \
      cmake -S "$KIMODO_SRC" -B "$BUILD" "${flags[@]}" >>"$KIMODO_LOCAL/build.log" 2>&1 \
      && cmake --build "$BUILD" --target kmd-generate >>"$KIMODO_LOCAL/build.log" 2>&1 \
      || die "compilazione fallita, vedi $KIMODO_LOCAL/build.log"
  fi
  echo "ok: $BUILD/kmd-generate"

  say "pesi (SOMA RP v1.1 + codificatore del testo, ~20 GB) in $KIMODO_DATA"
  export HF_HOME="$KIMODO_DATA/hf-home"
  if ! PATH="$VENV/bin:$PATH" bash "$KIMODO_SRC/scripts/download_gguf_weights.sh" --output "$KIMODO_DATA" --model soma-rp-v1.1; then
    die "download non riuscito. Se Hugging Face chiede l'accesso: apri le pagine dei modelli LocalAI-io/Llama-3-Kimodo-GGML e LocalAI-io/Kimodo-SOMA-RP-v1.1-GGML, accetta la licenza, poi lancia '$VENV/bin/hf auth login' e rilancia il setup"
  fi
  [ -f "$MODEL" ] && [ -d "$TEXT" ] || die "pesi mancanti dopo il download ($MODEL, $TEXT)"
  say "fatto. Prova: tools/kimodo/kimodo.sh gen saluto 'a person waves hello with the right hand' 3"
}

MANIFEST="$REPO/tools/kimodo/animations.json"

# NOME SECONDI SEME DESCRIZIONE (tab) dal manifesto, per un nome o per tutti
manifest_rows() {
  node -e '
    const m = require(process.argv[1]);
    for (const a of m.animations) if (!process.argv[2] || a.name === process.argv[2])
      console.log([a.name, a.seconds ?? 4, a.seed ?? 1, a.prompt].join("\t"));
  ' "$MANIFEST" "${1:-}"
}

# genera una clip grezza in assets-src/kimodo/NOME (senza adattarla)
generate_one() {
  local name=$1 prompt=$2 seconds=$3 seed=$4
  [[ "$name" =~ ^[A-Za-z0-9_]+$ ]] || die "NOME solo lettere, numeri e _ (diventa il nome della clip)"
  check_disk
  [ -x "$BUILD/kmd-generate" ] && [ -f "$MODEL" ] || die "prima: $0 setup"
  local frames=$((seconds * 30))
  [ "$frames" -ge 60 ] && [ "$frames" -le 150 ] || die "durata tra 2 e 5 secondi"
  local out="$KIMODO_DATA/out/$name"
  mkdir -p "$out"
  printf '%s\n' "$prompt" >"$out/prompt.txt"
  say "genero '$name' ($seconds s, seme $seed): $prompt"
  local t0=$SECONDS
  "$BUILD/kmd-generate" "$MODEL" "$TEXT" "$out/prompt.txt" "$frames" 100 "$seed" "$out" </dev/null 2>&1 | tee -a "$LOG"
  echo "($((SECONDS - t0)) s)"
  local dst="$REPO/assets-src/kimodo/$name"
  mkdir -p "$dst"
  cp "$out/root_positions.f32" "$out/local_rotations_xyzw.f32" "$out/prompt.txt" "$dst/"
  printf '{ "seed": %s, "seconds": %s }\n' "$seed" "$seconds" >"$dst/kimodo.json"
}

# gen NOME "descrizione" [secondi] [seme]   oppure   gen NOME (dal manifesto)
gen() {
  local name=${1:-} prompt=${2:-} seconds=${3:-4} seed=${4:-$RANDOM}
  [ -n "$name" ] || die "uso: $0 gen NOME \"descrizione\" [secondi 2-5] [seme]  (oppure solo NOME se e' in animations.json)"
  if [ -z "$prompt" ]; then
    local row
    row=$(manifest_rows "$name")
    [ -n "$row" ] || die "'$name' non e' in $MANIFEST: serve anche la descrizione"
    IFS=$'\t' read -r name seconds seed prompt <<<"$row"
  fi
  generate_one "$name" "$prompt" "$seconds" "$seed"
  retarget
}

# tutte quelle del manifesto che mancano (lunghe: lascia girare il Mac)
batch() {
  local rows todo=0 done_=0 t0=$SECONDS
  rows=$(manifest_rows)
  while IFS=$'\t' read -r name seconds seed prompt; do
    [ -f "$REPO/assets-src/kimodo/$name/local_rotations_xyzw.f32" ] || todo=$((todo + 1))
  done <<<"$rows"
  say "$todo animazioni da generare (le altre ci sono gia')"
  while IFS=$'\t' read -r name seconds seed prompt; do
    [ -f "$REPO/assets-src/kimodo/$name/local_rotations_xyzw.f32" ] && continue
    done_=$((done_ + 1))
    say "[$done_/$todo] dopo $(((SECONDS - t0) / 60)) min"
    generate_one "$name" "$prompt" "$seconds" "$seed"
  done <<<"$rows"
  retarget
  say "fatto in $(((SECONDS - t0) / 60)) min"
}

retarget() {
  (cd "$REPO" && node scripts/kimodo-retarget.mjs)
}

case "${1:-}" in
  setup) setup ;;
  gen) shift; gen "$@" ;;
  batch) batch ;;
  retarget) retarget ;;
  *) sed -n '2,13p' "$0"; exit 1 ;;
esac
