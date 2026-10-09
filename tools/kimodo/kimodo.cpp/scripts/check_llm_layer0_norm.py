#!/usr/bin/env python3
"""Check the layer-0 RMSNorm fixture against its safetensors F32 calculation.

This imports only the project's safe safetensors reader; it deliberately does
not import torch or deserialize a PyTorch checkpoint.
"""
from __future__ import annotations

import argparse
import importlib.util
import sys
from pathlib import Path

import numpy as np


def load_converter():
    path = Path(__file__).with_name("convert_llm2vec_layer_to_gguf.py")
    spec = importlib.util.spec_from_file_location("llm2vec_converter", path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def max_abs(a: np.ndarray, b: np.ndarray) -> float:
    return float(np.max(np.abs(a - b)))


def bf16(value: np.ndarray) -> np.ndarray:
    bits = value.view(np.uint32)
    rounded_bits = (bits + np.uint32(0x7FFF) + ((bits >> 16) & 1)) & np.uint32(0xFFFF0000)
    return rounded_bits.view(np.float32)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", type=Path, required=True)
    parser.add_argument("--fixture", type=Path, required=True)
    opt = parser.parse_args()
    converter = load_converter()
    shards = [converter.safe_file(path) for path in sorted(opt.base.glob("model-*.safetensors"))]
    weight = converter.f32(converter.base_tensor(shards, "model.layers.0.input_layernorm.weight"))
    x = np.fromfile(opt.fixture / "token_embeddings.f32", dtype="<f4").reshape(16, 4096)
    expected = np.fromfile(opt.fixture / "layer0_input_norm.f32", dtype="<f4").reshape(16, 4096)
    actual = (x * np.reciprocal(np.sqrt(np.mean(x * x, axis=-1, keepdims=True) + 1e-5))) * weight
    print(f"f32 max_abs={max_abs(actual, expected):g}")
    print(f"bf16-final max_abs={max_abs(bf16(actual), expected):g}")
    normalized = x * np.reciprocal(np.sqrt(np.mean(x * x, axis=-1, keepdims=True) + 1e-5))
    print(f"transformers-rmsnorm max_abs={max_abs(bf16(bf16(normalized) * weight), expected):g}")


if __name__ == "__main__":
    main()
