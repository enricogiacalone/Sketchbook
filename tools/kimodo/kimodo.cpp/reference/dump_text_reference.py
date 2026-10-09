#!/usr/bin/env python3
"""Capture a real LLM2Vec prompt fixture from the upstream Kimodo encoder."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import sys

import numpy as np
import torch


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--upstream", type=Path, required=True)
    parser.add_argument("--base", type=Path, required=True)
    parser.add_argument("--mntp-adapter", type=Path, required=True)
    parser.add_argument("--supervised-adapter", type=Path, required=True)
    parser.add_argument("--prompt", required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--device", default="cuda")
    parser.add_argument("--debug-layer", type=int, default=0, choices=range(32), help="capture module checkpoints for this transformer layer")
    return parser.parse_args()


def as_f32(value: torch.Tensor) -> np.ndarray:
    return value.detach().to(device="cpu", dtype=torch.float32).contiguous().numpy()


def main() -> None:
    opt = args()
    if not (opt.upstream / "kimodo").is_dir():
        raise SystemExit("--upstream is not a Kimodo checkout")
    if any(not path.is_dir() for path in (opt.base, opt.mntp_adapter, opt.supervised_adapter)):
        raise SystemExit("all model paths must be existing directories")
    sys.path.insert(0, str(opt.upstream.resolve()))
    from kimodo.model.llm2vec import LLM2Vec  # pylint: disable=import-outside-toplevel
    from kimodo.model.llm2vec.llm2vec import batch_to_device  # pylint: disable=import-outside-toplevel
    from peft import PeftModel  # pylint: disable=import-outside-toplevel

    torch.manual_seed(42)
    encoder = LLM2Vec.from_pretrained(
        str(opt.base), peft_model_name_or_path=str(opt.mntp_adapter), merge_peft=True, torch_dtype=torch.bfloat16,
    )
    encoder.model = PeftModel.from_pretrained(encoder.model, str(opt.supervised_adapter))
    encoder.to(opt.device).eval()
    for parameter in encoder.parameters():
        parameter.requires_grad = False

    prepared = encoder.prepare_for_tokenization(encoder._convert_to_str("", opt.prompt))
    features = encoder.tokenize([prepared])
    recorded_features = {name: value.detach().cpu().numpy() for name, value in features.items()}
    features = batch_to_device(features, opt.device)
    layer_values: list[torch.Tensor | None] = [None] * 32
    embedding_values: list[torch.Tensor] = []
    layer0_values: dict[str, torch.Tensor] = {}
    layer_hooks = []
    debug_modules = {
        "debug_input_norm": f"layers.{opt.debug_layer}.input_layernorm",
        "debug_q": f"layers.{opt.debug_layer}.self_attn.q_proj",
        "debug_k": f"layers.{opt.debug_layer}.self_attn.k_proj",
        "debug_v": f"layers.{opt.debug_layer}.self_attn.v_proj",
        "debug_o": f"layers.{opt.debug_layer}.self_attn.o_proj",
        "debug_post_norm": f"layers.{opt.debug_layer}.post_attention_layernorm",
        "debug_gate": f"layers.{opt.debug_layer}.mlp.gate_proj",
        "debug_up": f"layers.{opt.debug_layer}.mlp.up_proj",
        "debug_down": f"layers.{opt.debug_layer}.mlp.down_proj",
    }
    for name, module in encoder.model.named_modules():
        if name.endswith("embed_tokens"):
            layer_hooks.append(module.register_forward_hook(lambda _m, _i, o: embedding_values.append(o)))
        for output_name, suffix in debug_modules.items():
            if name.endswith(suffix):
                layer_hooks.append(module.register_forward_hook(
                    lambda _m, _i, o, output_name=output_name: layer0_values.__setitem__(output_name, o[0] if isinstance(o, tuple) else o)
                ))
        for index in range(32):
            if name.endswith(f"layers.{index}"):
                layer_hooks.append(module.register_forward_hook(
                    lambda _m, _i, o, index=index: layer_values.__setitem__(index, o[0] if isinstance(o, tuple) else o)
                ))
    try:
        with torch.inference_mode():
            reps = encoder.model(**features)
            pooled = encoder.get_pooling(features, reps.last_hidden_state)
    finally:
        for hook in layer_hooks:
            hook.remove()
    if len(embedding_values) != 1 or any(value is None for value in layer_values) or set(layer0_values) != set(debug_modules):
        raise RuntimeError("did not observe exactly one embedding and every Llama layer")
    arrays: dict[str, np.ndarray] = {
        "input_ids": recorded_features["input_ids"].astype(np.int64),
        "attention_mask": recorded_features["attention_mask"].astype(np.int64),
        "embed_mask": recorded_features["embed_mask"].astype(np.int64),
        "token_embeddings": as_f32(embedding_values[0]),
        "final_hidden_state": as_f32(reps.last_hidden_state),
        "pooled_embedding": as_f32(pooled),
    }
    for index, value in enumerate(layer_values):
        arrays[f"layer_{index:02d}_output"] = as_f32(value)  # type: ignore[arg-type]
    for name, value in layer0_values.items():
        arrays[name] = as_f32(value)
    opt.output.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(opt.output.with_suffix(".npz"), **arrays)
    metadata = {
        "fixture_format": 1,
        "prompt": opt.prompt,
        "prepared_text": prepared,
        "device": opt.device,
        "torch": torch.__version__,
        "cuda": torch.version.cuda,
        "base_sha256": {path.name: sha256(path) for path in opt.base.glob("*.safetensors")},
        "mntp_adapter_sha256": sha256(opt.mntp_adapter / "adapter_model.safetensors"),
        "supervised_adapter_sha256": sha256(opt.supervised_adapter / "adapter_model.safetensors"),
        "npz_sha256": sha256(opt.output.with_suffix(".npz")),
        "debug_layer": opt.debug_layer,
    }
    opt.output.with_suffix(".json").write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
