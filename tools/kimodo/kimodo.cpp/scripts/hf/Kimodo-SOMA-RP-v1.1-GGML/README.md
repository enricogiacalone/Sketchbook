---
license: other
library_name: ggml
base_model: nvidia/Kimodo-SOMA-RP-v1.1
base_model_relation: quantized
tags: [gguf, ggml, text-to-motion, soma, kimodo]
---

# Kimodo-SOMA-RP-v1.1-GGML

Native F32 GGML/GGUF conversion of
[nvidia/Kimodo-SOMA-RP-v1.1](https://huggingface.co/nvidia/Kimodo-SOMA-RP-v1.1).
The model predicts the compact SOMA 30-joint control skeleton. Its reusable
Llama-derived text encoder is distributed separately as
[`Llama-3-Kimodo-GGML`](https://huggingface.co/LocalAI-io/Llama-3-Kimodo-GGML).

The model is installed at `models/kimodo-soma-rp-v1.1-f32.gguf` by
`scripts/download_gguf_weights.sh --output "$PWD" --model soma-rp-v1.1`.

## Provenance and licence

Converted from upstream revision `6c9233af1180b8151e3c4703477104af5dce9dd5`.
`MANIFEST.json` records the source revision and SHA-256 of the GGUF. The model
remains subject to the [NVIDIA Open Model License](https://www.nvidia.com/en-us/agreements/enterprise-software/nvidia-open-model-license/).
This conversion grants no additional rights.
