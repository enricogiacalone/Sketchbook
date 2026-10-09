---
license: other
library_name: ggml
base_model: nvidia/Kimodo-G1-SEED-v1
base_model_relation: quantized
tags: [gguf, ggml, text-to-motion, unitree-g1, kimodo]
---

# Kimodo-G1-SEED-v1-GGML

Native F32 GGML/GGUF conversion of
[nvidia/Kimodo-G1-SEED-v1](https://huggingface.co/nvidia/Kimodo-G1-SEED-v1),
targeting the 34-joint Unitree G1 skeleton. Its reusable Llama-derived text
encoder is distributed separately as
[`Llama-3-Kimodo-GGML`](https://huggingface.co/LocalAI-io/Llama-3-Kimodo-GGML).

The model is installed at `models/kimodo-g1-seed-v1-f32.gguf` by
`scripts/download_gguf_weights.sh --output "$PWD" --model g1-seed-v1`.

## Provenance and licence

Converted from upstream revision `5e6f2c7e18c2ab834c8d7983b9dcce701e5c6097`.
`MANIFEST.json` records the source revision and SHA-256 of the GGUF. The model
remains subject to the [NVIDIA Open Model License](https://www.nvidia.com/en-us/agreements/enterprise-software/nvidia-open-model-license/).
This conversion grants no additional rights.
