---
license: other
library_name: ggml
base_model: nvidia/Kimodo-SOMA-SEED-v1.1
base_model_relation: quantized
tags: [gguf, ggml, text-to-motion, soma, kimodo]
---

# Kimodo-SOMA-SEED-v1.1-GGML

Native F32 GGML/GGUF conversion of
[nvidia/Kimodo-SOMA-SEED-v1.1](https://huggingface.co/nvidia/Kimodo-SOMA-SEED-v1.1).
The model predicts the compact SOMA 30-joint control skeleton. Its reusable
Llama-derived text encoder is distributed separately as
[`Llama-3-Kimodo-GGML`](https://huggingface.co/LocalAI-io/Llama-3-Kimodo-GGML).

The model is installed at `models/kimodo-soma-seed-v1.1-f32.gguf` by
`scripts/download_gguf_weights.sh --output "$PWD" --model soma-seed-v1.1`.

## Provenance and licence

Converted from upstream revision `aae3af194322c60d21bc44062b64c3fec912be50`.
`MANIFEST.json` records the source revision and SHA-256 of the GGUF. The model
remains subject to the [NVIDIA Open Model License](https://www.nvidia.com/en-us/agreements/enterprise-software/nvidia-open-model-license/).
This conversion grants no additional rights.
