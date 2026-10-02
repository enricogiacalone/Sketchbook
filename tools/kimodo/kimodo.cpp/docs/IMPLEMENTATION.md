# Implementation sketch

This is the engineering design for a reference-faithful Kimodo inference port.
It intentionally separates the motion denoiser from the LLM2Vec text encoder:
that is both the natural validation boundary and the way to avoid retaining an
8B text model in GPU memory while sampling motion.

## First supported slice

The first shippable slice is `Kimodo-SMPLX-RP-v1`, one prompt, one sample,
unconstrained motion, no post-processing.  It produces a 30-FPS sequence of
SMPL-X22 local joint rotations and root translations.  It is not dependent on
SkinTokens, GLB, a robotics policy, or a browser demo.

```text
UTF-8 prompt
  -> LLM2Vec embedding [1, 1, 4096]
  -> two-stage Kimodo denoiser, 100 DDIM iterations
  -> normalized motion representation
  -> inverse motion representation
  -> rotations [T, 22, 3, 3], root translations [T, 3], contacts
```

`Kimodo-SOMA-RP-v1.1` becomes the primary quality/demo checkpoint after that
slice passes; it reuses the denoiser/runtime but supplies SOMA77-specific
metadata and motion-representation data.  G1 is a third checkpoint/skeleton
variant, not a control policy build.

## Source layout

```text
include/kimodo/kimodo_capi.h       stable flat C ABI
include/kimodo/kimodo.hpp          optional safe C++ wrapper
src/
  model.{hpp,cpp}                  GGUF metadata/tensors, lazy model sessions
  gguf.{hpp,cpp}                   checked metadata and tensor lookup helpers
  text_encoder.{hpp,cpp}           LLM2Vec tokenizer/encoder abstraction
  llama_bi.{hpp,cpp}               small bidirectional Llama graph and mean pooling
  llama3_tokenizer.{hpp,cpp}       Llama-3 byte-BPE tokenizer only
  denoiser.{hpp,cpp}               root/body transformer graphs
  transformer.{hpp,cpp}            LayerNorm, MHA, MLP, positional/timestep ops
  diffusion.{hpp,cpp}              schedule, CFG and DDIM update
  motion_rep.{hpp,cpp}             normalise/inverse/root-local conversion
  skeleton.{hpp,cpp}               immutable SMPL-X/SOMA/G1 metadata and FK
  export.{hpp,cpp}                 NPZ/JSON initially; GLB later
  capi.cpp                         exception firewall and C ownership rules
  cli.cpp                          kmd-cli
scripts/
  convert_motion_to_gguf.py
  convert_llm2vec_to_gguf.py
reference/
  dump_kimodo_reference.py
  dump_text_reference.py
  dump_motion_rep_reference.py
tests/                             fixtures are optional through environment vars
fuzz/                              parsers and public API boundaries only
demo/                              local Go server and WebGL motion viewer
```

No source file is shared by the PyTorch reference and the implementation.  The
only bridge is versioned, checked test data.

## Model files

Use separate memory-mappable GGUF files.

```text
kimodo-smplx-rp-v1-f32.gguf        denoiser + schedule + representation metadata
llm2vec-llama3-8b-bidir-f16.gguf  base model, merged adapter and tokenizer
```

The motion GGUF stores:

- architecture: skeleton key, parent array, FPS, input/output dimensions,
  root/body dimensions, heads, layers, feed-forward width, activation,
  norm order, text-token count and base diffusion-step count;
- normalisation means/stds, rest-pose transforms, joint names and contact-joint
  indices;
- diffusion schedule constants or enough configuration to generate and test
  them exactly;
- root and body input/output/text/time projections, positional encoding
  parameters, each transformer LayerNorm, Q/K/V/O projection and MLP weight;
- any learned motion-representation tensor consumed during inverse conversion.

The converter must record source repository, revision, file hashes, dtype and
conversion program revision in GGUF metadata.  F32 is required for initial
parity.  F16 and quantised denoisers come only after an F32 end-to-end fixture
passes.

PyTorch `TransformerEncoderLayer` stores fused `in_proj_weight`/bias.  The
converter may store that fused layout and slice it at graph construction, or
store named Q/K/V tensors; the latter is easier to validate.  Its orientation
must be explicitly transposed for GGML's matrix multiplication convention and
unit-tested per projection.

## Runtime and VRAM lifecycle

