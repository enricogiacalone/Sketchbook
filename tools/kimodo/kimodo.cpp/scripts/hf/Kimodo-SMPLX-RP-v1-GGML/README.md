---
license: other
library_name: ggml
base_model: nvidia/Kimodo-SMPLX-RP-v1
base_model_relation: quantized
tags: [gguf, ggml, text-to-motion, smplx, kimodo]
---

# Oops — Kimodo-SMPLX-RP-v1 is local-conversion only

The kimodo.cpp converter can produce a local F32 GGML/GGUF representation of
[nvidia/Kimodo-SMPLX-RP-v1](https://huggingface.co/nvidia/Kimodo-SMPLX-RP-v1),
the SMPL-X 22-joint text-and-constraint conditioned motion diffusion model.
It is not a redistributable GGUF release.

We originally published the converted weights here, then noticed that the
upstream NVIDIA Internal Scientific Research and Development Model License
explicitly prohibits distributing derivative models. Oops. The GGUF, manifest,
and checksums have therefore been removed; this card remains so that existing
links explain what happened instead of becoming a mysterious 404.

If someone at NVIDIA is willing to give LocalAI-io written permission to
redistribute this checkpoint as GGML/GGUF, that would be very welcome. We would
be happy to restore the conversion with its upstream provenance and verified
parity results.

## Provenance and licence

The local converter targets upstream revision
`1419ba56b734c48bbafb41fefa84088ca94583b5`.

Kimodo-SMPLX-RP-v1 remains subject to the
[NVIDIA Internal Scientific Research and Development Model License](https://www.nvidia.com/en-us/agreements/enterprise-software/nvidia-internal-scientific-research-and-development-model-license/).
That licence limits the checkpoint and derivative models to internal,
non-production R&D and prohibits their distribution. Converting the weights to
GGUF does not grant additional rights.
