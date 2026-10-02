#!/usr/bin/env python3
"""Capture safe Kimodo PyTorch fixtures for GGML layer-parity tests.

The script is run inside the official upstream environment.  It keeps upstream
code read-only and writes only an NPZ/JSON pair.  The generated fixture covers
unconstrained single-prompt inference; constraints and post-processing are
captured separately so their behaviour cannot mask a denoiser error.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import platform
import sys
import gc
from pathlib import Path
from typing import Any

import numpy as np
import torch


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--upstream", required=True, type=Path, help="Kimodo checkout")
    parser.add_argument("--model", default="kimodo-smplx-rp")
    parser.add_argument("--prompt", required=True)
    parser.add_argument("--frames", required=True, type=int)
    parser.add_argument("--steps", default=100, type=int)
    parser.add_argument("--seed", required=True, type=int)
    parser.add_argument("--device", default="cuda")
    parser.add_argument("--checkpoint-dir", type=Path,
                        help="local directory containing the selected Kimodo checkpoint; never download at capture time")
    parser.add_argument("--zero-embedding", action="store_true",
                        help="use a deterministic [1,1,4096] zero embedding; enables motion-only fixtures")
    parser.add_argument("--text-base", type=Path,
                        help="local Llama-3 base model; together with both adapters, encodes before loading diffusion")
    parser.add_argument("--text-mntp-adapter", type=Path,
                        help="local LLM2Vec MNTP adapter")
    parser.add_argument("--text-supervised-adapter", type=Path,
                        help="local LLM2Vec supervised adapter")
    parser.add_argument("--output", required=True, type=Path)
    return parser.parse_args()


def as_numpy(value: Any) -> np.ndarray:
    if not isinstance(value, torch.Tensor):
        raise TypeError(f"expected tensor, got {type(value)!r}")
    return value.detach().to(device="cpu", dtype=torch.float32).contiguous().numpy()


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


class CachedEmbedding:
    """A one-prompt text encoder that keeps the diffusion capture GPU-only.

    The real LLM2Vec model is deliberately released before Kimodo is loaded.
    This avoids an otherwise unnecessary combined 8B-LLM + diffusion VRAM peak
    while retaining the exact F32 embedding used by the upstream denoiser.
    """

    def __init__(self, embedding: torch.Tensor, prompt: str):
        self.embedding = embedding.detach().to(device="cpu", dtype=torch.float32).contiguous()
        self.prompt = prompt

    def __call__(self, texts: list[str] | str):
        values = [texts] if isinstance(texts, str) else texts
        if values != [self.prompt]:
            raise RuntimeError("capture cache only supports its recorded single prompt")
        return self.embedding.clone(), [1]


def capture_real_embedding(args: argparse.Namespace) -> CachedEmbedding:
    paths = [args.text_base, args.text_mntp_adapter, args.text_supervised_adapter]
    if any(path is None for path in paths):
        raise SystemExit("real text capture requires --text-base, --text-mntp-adapter, and --text-supervised-adapter")
    if any(not path.is_dir() for path in paths):
        raise SystemExit("each local text model path must be a directory")

    from kimodo.model.llm2vec import LLM2Vec  # pylint: disable=import-outside-toplevel
    from peft import PeftModel  # pylint: disable=import-outside-toplevel

    # LLM2Vec's upstream preset is base Llama + MNTP LoRA + supervised LoRA.
    # Merge only the MNTP stage; the second adapter remains active exactly as
    # it is in the upstream Kimodo LLM2VecEncoder.
    encoder = LLM2Vec.from_pretrained(
        str(args.text_base), peft_model_name_or_path=str(args.text_mntp_adapter),
        merge_peft=True, torch_dtype=torch.bfloat16,
    )
    encoder.model = PeftModel.from_pretrained(encoder.model, str(args.text_supervised_adapter))
    embedding = encoder.encode([args.prompt], batch_size=1, show_progress_bar=False, device=args.device)
    if tuple(embedding.shape) != (1, 4096):
        raise RuntimeError(f"LLM2Vec returned {tuple(embedding.shape)}, expected (1, 4096)")
    return CachedEmbedding(embedding[:, None, :], args.prompt)


def main() -> None:
    args = parse_args()
    upstream = args.upstream.resolve()
    if not (upstream / "kimodo").is_dir():
        raise SystemExit(f"not a Kimodo checkout: {upstream}")
    if args.frames <= 0 or args.steps <= 0:
        raise SystemExit("--frames and --steps must be positive")
    if args.zero_embedding and any((args.text_base, args.text_mntp_adapter, args.text_supervised_adapter)):
        raise SystemExit("--zero-embedding cannot be combined with real text model paths")
    if args.checkpoint_dir:
        checkpoint = args.checkpoint_dir.resolve()
        model_folders = {
            "kimodo-smplx-rp": "Kimodo-SMPLX-RP-v1",
            "kimodo-smplx-rp-v1": "Kimodo-SMPLX-RP-v1",
            "kimodo-soma-rp": "Kimodo-SOMA-RP-v1.1",
            "kimodo-soma-rp-v1.1": "Kimodo-SOMA-RP-v1.1",
            "kimodo-soma-seed": "Kimodo-SOMA-SEED-v1.1",
            "kimodo-soma-seed-v1.1": "Kimodo-SOMA-SEED-v1.1",
            "kimodo-g1-rp": "Kimodo-G1-RP-v1",
            "kimodo-g1-rp-v1": "Kimodo-G1-RP-v1",
            "kimodo-g1-seed": "Kimodo-G1-SEED-v1",
            "kimodo-g1-seed-v1": "Kimodo-G1-SEED-v1",
        }
        folder = model_folders.get(args.model)
        if folder is None or not (checkpoint / folder / "config.yaml").is_file():
            raise SystemExit("--checkpoint-dir does not contain the selected official Kimodo model")
        # This is deliberately set only for the reference subprocess.  It
        # prevents a missing local model from silently falling back to HF.
        import os
        os.environ["CHECKPOINT_DIR"] = str(checkpoint)

    sys.path.insert(0, str(upstream))
    from kimodo import load_model  # pylint: disable=import-outside-toplevel

    torch.manual_seed(args.seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(args.seed)

    text_encoder = None
    if args.zero_embedding:
        class ZeroEmbedding:
            def __call__(self, text: list[str] | str):
                batch = len(text) if isinstance(text, list) else 1
                return torch.zeros((batch, 1, 4096), dtype=torch.float32), [1] * batch
        text_encoder = ZeroEmbedding()
    elif any((args.text_base, args.text_mntp_adapter, args.text_supervised_adapter)):
        text_encoder = capture_real_embedding(args)
        # The 8B encoder owns the GPU while encoding.  The cached output is
        # CPU F32, so release all allocator-owned memory before diffusion.
        gc.collect()
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
    model, resolved_name = load_model(
        args.model, device=args.device, return_resolved_name=True, text_encoder=text_encoder
    )
    root_calls: list[tuple[tuple[torch.Tensor, ...], torch.Tensor]] = []
    body_calls: list[tuple[tuple[torch.Tensor, ...], torch.Tensor]] = []
    root_layer0: list[torch.Tensor] = []
    root_layers: list[list[torch.Tensor]] = [[] for _ in range(16)]
    root_layer0_inputs: list[torch.Tensor] = []
    root_attention0: list[torch.Tensor] = []
    root_norm10: list[torch.Tensor] = []
    root_motion_projection: list[torch.Tensor] = []
    root_text_projection: list[torch.Tensor] = []
    root_timestep_projection: list[torch.Tensor] = []
    root_heading_projection: list[torch.Tensor] = []
    sampling_inputs: list[torch.Tensor] = []
    sampling_outputs: list[torch.Tensor] = []

    def capture(calls: list[tuple[tuple[torch.Tensor, ...], torch.Tensor]]):
        def hook(_module: torch.nn.Module, inputs: tuple[Any, ...], output: torch.Tensor) -> None:
            tensors = tuple(item for item in inputs if isinstance(item, torch.Tensor))
            calls.append((tensors, output))
        return hook

    root_hook = model.denoiser.model.root_model.register_forward_hook(capture(root_calls))
    body_hook = model.denoiser.model.body_model.register_forward_hook(capture(body_calls))
    root_layer_hook = model.denoiser.model.root_model.seqTransEncoder.layers[0].register_forward_hook(
        lambda _module, _inputs, output: root_layer0.append(output)
    )
    root_layer_hooks = [layer.register_forward_hook(
        lambda _module, _inputs, output, index=index: root_layers[index].append(output)
    ) for index, layer in enumerate(model.denoiser.model.root_model.seqTransEncoder.layers)]
    root_layer_input_hook = model.denoiser.model.root_model.seqTransEncoder.layers[0].register_forward_pre_hook(
        lambda _module, inputs: root_layer0_inputs.append(inputs[0])
    )
    root_attention_hook = model.denoiser.model.root_model.seqTransEncoder.layers[0].self_attn.register_forward_hook(
        lambda _module, _inputs, output: root_attention0.append(output[0])
    )
    root_norm1_hook = model.denoiser.model.root_model.seqTransEncoder.layers[0].norm1.register_forward_hook(
        lambda _module, _inputs, output: root_norm10.append(output)
    )
    root_motion_hook = model.denoiser.model.root_model.input_linear.register_forward_hook(
        lambda _module, _inputs, output: root_motion_projection.append(output)
    )
    root_text_hook = model.denoiser.model.root_model.embed_text.register_forward_hook(
        lambda _module, _inputs, output: root_text_projection.append(output)
    )
    root_timestep_hook = model.denoiser.model.root_model.embed_timestep.register_forward_hook(
        lambda _module, _inputs, output: root_timestep_projection.append(output)
    )
    root_heading_hook = model.denoiser.model.root_model.linear_first_heading_angle.register_forward_hook(
        lambda _module, _inputs, output: root_heading_projection.append(output)
    )
    original_denoising_step = model.denoising_step

    def capture_denoising_step(*args: Any, **kwargs: Any) -> torch.Tensor:
        sampling_inputs.append(args[0].detach().clone())
        value = original_denoising_step(*args, **kwargs)
        sampling_outputs.append(value.detach().clone())
        return value

    model.denoising_step = capture_denoising_step
    try:
        text_features, text_lengths = model.text_encoder([args.prompt])
        output = model(
            args.prompt,
            num_frames=args.frames,
            num_denoising_steps=args.steps,
            num_samples=1,
            cfg_weight=[2.0, 2.0],
            cfg_type="separated",
            post_processing=False,
            return_numpy=True,
            progress_bar=lambda values: values,
        )
    finally:
        root_hook.remove()
        body_hook.remove()
        root_layer_hook.remove()
        for hook in root_layer_hooks:
            hook.remove()
        root_layer_input_hook.remove()
        root_attention_hook.remove()
        root_norm1_hook.remove()
        root_motion_hook.remove()
        root_text_hook.remove()
        root_timestep_hook.remove()
        root_heading_hook.remove()
        model.denoising_step = original_denoising_step

    if not root_calls or not body_calls or not root_layer0 or any(not values for values in root_layers) or not root_layer0_inputs or not root_attention0 or not root_norm10 or not root_motion_projection or not root_text_projection or not root_timestep_projection or not root_heading_projection:
        raise RuntimeError("the denoiser hooks did not observe inference")

    # CFG may invoke a transformer more than once per diffusion step.  Capturing
    # call zero is a stable, fully specified first boundary; later calls remain
    # reproducible from the final output and are added as C++ reaches CFG.
    root_inputs, root_output = root_calls[0]
    body_inputs, body_output = body_calls[0]
    # This is the exact stage boundary used to construct body_input_0: it is
    # deliberately captured separately so C++ can validate the representation
    # conversion independently of either Transformer graph.
    root_lengths = root_inputs[1].sum(-1)
    root_local = model.denoiser.model.motion_rep.global_root_to_local_root(
        root_output, normalized=True, lengths=root_lengths
    )
    if not sampling_inputs or len(sampling_inputs) != len(sampling_outputs):
        raise RuntimeError("the sampler trajectory hook did not observe inference")
    tensors: dict[str, np.ndarray] = {
        "text_features": as_numpy(text_features),
        "text_lengths": np.asarray(text_lengths, dtype=np.int64),
        "root_output": as_numpy(root_output),
        "root_local": as_numpy(root_local),
        "body_output": as_numpy(body_output),
        "root_layer0_output": as_numpy(root_layer0[0]),
        "root_layer0_input": as_numpy(root_layer0_inputs[0]),
        "root_attention0_output": as_numpy(root_attention0[0]),
        "root_norm10_output": as_numpy(root_norm10[0]),
        "root_motion_projection": as_numpy(root_motion_projection[0]),
        "root_text_projection": as_numpy(root_text_projection[0]),
        "root_timestep_projection": as_numpy(root_timestep_projection[0]),
        "root_heading_projection": as_numpy(root_heading_projection[0]),
        "sampling_initial_noise": as_numpy(sampling_inputs[0]),
        "sampling_final_state": as_numpy(sampling_outputs[-1]),
    }
    for index, values in enumerate(root_layers):
        tensors[f"root_layer{index}_output"] = as_numpy(values[0])
    for prefix, inputs in (("root", root_inputs), ("body", body_inputs)):
        for index, value in enumerate(inputs):
            tensors[f"{prefix}_input_{index}"] = as_numpy(value)
    for key, value in output.items():
        if isinstance(value, np.ndarray):
            tensors[f"motion_{key}"] = value
    for index, (sample_in, sample_out) in enumerate(zip(sampling_inputs, sampling_outputs)):
        tensors[f"sampling_input_{index}"] = as_numpy(sample_in)
        tensors[f"sampling_output_{index}"] = as_numpy(sample_out)

    args.output.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(args.output.with_suffix(".npz"), **tensors)
    metadata = {
        "fixture_format": 1,
        "upstream": str(upstream),
        "resolved_model": resolved_name,
        "prompt": args.prompt,
        "frames": args.frames,
        "diffusion_steps": args.steps,
        "seed": args.seed,
        "cfg_type": "separated",
        "cfg_weight": [2.0, 2.0],
        "post_processing": False,
        "device": args.device,
        "checkpoint_dir": str(args.checkpoint_dir) if args.checkpoint_dir else None,
        "zero_embedding": args.zero_embedding,
        "torch": torch.__version__,
        "cuda": torch.version.cuda,
        "python": platform.python_version(),
        "root_call_count": len(root_calls),
        "body_call_count": len(body_calls),
        "sampling_step_count": len(sampling_inputs),
        "npz_sha256": sha256(args.output.with_suffix(".npz")),
    }
    args.output.with_suffix(".json").write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