The public model handle owns two immutable GGUF descriptions, but it does not
keep both backend-resident at once.

```text
model handle: mmap motion GGUF + mmap text GGUF + CPU metadata

generate(prompt):
  1. create/load text session on requested backend
  2. tokenize, bidirectional Llama inference, mean-pool -> 4096 floats
  3. copy the embedding to host cache; destroy text session/backend buffers
  4. create/load motion session on requested backend
  5. upload [1,1,4096] embedding; run the complete DDIM loop
  6. inverse representation and copy output to caller-owned motion result
```

This is intentionally more conservative than upstream Python, which keeps its
text encoder and denoiser objects alive.  It avoids their combined peak GPU
allocation.  A later `--keep-text-loaded` option may trade VRAM for latency.

The cache key is SHA-256 of text-model identity, adapter identity, tokenizer
identity and exact UTF-8 prompt.  Cached embeddings are only valid for that
identity and are stored as F32.  A `--embedding-npz`/C-API embedding input is
also supported for denoiser-only validation and batch production.

## Text encoder design

`LLM2VecEncoder` is an adapter behind this interface:

```cpp
struct text_encoder {
  result<encoded_text> encode(std::string_view utf8_prompt) const;
};

struct encoded_text {
  std::vector<std::int32_t> token_ids;
  std::vector<std::uint8_t> attention_mask;
  std::vector<float> pooled; // exactly 4096 values
};
```

The only third-party inference dependency is a pinned GGML/gguf revision, added
as a git submodule (ordinary builds) or a Nix flake input (reproducible builds).
`kimodo.cpp` links directly to `ggml` and `gguf`; it does **not** vendor or link
all of llama.cpp.

Implement the small Llama-3 byte-BPE tokenizer in `llama3_tokenizer.cpp` from
the tokenizer JSON/GGUF metadata: special tokens, Unicode pre-tokenisation,
byte encoding and merge ranks.  Its test fixtures are token IDs from upstream
LLM2Vec.  We may initially use llama.cpp only as a read-only implementation
reference for edge-case tests, not as a build dependency.

Likewise, `llama_bi.cpp` implements only the Llama components LLM2Vec actually
uses—embedding, RMSNorm, RoPE, Q/K/V/O projections, gated MLP, residual stack,
non-causal attention mask and mean pooling—using raw GGML operations.  It does
not include generation, KV-cache, sampling, server, grammar, multimodal or
other llama.cpp subsystems.  LLM2Vec modifies ordinary Llama attention to be
bidirectional, applies the MNTP/supervised PEFT adapter and performs pooling,
so wrapping a stock causal llama.cpp runtime would not be exact anyway.

Choose the exact non-causal mask only after text fixtures prove upstream token
preparation.  Merge the adapter during conversion, and compare base-plus-
adapter and merged output in PyTorch first.  This removes LoRA arithmetic from
production inference.

The motion-port milestone may use externally captured text embeddings.  That
is a supported test mode, not a silent Python dependency in the final CLI.

## Denoiser implementation

For one DDIM step, construct two GGML graphs (or one graph with a scheduled
intermediate host conversion):

```text
root graph:
  noisy motion -> input projection
  text [B,L,4096] -> text projection
  sinusoidal timestep -> timestep projection
  concatenate [text, time, motion] + positional encoding
  TransformerEncoder layers -> root prediction [B,T,global_root_dim]

host/graph conversion:
  root global representation -> local-root representation

body graph:
  [local root, original body] -> input projection
  same text/time prefix + TransformerEncoder layers
  -> body prediction [B,T,body_dim]

combine root/body -> CFG result -> DDIM x(t-1)
```

For separated CFG, concatenate the text-conditioned, constraint-conditioned
and unconditional rows exactly as upstream does, run each stage once batched,
then combine the three output chunks.  The first slice has no constraints but
must still reproduce the upstream separated-CFG ordering; do not substitute a
regular-CFG shortcut.

Start with F32 model tensors and F32 graph activations.  Treat finite-value
checks, dimensions and all mask lengths as untrusted input at the C boundary.
Use a deterministic local PRNG for the initial normal noise; reference tests
consume a stored initial-noise tensor rather than relying on seed agreement.

## Motion representation and export

The motion-representation code is ordinary deterministic math and belongs in
C++, not in the web app.  Implement and test it in this order:

