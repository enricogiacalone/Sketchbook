#!/usr/bin/env python3
"""Capture an upstream Kimodo multi-prompt transition fixture.

The script deliberately accepts precomputed F32 LLM2Vec embeddings.  This
keeps the 8B text model out of the PyTorch process while the upstream Kimodo
motion code remains the authority for the conditioned transition and DDIM
trajectory.  Record the provenance of every embedding in ``--embedding-note``.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import platform
import subprocess
import sys
from pathlib import Path
from typing import Any

import numpy as np
import torch


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def options() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--upstream", required=True, type=Path)
    parser.add_argument("--checkpoint-dir", required=True, type=Path)
    parser.add_argument("--prompt", action="append", required=True)
    parser.add_argument("--frames", action="append", required=True, type=int)
    parser.add_argument("--embedding", action="append", required=True, type=Path)
    parser.add_argument("--embedding-note", action="append", default=[])
    parser.add_argument("--transition-frames", default=5, type=int)
    parser.add_argument("--steps", default=2, type=int)
    parser.add_argument("--seed", default=42, type=int)
    parser.add_argument("--device", default="cpu")
    parser.add_argument("--output", required=True, type=Path)
    return parser.parse_args()


def as_f32(value: torch.Tensor) -> np.ndarray:
    return value.detach().to(device="cpu", dtype=torch.float32).contiguous().numpy()


class CapturedEmbeddings:
    """Text-encoder-compatible source of one already-captured vector per prompt."""

    def __init__(self, prompts: list[str], paths: list[Path]) -> None:
        self.values: dict[str, torch.Tensor] = {}
        for prompt, path in zip(prompts, paths):
            raw = np.fromfile(path, dtype="<f4")
            if raw.shape != (4096,):
                raise ValueError(f"{path} is {raw.shape}, expected 4096 F32 values")
            self.values[prompt] = torch.from_numpy(raw.copy()).reshape(1, 1, 4096)

    def __call__(self, texts: list[str] | str):
        items = [texts] if isinstance(texts, str) else texts
        try:
            return torch.cat([self.values[item] for item in items]), [1] * len(items)
        except KeyError as error:
            raise RuntimeError(f"no captured embedding for {error.args[0]!r}") from error


def main() -> None:
    args = options()
    if len(args.prompt) != len(args.frames) or len(args.prompt) != len(args.embedding):
        raise SystemExit("--prompt, --frames, and --embedding must occur equally often")
    if len(args.prompt) < 2:
        raise SystemExit("a multi-prompt fixture needs at least two prompts")
    if any(frame <= args.transition_frames for frame in args.frames):
        raise SystemExit("every segment must be longer than --transition-frames")
    upstream, checkpoint = args.upstream.resolve(), args.checkpoint_dir.resolve()
    if not (upstream / "kimodo").is_dir() or not (checkpoint / "Kimodo-SMPLX-RP-v1" / "config.yaml").is_file():
        raise SystemExit("expected an upstream checkout and local Kimodo-SMPLX-RP-v1 checkpoint")
    import os
    os.environ["CHECKPOINT_DIR"] = str(checkpoint)
    sys.path.insert(0, str(upstream))
    from kimodo import load_model  # pylint: disable=import-outside-toplevel

    # The NVIDIA PyTorch container enables TF32 globally.  Kimodo GGML uses
    # F32 accumulation for reference parity, so a CUDA capture must disable
    # Tensor Core TF32 before any model module is materialised.
    if args.device.startswith("cuda"):
        torch.backends.cuda.matmul.allow_tf32 = False
        torch.backends.cudnn.allow_tf32 = False
        torch.set_float32_matmul_precision("highest")
        # TransformerEncoder otherwise selects PyTorch's CUDA fast path,
        # whose fused attention reductions have a different F32 accumulation
        # order from Kimodo's explicit GGML attention graph.
        torch.backends.mha.set_fastpath_enabled(False)
        torch.backends.cuda.enable_flash_sdp(False)
        torch.backends.cuda.enable_mem_efficient_sdp(False)
        torch.backends.cuda.enable_math_sdp(True)

    torch.manual_seed(args.seed)
    encoder = CapturedEmbeddings(args.prompt, args.embedding)
    model, resolved = load_model("kimodo-smplx-rp", device=args.device,
                                 text_encoder=encoder, return_resolved_name=True)
    calls: list[dict[str, list[torch.Tensor] | torch.Tensor]] = []
    inverse_inputs: list[torch.Tensor] = []
    # The first inverse call decodes the tail of the preceding segment.  Keep
    # its exact FK products as a transition-encoder oracle for native ports.
    inverse_outputs: list[dict[str, torch.Tensor]] = []
    root_calls: list[tuple[tuple[torch.Tensor, ...], torch.Tensor]] = []
    body_calls: list[tuple[tuple[torch.Tensor, ...], torch.Tensor]] = []
    original_step = model.denoising_step

    def capture_step(*values: Any, **kwargs: Any) -> torch.Tensor:
        if not calls or len(calls[-1]["input"]) == args.steps:
            calls.append({
                "input": [], "output": [],
                "pad_mask": values[1].detach().clone(),
                "text_features": values[2].detach().clone(),
                "text_pad_mask": values[3].detach().clone(),
                "first_heading_angle": values[5].detach().clone(),
                "motion_mask": values[6].detach().clone(),
                "observed_motion": values[7].detach().clone(),
            })
        call = calls[-1]
        call["input"].append(values[0].detach().clone())  # type: ignore[index]
        result = original_step(*values, **kwargs)
        call["output"].append(result.detach().clone())  # type: ignore[index]
        return result

    def capture_stage(calls_for_stage: list[tuple[tuple[torch.Tensor, ...], torch.Tensor]]):
        def hook(_module: torch.nn.Module, values: tuple[Any, ...], output: torch.Tensor) -> None:
            if not calls_for_stage:
                calls_for_stage.append((
                    tuple(value.detach().clone() for value in values if isinstance(value, torch.Tensor)),
                    output.detach().clone(),
                ))
        return hook

    root_hook = model.denoiser.model.root_model.register_forward_hook(capture_stage(root_calls))
    body_hook = model.denoiser.model.body_model.register_forward_hook(capture_stage(body_calls))

    original_inverse = model.motion_rep.inverse

    def capture_inverse(motion: torch.Tensor, *values: Any, **kwargs: Any):
        inverse_inputs.append(motion.detach().clone())
        result = original_inverse(motion, *values, **kwargs)
        inverse_outputs.append({
            key: value.detach().clone()
            for key, value in result.items()
            if isinstance(value, torch.Tensor)
        })
        return result

    model.motion_rep.inverse = capture_inverse
    model.denoising_step = capture_step
    try:
        output = model(
            args.prompt, num_frames=args.frames, multi_prompt=True,
            num_denoising_steps=args.steps, num_samples=1,
            cfg_type="separated", cfg_weight=[2.0, 2.0],
            num_transition_frames=args.transition_frames, post_processing=False,
            return_numpy=True, progress_bar=lambda values: values,
        )
    finally:
        model.denoising_step = original_step
        model.motion_rep.inverse = original_inverse
        root_hook.remove()
        body_hook.remove()
    if len(calls) != len(args.prompt) or not inverse_inputs or not root_calls or not body_calls:
        raise RuntimeError(f"expected {len(args.prompt)} segment trajectories, got {len(calls)}")

    arrays: dict[str, np.ndarray] = {"stitched_motion_rep": as_f32(inverse_inputs[-1])}
    # `_multiprompt` calls inverse on the preceding tail before creating the
    # continuation constraints.  This is deliberately separate from the final
    # output decode below, whose first five frames have already been blended.
    if len(inverse_outputs) < 2:
        raise RuntimeError("expected transition-tail and final inverse calls")
    arrays["transition_source_motion"] = as_f32(inverse_inputs[0])
    for key, value in inverse_outputs[0].items():
        arrays["transition_source_" + key] = as_f32(value)
    for stage, stage_calls in (("root", root_calls), ("body", body_calls)):
        values, stage_output = stage_calls[0]
        arrays[f"{stage}_output"] = as_f32(stage_output)
        for index, value in enumerate(values):
            arrays[f"{stage}_input_{index}"] = as_f32(value)
    for index, call in enumerate(calls):
        prefix = f"segment_{index:02d}_"
        for name in ("pad_mask", "text_features", "text_pad_mask", "first_heading_angle", "motion_mask", "observed_motion"):
            arrays[prefix + name] = as_f32(call[name])  # type: ignore[arg-type,index]
        for step, (sample_in, sample_out) in enumerate(zip(call["input"], call["output"])):  # type: ignore[arg-type,index]
            arrays[f"{prefix}sampling_input_{step:03d}"] = as_f32(sample_in)
            arrays[f"{prefix}sampling_output_{step:03d}"] = as_f32(sample_out)
    for key, value in output.items():
        if isinstance(value, np.ndarray):
            arrays["motion_" + key] = value
    args.output.parent.mkdir(parents=True, exist_ok=True)
    archive = args.output.with_suffix(".npz")
    np.savez_compressed(archive, **arrays)
    try:
        revision = subprocess.check_output(
            ["git", "-c", "safe.directory=*", "-C", str(upstream), "rev-parse", "HEAD"], text=True).strip()
    except subprocess.CalledProcessError:
        revision = "unknown"
    notes = args.embedding_note + ["unspecified"] * (len(args.prompt) - len(args.embedding_note))
    metadata = {
        "fixture_format": 1, "upstream_revision": revision, "resolved_model": resolved,
        "prompts": args.prompt, "frames_per_segment": args.frames,
        "transition_frames": args.transition_frames, "diffusion_steps": args.steps,
        "seed": args.seed, "cfg_type": "separated", "cfg_weight": [2.0, 2.0],
        "post_processing": False, "device": args.device, "torch": torch.__version__,
        "cuda_tf32": torch.backends.cuda.matmul.allow_tf32 if args.device.startswith("cuda") else None,
        "cuda_mha_fastpath": torch.backends.mha.get_fastpath_enabled() if args.device.startswith("cuda") else None,
        "python": platform.python_version(), "embedding_sources": [
            {"path": str(path), "sha256": sha256(path), "note": note}
            for path, note in zip(args.embedding, notes)
        ], "checkpoint": {
            "revision": (checkpoint / "Kimodo-SMPLX-RP-v1" / "REVISION").read_text(encoding="utf-8").strip(),
            "model_safetensors_sha256": sha256(checkpoint / "Kimodo-SMPLX-RP-v1" / "model.safetensors"),
        }, "npz_sha256": sha256(archive),
    }
    args.output.with_suffix(".json").write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
