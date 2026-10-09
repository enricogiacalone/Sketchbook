---
license: other
library_name: ggml
tags: [gguf, ggml, llama-3, text-embeddings]
---

# Llama-3-Kimodo-GGML

Native F32 GGML/GGUF text-encoder components used by Kimodo. This is the
reusable LLM2Vec encoder only; download a matching Kimodo diffusion model
separately, for example
[`Kimodo-SMPLX-RP-v1-GGML`](https://huggingface.co/LocalAI-io/Kimodo-SMPLX-RP-v1-GGML).

From a kimodo.cpp checkout with the Hugging Face CLI installed, install both with:

```sh
scripts/download_gguf_weights.sh --output "$PWD"
```

The components intentionally remain split into individual layers so kimodo.cpp
can bound GPU memory use while evaluating the encoder.

## Provenance and licence

The bundle is converted from Meta Llama-3-8B-Instruct and the MIT-licensed
McGill LLM2Vec MNTP and supervised adapters. **Built with Meta Llama 3.**

`LICENSE-META-LLAMA-3.txt` and `NOTICE` accompany this distribution. Review
the [Meta Llama 3 Community License](https://huggingface.co/meta-llama/Meta-Llama-3-8B-Instruct)
before use or redistribution. `MANIFEST.json` records the exact source commits
and SHA-256 of each component.
