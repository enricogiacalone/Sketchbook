#!/usr/bin/env python3
"""Safely convert one LLM2Vec Llama layer into a GGUF parity artifact.

This uses safetensors' documented raw layout only. It does not import torch or
deserialize pickle.  It preserves the upstream execution path: the MNTP
adapter is merged into BF16 base weights, while the supervised adapter remains
an F32 LoRA branch.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import struct
from dataclasses import dataclass
from pathlib import Path

import numpy as np

ALIGN, MAGIC, VERSION, F32, BF16 = 32, 0x46554747, 3, 0, 30
UINT32, UINT64, STRING = 4, 10, 8
TARGETS = ("self_attn.q_proj", "self_attn.k_proj", "self_attn.v_proj", "self_attn.o_proj", "mlp.gate_proj", "mlp.up_proj", "mlp.down_proj")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for part in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(part)
    return digest.hexdigest()


def pairs(items: list[tuple[str, object]]) -> dict[str, object]:
    result: dict[str, object] = {}
    for key, value in items:
        if key in result:
            raise ValueError(f"duplicate safetensors key: {key}")
        result[key] = value
    return result


@dataclass(frozen=True)
class Tensor:
    path: Path
    dtype: str
    shape: tuple[int, ...]
    offset: int

    def array(self) -> np.ndarray:
        dtype = {"BF16": "<u2", "F32": "<f4"}.get(self.dtype)
        if dtype is None:
            raise ValueError(f"unsupported tensor dtype {self.dtype}")
        return np.memmap(self.path, mode="r", dtype=dtype, offset=self.offset, shape=self.shape, order="C")


def safe_file(path: Path) -> dict[str, Tensor]:
    size = path.stat().st_size
    with path.open("rb") as stream:
        raw = stream.read(8)
        if len(raw) != 8:
            raise ValueError(f"{path}: truncated safetensors header")
        length = struct.unpack("<Q", raw)[0]
        if length > 128 * 1024 * 1024 or length > size - 8:
            raise ValueError(f"{path}: invalid safetensors header length")
        header = json.loads(stream.read(length), object_pairs_hook=pairs)
    if not isinstance(header, dict):
        raise ValueError(f"{path}: safetensors header is not an object")
    data = 8 + length
    result: dict[str, Tensor] = {}
    ranges: list[tuple[int, int]] = []
    for name, desc in header.items():
        if name == "__metadata__":
            continue
        if not isinstance(name, str) or not isinstance(desc, dict):
            raise ValueError(f"{path}: invalid tensor entry")
        dtype = desc.get("dtype")
        shape, offsets = desc.get("shape"), desc.get("data_offsets")
        if dtype not in ("BF16", "F32") or not isinstance(shape, list) or not isinstance(offsets, list) or len(offsets) != 2:
            raise ValueError(f"{path}: invalid tensor {name}")
        if not shape or any(not isinstance(dim, int) or dim <= 0 for dim in shape):
            raise ValueError(f"{path}: invalid shape for {name}")
        begin, end = offsets
        width = 2 if dtype == "BF16" else 4
        elements = int(np.prod(shape, dtype=np.int64))
        if not isinstance(begin, int) or not isinstance(end, int) or begin < 0 or end < begin or end > size - data or end - begin != elements * width:
            raise ValueError(f"{path}: invalid payload range for {name}")
        result[name] = Tensor(path, dtype, tuple(shape), data + begin)
        ranges.append((begin, end))
    for (_, previous), (begin, _) in zip(sorted(ranges), sorted(ranges)[1:]):
        if begin < previous:
            raise ValueError(f"{path}: overlapping payload ranges")
    return result


def f32(tensor: Tensor) -> np.ndarray:
    raw = tensor.array()
    if tensor.dtype == "F32":
        return np.asarray(raw, dtype=np.float32)
    # BF16 has the high 16 bits of IEEE-754 F32. This is an independent,
    # direct format conversion; no upstream framework code is used.
    return (np.asarray(raw, dtype=np.uint32) << 16).view(np.float32)


def bf16(value: np.ndarray) -> np.ndarray:
    """Round F32 to IEEE BF16 using round-to-nearest-even."""
    bits = np.asarray(value, dtype=np.float32).view(np.uint32)
    return ((bits + np.uint32(0x7FFF) + ((bits >> 16) & 1)) >> 16).astype("<u2")


def text(value: str) -> bytes:
    encoded = value.encode("utf-8")
    return struct.pack("<Q", len(encoded)) + encoded


def meta_string(key: str, value: str) -> bytes:
    return text(key) + struct.pack("<I", STRING) + text(value)


def meta_uint(key: str, value: int, kind: int = UINT64) -> bytes:
    return text(key) + struct.pack("<I", kind) + (struct.pack("<I", value) if kind == UINT32 else struct.pack("<Q", value))


def tensor_info(name: str, shape: tuple[int, ...], kind: int, offset: int) -> bytes:
    dims = tuple(reversed(shape))
    return text(name) + struct.pack("<I", len(dims)) + b"".join(struct.pack("<Q", dim) for dim in dims) + struct.pack("<I", kind) + struct.pack("<Q", offset)


def base_tensor(base_files: list[dict[str, Tensor]], name: str) -> Tensor:
    matches = [file[name] for file in base_files if name in file]
    if len(matches) != 1:
        raise ValueError(f"expected exactly one base tensor {name}, got {len(matches)}")
    return matches[0]


def merged_mntp(base: Tensor, adapter: dict[str, Tensor], name: str) -> np.ndarray:
    weight = f32(base).copy()
    prefix = "base_model." + name
    a = adapter.get(prefix + ".lora_A.weight")
    b = adapter.get(prefix + ".lora_B.weight")
    if not a or not b:
        raise ValueError(f"missing MNTP LoRA pair for {name}")
    av, bv = f32(a), f32(b)
    if av.shape[0] != 16 or bv.shape[1] != 16 or bv.shape[0] != weight.shape[0] or av.shape[1] != weight.shape[1]:
        raise ValueError(f"invalid MNTP LoRA shapes for {name}")
    return bf16(weight + (2.0 * (bv @ av)).astype(np.float32, copy=False))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", type=Path, required=True)
    parser.add_argument("--mntp-adapter", type=Path, required=True)
    parser.add_argument("--supervised-adapter", type=Path, required=True)
    target = parser.add_mutually_exclusive_group(required=True)
    target.add_argument("--layer", type=int, choices=range(32))
    target.add_argument("--final-norm", action="store_true", help="convert model.norm only")
    target.add_argument("--embedding", action="store_true", help="convert model.embed_tokens only")
    parser.add_argument("--output", type=Path, required=True)
    opt = parser.parse_args()
    index = opt.layer
    shards = sorted(opt.base.glob("model-*.safetensors"))
    if len(shards) != 4:
        raise SystemExit("--base must contain the four Llama safetensors shards")
    base = [safe_file(path) for path in shards]
    mntp_adapter = safe_file(opt.mntp_adapter / "adapter_model.safetensors")
    supervised_adapter = safe_file(opt.supervised_adapter / "adapter_model.safetensors")
    prefix = f"model.layers.{index}." if index is not None else ""
    if opt.final_norm:
        names: list[tuple[str, Tensor | None, int, str | None]] = [
            ("final_norm.weight", base_tensor(base, "model.norm.weight"), BF16, None),
        ]
    elif opt.embedding:
        names = [("token_embedding.weight", base_tensor(base, "model.embed_tokens.weight"), BF16, None)]
    else:
        names = [
            ("attn_norm.weight", base_tensor(base, prefix + "input_layernorm.weight"), BF16, None),
            ("ffn_norm.weight", base_tensor(base, prefix + "post_attention_layernorm.weight"), BF16, None),
        ]
        for target in TARGETS:
            short = target.replace("self_attn.", "attn_").replace("mlp.", "ffn_")
            names.append((short + "_base.weight", None, BF16, target))
            adapter_prefix = "base_model." + prefix + target
            names.append((short + "_lora_a.weight", supervised_adapter[adapter_prefix + ".lora_A.weight"], F32, None))
            names.append((short + "_lora_b.weight", supervised_adapter[adapter_prefix + ".lora_B.weight"], F32, None))
    offsets: list[int] = []
    cursor = 0
    shapes: list[tuple[int, ...]] = []
    for _, tensor, _, target in names:
        shape = tensor.shape if tensor else base_tensor(base, prefix + target + ".weight").shape
        shapes.append(shape)
        cursor = (cursor + ALIGN - 1) // ALIGN * ALIGN
        offsets.append(cursor)
        cursor += int(np.prod(shape, dtype=np.int64)) * (4 if names[len(shapes) - 1][2] == F32 else 2)
    metadata = [
        meta_string("general.architecture", "kimodo-llm2vec-layer"),
        meta_uint("general.alignment", ALIGN, UINT32),
        meta_uint("kimodo.format_version", 1),
        meta_string("kimodo.component", "final_norm" if opt.final_norm else "token_embedding" if opt.embedding else "transformer_layer"),
        meta_uint("kimodo.hidden_size", 4096),
        meta_uint("kimodo.heads", 32),
        meta_uint("kimodo.key_value_heads", 8),
        meta_uint("kimodo.rope_theta", 500000),
        meta_string("kimodo.lora_merge", "MNTP W + 2*B@A rounded to BF16; supervised W + 2*B@A evaluated as F32 LoRA branch"),
        meta_string("kimodo.base_sha256", ",".join(sha256(path) for path in shards)),
        meta_string("kimodo.mntp_adapter_sha256", sha256(opt.mntp_adapter / "adapter_model.safetensors")),
        meta_string("kimodo.supervised_adapter_sha256", sha256(opt.supervised_adapter / "adapter_model.safetensors")),
    ]
    header = struct.pack("<IIQQ", MAGIC, VERSION, len(names), len(metadata)) + b"".join(metadata)
    header += b"".join(tensor_info(name, shape, kind, offset) for (name, _, kind, _), shape, offset in zip(names, shapes, offsets))
    output = opt.output.resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_name(output.name + ".tmp")
    try:
        with temporary.open("wb") as stream:
            stream.write(header)
            stream.write(b"\0" * ((-len(header)) % ALIGN))
            written = 0
            for (name, tensor, kind, target), offset in zip(names, offsets):
                stream.write(b"\0" * (offset - written))
                value = (np.asarray(tensor.array(), dtype="<u2") if kind == BF16 and tensor else
                         f32(tensor) if tensor else
                         merged_mntp(base_tensor(base, prefix + target + ".weight"), mntp_adapter, prefix + target))
                stream.write(np.asarray(value, order="C").tobytes())
                written = offset + value.size * (2 if kind == BF16 else 4)
            stream.write(b"\0" * ((-written) % ALIGN))
        os.replace(temporary, output)
    finally:
        if temporary.exists():
            temporary.unlink()
    component = "final norm" if opt.final_norm else "token embedding" if opt.embedding else f"BF16 MNTP + F32 supervised LoRA layer {index}"
    print(f"wrote {output} ({output.stat().st_size} bytes, {component})")


if __name__ == "__main__":
    main()