1. normalisation/de-normalisation;
2. diffusion/global-root-to-local-root conversion;
3. local rotations and root path to global FK;
4. contact/headings output;
5. optional upstream C++ motion correction as a separately tested library.

The first CLI export is an NPZ-compatible result plus JSON metadata.  The
production asset export is a standards-compliant animated GLB with a skin,
joint hierarchy and local quaternion rotation tracks.  It must not use morph
targets for skeletal motion.

## Reference and conversion pipeline

All checkpoints are handled in an isolated trusted Python container.  The
normal converter consumes safetensors only.  If an upstream model uses a
legacy PyTorch pickle checkpoint, the reference container reads it once and
writes a hash-checked safetensors intermediate; C++ and normal conversion
never deserialize pickle.

Capture exact fixtures in increasing order:

| Fixture | C++ test |
|---|---|
| Llama IDs, masks, final states, pooled embedding | tokenizer/text parity |
| root model input/output | root transformer parity |
| global-root to local-root output | motion-representation parity |
| body model input/output | body transformer parity |
| CFG combined clean prediction | CFG parity |
| DDIM `x(t-1)` | sampler parity |
| all diffusion states and decoded motion | full parity |
| postprocessed motion | C++ correction parity |

Fixtures record upstream Git commit, checkpoint tensor hash, model config,
device, PyTorch/CUDA version, prompt, CFG settings, frame count and initial
noise.  Tests reject mismatched metadata before comparing arrays.  Thresholds
are explicit: start with F32 maximum absolute error and relative L2 limits for
each boundary, then make separate expectations for F16/quantised models.

## C API

The public API remains flat and exception-safe.  `kimodo_model_load` accepts
motion/text/adapter GGUF paths and validates their mutually compatible model
identities.  `kimodo_generate` accepts UTF-8, `frames`, steps, seed and CFG
weights, returning opaque `kimodo_motion` storage.  Borrowed output pointers
remain valid only until `kimodo_motion_free`.

Add before first release:

- `kimodo_generate_embedding(...)` for validation/cache-backed generation;
- versioned `kimodo_generation_options.size` compatibility checks;
- fixed-size caller-provided error buffers plus per-context `last_error`;
- progress callback `(stage, step, total)` for text encoding and diffusion;
- no exceptions across C and no global mutable model state.

The safe C++ API wraps it with `std::expected`; neither API exposes GGML
objects, raw file mappings or backend internals.

## Build, tests and hardening

Use the animate-any-mesh.cpp pattern: a pinned **GGML-only** flake, dynamically
loaded CPU variants plus Vulkan, release hardening, separate Docker reference
image, and a Clang ASan/UBSan/fuzzer preset.  The ordinary tests do not download
models; `KMD_REFERENCE_DIR` and `KMD_TEST_GGUF` opt into locally supplied
fixtures/models.

Fuzz targets:

- GGUF header/metadata/tensor dimension validation;
- NPZ fixture and output import bounds;
- UTF-8 prompt/tokenisation boundaries;
- constraints JSON and skeleton/animation export;
- C API null pointers, overflow dimensions, error-buffer sizes and invalid
  option-struct versions.

Fuzzing does not call arbitrary model tensors or unbounded diffusion loops.
ASan/UBSan runs fixed tiny fixtures and parser fuzzers; full GPU parity remains
a separate, opt-in integration test.

## Delivery sequence

1. Download the official SMPL-X RP checkpoint, LLM2Vec base and adapter; record
   exact revisions/hashes; build upstream reference Docker image.
2. Capture the supplied single-prompt demo fixture and write the safe weight
   extraction/converter manifest.
3. Implement GGUF loading plus diffusion/math tests with no neural graph.
4. Convert and implement F32 root/body transformer parity using cached text
   embeddings.
5. Implement CFG, full DDIM sampling, inverse representation and NPZ output.
6. Add bidirectional LLM2Vec port, serial GPU residency and text parity.
7. Add SMPL-X skeletal GLB export and SkinTokens retarget test asset.
8. Add SOMA v1.1, C API, sanitizers/fuzzing, benchmark and local web demo.

The demo is deliberately last.  It will mirror prior local-first projects:
a localhost-only Go server queues one inference job, stores prompt/options and
motion outputs durably, and a dependency-free WebGL viewer plays the skeleton
and animated rigged GLB side by side.  It is a QA surface for exact bundled
examples, not a substitute for layer-level parity tests.
