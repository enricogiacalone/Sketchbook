# Kimodo porting plan

## Scope and first checkpoint

Start with `Kimodo-SMPLX-RP-v1`: its 22-joint output is the most direct bridge
to a SkinTokens rig built on an SMPL-X hierarchy.  It is an R&D-licensed
checkpoint, so distribution and test-download automation must preserve the
upstream licence gate.  The later default-quality target is
`Kimodo-SOMA-RP-v1.1`, which has a different 77-joint motion representation.

The port boundary is deliberately the motion generator.  It is not a robot
control policy: Kimodo produces kinematic motion.  ProtoMotions or another
tracker is a downstream, optional physics-control stage.

## Upstream graph inventory

For one prompt and one sample, the PyTorch graph is:

```text
prompt
  -> LLM2Vec: Llama-3-8B + MNTP/PEFT adapter, modified bidirectional attention
  -> [1, 1, 4096] text embedding
  -> diffusion loop (100 steps by default)
       -> classifier-free guidance calls
       -> two-stage denoiser
            root TransformerEncoder
            global-root -> local-root representation conversion
            body TransformerEncoder
       -> DDIM update
  -> motion representation inverse + optional C++ motion correction
  -> local rotations, global rotations, joints, contacts and root motion
```

Each transformer is PyTorch `TransformerEncoder`: pre/post-norm is checkpoint
configured; exact configuration must come from the downloaded `config.yaml`,
not be inferred from the source defaults.  The denoiser has ordinary linear
projections, sinusoidal positional/timestep embeddings, multi-head attention,
MLPs, LayerNorm and GELU/ReLU as configured.  The global-root conversion,
normalisation statistics, diffusion schedule, CFG batching/order and DDIM
arithmetic are all part of the parity surface.

## Text encoder: reuse, but not unmodified llama.cpp

Kimodo loads `McGill-NLP/LLM2Vec-Meta-Llama-3-8B-Instruct-mntp` and the
`...-supervised` PEFT adapter in bfloat16.  Upstream modifies Llama attention
to be bidirectional, performs LLM2Vec instruction/token processing and pools
the result into one 4096-wide vector.  A normal causal llama.cpp embedding
call will therefore not reproduce Kimodo embeddings, even if tokenizer and
base weights match.

The intended implementation investigation is:

1. Verify whether the current GGML Llama graph can expose a non-causal mask
   and exact mean pooling for this architecture.
2. Merge or apply the PEFT adapter during conversion, and prove the merged
   tensors against PyTorch.
3. Capture and test tokens, attention mask, final hidden states, pooled
   embedding, then the denoiser text projection separately.

Do not convert the 8B encoder until this test proves that an exact
bidirectional GGML graph is available.  A temporary reference service may
produce cached `[1,1,4096]` embeddings while the motion denoiser is ported.

## VRAM decision

The upstream README's approximately 17 GB all-GPU figure is primarily the
8B bfloat16 LLM2Vec text encoder.  It states that putting that encoder on CPU
reduces GPU use below 3 GB, which bounds the denoiser/runtime allocation in
their tested configuration.  The current upstream process loads the encoder
and denoiser independently and does not unload the encoder after encoding.

`kimodo.cpp` should support serial GPU use:

```text
load text encoder -> encode prompt -> copy/cache 4096 floats -> unload encoder
load denoiser -> diffusion sample -> export motion
```

This exchanges latency and model reloads for low peak VRAM.  It must be
benchmarked after parity work; it is not an assumption that both weight sets
fit alongside the allocator workspace on every GPU.

## Reference fixtures and validation order

Use upstream's bundled demo folders as immutable input cases.  Initially use
the unconstrained cases:

- `kimodo-soma-rp/01_single_text_prompt` — seed 42, 5 seconds, 100 steps.
- `kimodo-g1-rp/01_single_text_prompt` — seed 43, 5 seconds, 100 steps.

The matching `meta.json` and generated `motion.npz` are already included in
the upstream checkout.  Once the model checkpoints are locally available,
capture a fresh PyTorch result using the same metadata, record package/model
revisions and compare the supplied output separately (it may originate from a
different release).

Fixtures must contain self-describing tensors and metadata, using a safe
format such as NPZ plus JSON or GGUF.  They should be generated in this order:

1. tokenizer IDs, text attention mask, LLM final states and pooled 4096-vector;
2. denoiser root-model input/output at one fixed diffusion timestep;
3. global-root-to-local-root conversion;
4. denoiser body-model input/output;
5. CFG combined clean prediction;
6. one DDIM update;
7. all sampling steps and motion-representation inverse;
8. optional motion correction, tested independently of neural inference.

Use fixed CPU reference tensors for primitive layer tests and CUDA tensors for
end-to-end fixtures.  Randomness needs an explicit generator and captured
initial noise; matching a seed alone is not sufficient across frameworks.

## Project requirements

The eventual implementation follows the established sibling-project pattern:

- GGUF conversion reads only safetensors; reject pickle checkpoints by
  default.  If upstream ships a legacy `.pt`, require an isolated trusted
  reference conversion that writes safe tensors atomically.
- A pinned Docker reference environment mounts the upstream checkout and
  checkpoints read-only and writes fixtures only to the project workspace.
- A Nix development flake pins GGML, provides CPU and Vulkan backends, tests,
  Clang ASan/UBSan and libFuzzer builds.
- Every public C entry point catches exceptions and validates all pointer,
  length, dimension and finite-float inputs before allocation or graph build.
- Fuzz GLB/NPZ import, GGUF metadata/tensor layouts, prompt UTF-8, constraints
  JSON, and motion-export/retarget data; do not fuzz model compute with
  arbitrary unbounded dimensions.

## Milestones

1. Reference container, model downloader with hashes/licence notes, and a
   capture script.
2. Motion-only GGUF converter and root/body transformer layer parity.
3. Diffusion/CFG/motion-representation parity and skeletal GLB export.
4. LLM2Vec bidirectional encoder port or a separately versioned GGML extension.
5. Complete C API, sanitizer/fuzzer suite, benchmark and local web demo.
