#!/usr/bin/env python3
"""Convert a supported Kimodo motion safetensors checkpoint to GGUF.

This converter deliberately implements only the safe safetensors and NPY
formats.  It never imports torch, never deserializes pickle, and writes to a
temporary sibling before atomically publishing the GGUF.
"""
from __future__ import annotations

import argparse
import ast
import hashlib
import json
import os
import re
import struct
from dataclasses import dataclass
from pathlib import Path

ALIGNMENT = 32
GGUF_MAGIC, GGUF_VERSION, GGML_TYPE_F32 = 0x46554747, 3, 0
TYPE_UINT64, TYPE_STRING, TYPE_FLOAT32 = 10, 8, 6
TYPE_UINT32 = 4

MODEL_SPECS = {
    "nvidia/Kimodo-SMPLX-RP-v1": ("smplx22", "SMPLXSkeleton22", 22, False,
        "nvidia-internal-scientific-research-and-development-model-license"),
    "nvidia/Kimodo-SOMA-RP-v1.1": ("soma30", "SOMASkeleton30", 30, True, "nvidia-open-model-license"),
    "nvidia/Kimodo-SOMA-SEED-v1.1": ("soma30", "SOMASkeleton30", 30, True, "nvidia-open-model-license"),
    "nvidia/Kimodo-G1-RP-v1": ("g1skel34", "G1Skeleton34", 34, True, "nvidia-open-model-license"),
    "nvidia/Kimodo-G1-SEED-v1": ("g1skel34", "G1Skeleton34", 34, True, "nvidia-open-model-license"),
}

@dataclass(frozen=True)
class Tensor:
    name: str
    shape: tuple[int, ...]
    start: int
    size: int
    source: Path
    source_size: int | None = None


def checked_file_size(path: Path) -> int:
    size = path.stat().st_size
    if size < 0:
        raise ValueError(f"{path}: invalid file size")
    return size


def reject_duplicate_keys(pairs: list[tuple[str, object]]) -> dict[str, object]:
    result: dict[str, object] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"duplicate JSON key: {key}")
        result[key] = value
    return result

def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for part in iter(lambda: f.read(1024 * 1024), b""): h.update(part)
    return h.hexdigest()

def string(value: str) -> bytes:
    encoded = value.encode("utf-8")
    return struct.pack("<Q", len(encoded)) + encoded

def read_safetensors(path: Path) -> list[Tensor]:
    file_size = checked_file_size(path)
    if file_size < 8:
        raise ValueError(f"{path}: truncated safetensors header")
    with path.open("rb") as f:
        raw_header_len = f.read(8)
        if len(raw_header_len) != 8:
            raise ValueError(f"{path}: truncated safetensors header")
        header_len = struct.unpack("<Q", raw_header_len)[0]
        if header_len > 128 * 1024 * 1024 or header_len > file_size - 8:
            raise ValueError(f"{path}: safetensors header too large or truncated")
        raw_header = f.read(header_len)
    if len(raw_header) != header_len:
        raise ValueError(f"{path}: truncated safetensors header")
    try:
        header = json.loads(raw_header, object_pairs_hook=reject_duplicate_keys)
    except (UnicodeDecodeError, json.JSONDecodeError, ValueError) as error:
        raise ValueError(f"{path}: invalid safetensors JSON header") from error
    if not isinstance(header, dict):
        raise ValueError(f"{path}: safetensors header is not an object")
    data_start = 8 + header_len
    payload_size = file_size - data_start
    tensors: list[Tensor] = []
    ranges: list[tuple[int, int]] = []
    for name, desc in header.items():
        if name == "__metadata__": continue
        if not isinstance(name, str) or not name or len(name) > 4096 or not isinstance(desc, dict):
            raise ValueError(f"{path}: invalid safetensors tensor descriptor")
        if desc.get("dtype") != "F32": raise ValueError(f"{name}: expected F32, got {desc.get('dtype')}")
        raw_shape = desc.get("shape")
        raw_offsets = desc.get("data_offsets")
        if not isinstance(raw_shape, list) or not raw_shape or len(raw_shape) > 8:
            raise ValueError(f"{name}: malformed tensor shape")
        if not isinstance(raw_offsets, list) or len(raw_offsets) != 2:
            raise ValueError(f"{name}: malformed tensor byte range")
        if any(not isinstance(n, int) or isinstance(n, bool) or n <= 0 for n in raw_shape):
            raise ValueError(f"{name}: malformed tensor shape")
        if any(not isinstance(n, int) or isinstance(n, bool) for n in raw_offsets):
            raise ValueError(f"{name}: malformed tensor byte range")
        shape = tuple(raw_shape)
        start, end = raw_offsets
        if start < 0 or end < start or end > payload_size:
            raise ValueError(f"{name}: tensor byte range is outside safetensors payload")
        size = end - start
        expected = 4
        for n in shape: expected *= n
        if size != expected:
            raise ValueError(f"{name}: malformed tensor shape or byte range")
        ranges.append((start, end))
        tensors.append(Tensor(name.removeprefix("denoiser.backbone."), shape, data_start + start, size, path))
    for (_, previous_end), (start, _) in zip(sorted(ranges), sorted(ranges)[1:]):
        if start < previous_end:
            raise ValueError(f"{path}: overlapping safetensors tensor byte ranges")
    return sorted(tensors, key=lambda t: t.name)

def read_npy(path: Path, name: str) -> Tensor:
    file_size = checked_file_size(path)
    with path.open("rb") as f:
        if f.read(6) != b"\x93NUMPY": raise ValueError(f"{path}: not an NPY file")
        major, _ = struct.unpack("BB", f.read(2))
        if major not in (1, 2, 3): raise ValueError(f"{path}: unsupported NPY version")
        width = 2 if major == 1 else 4
        raw_header_len = f.read(width)
        if len(raw_header_len) != width: raise ValueError(f"{path}: truncated NPY header")
        header_len = struct.unpack("<H" if major == 1 else "<I", raw_header_len)[0]
        if header_len > 1024 * 1024 or header_len > file_size - (6 + 2 + width):
            raise ValueError(f"{path}: invalid NPY header length")
        header = f.read(header_len).decode("latin1")
    try:
        descriptor = ast.literal_eval(header)
    except (SyntaxError, ValueError) as error:
        raise ValueError(f"{path}: invalid NPY header") from error
    if not isinstance(descriptor, dict) or descriptor.get("fortran_order") is not False:
        raise ValueError(f"{path}: expected C-order NPY")
    is_f64 = descriptor.get("descr") == "<f8"
    if not is_f64 and descriptor.get("descr") != "<f4":
        raise ValueError(f"{path}: expected little-endian F32 or F64 NPY")
    raw_shape = descriptor.get("shape")
    if not isinstance(raw_shape, tuple) or not raw_shape or len(raw_shape) > 8 or any(not isinstance(n, int) or isinstance(n, bool) or n <= 0 for n in raw_shape):
        raise ValueError(f"{path}: invalid NPY shape")
    shape = raw_shape
    elements = 1
    for n in shape: elements *= n
    source_size = (8 if is_f64 else 4) * elements
    start = 6 + 2 + width + header_len
    if source_size > file_size - start:
        raise ValueError(f"{path}: truncated NPY payload")
    return Tensor(name, shape, start, 4 * elements, path, source_size)

def metadata_string(key: str, value: str) -> bytes:
    return string(key) + struct.pack("<I", TYPE_STRING) + string(value)

def metadata_uint(key: str, value: int) -> bytes:
    return string(key) + struct.pack("<I", TYPE_UINT64) + struct.pack("<Q", value)

def metadata_uint32(key: str, value: int) -> bytes:
    return string(key) + struct.pack("<I", TYPE_UINT32) + struct.pack("<I", value)

def metadata_float32(key: str, value: float) -> bytes:
    return string(key) + struct.pack("<I", TYPE_FLOAT32) + struct.pack("<f", value)

def tensor_info(tensor: Tensor, offset: int) -> bytes:
    # GGML stores dim 0 as the contiguous dimension. PyTorch F32 storage is
    # row-major, so reverse dimensions without changing the underlying bytes.
    dims = tuple(reversed(tensor.shape))
    return string(tensor.name) + struct.pack("<I", len(dims)) + b"".join(struct.pack("<Q", n) for n in dims) + struct.pack("<I", GGML_TYPE_F32) + struct.pack("<Q", offset)

def copy_range(dst, tensor: Tensor) -> None:
    with tensor.source.open("rb") as src:
        src.seek(tensor.start)
        remaining = tensor.source_size or tensor.size
        if remaining != tensor.size:
            # Upstream normalization statistics are F64. Convert them once at
            # the safe conversion boundary so all runtime tensors are F32.
            while remaining:
                raw = src.read(8)
                if len(raw) != 8: raise RuntimeError(f"unexpected EOF in {tensor.source}")
                dst.write(struct.pack("<f", struct.unpack("<d", raw)[0])); remaining -= 8
            return
        while remaining:
            block = src.read(min(8 * 1024 * 1024, remaining))
            if not block: raise RuntimeError(f"unexpected EOF in {tensor.source}")
            dst.write(block); remaining -= len(block)

def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--input", required=True, type=Path, help="downloaded Kimodo model directory")
    p.add_argument("--output", required=True, type=Path)
    args = p.parse_args()
    root = args.input.resolve()
    ckpt = root / "model.safetensors"
    if not ckpt.is_file(): raise SystemExit("missing model.safetensors")
    tensors = read_safetensors(ckpt)
    expected = 408
    if len(tensors) != expected: raise SystemExit(f"expected {expected} checkpoint tensors, got {len(tensors)}")
    for part in ("global_root", "local_root", "body"):
        for stat in ("mean", "std"):
            tensors.append(read_npy(root / "stats" / "motion" / part / f"{stat}.npy", f"stats.{part}.{stat}"))
    revision_fields = (root / "REVISION").read_text(encoding="utf-8").split()
    if len(revision_fields) != 2 or revision_fields[1] not in MODEL_SPECS:
        raise SystemExit("REVISION does not identify a supported official Kimodo model")
    revision, model_id = revision_fields
    skeleton, skeleton_class, joints, commercial, license_name = MODEL_SPECS[model_id]
    config = (root / "config.yaml").read_text(encoding="utf-8")
    if f"_target_: kimodo.skeleton.{skeleton_class}" not in config:
        raise SystemExit("config.yaml skeleton does not match REVISION model identity")
    motion_dim = 9 + 12 * joints
    body_dim = motion_dim - 5
    meta = [
        metadata_string("general.architecture", "kimodo-motion"),
        metadata_string("general.name", model_id.removeprefix("nvidia/")),
        # GGML's own loader requires general.alignment to be UINT32.
        metadata_uint32("general.alignment", ALIGNMENT),
        metadata_uint("kimodo.format_version", 1),
        metadata_string("kimodo.skeleton", skeleton),
        metadata_string("kimodo.model_identity", f"{model_id}@{revision}"),
        metadata_string("kimodo.license", license_name),
        metadata_uint("kimodo.commercial_use", int(commercial)),
        metadata_string("kimodo.source_revision", revision),
        metadata_string("kimodo.source_sha256", sha256(ckpt)),
        metadata_uint("kimodo.text_embedding_width", 4096),
        metadata_uint("kimodo.motion_dim", motion_dim),
        metadata_uint("kimodo.global_root_dim", 5),
        metadata_uint("kimodo.local_root_dim", 4),
        metadata_uint("kimodo.body_dim", body_dim),
        metadata_uint("kimodo.hidden_size", 1024),
        metadata_uint("kimodo.layers", 16),
        metadata_uint("kimodo.heads", 8),
        metadata_uint("kimodo.feed_forward_size", 2048),
        metadata_uint("kimodo.num_text_tokens", 50),
        metadata_uint("kimodo.base_diffusion_steps", 1000),
        metadata_uint("kimodo.fps", 30),
        # kimodo.motion_rep.stats.Stats uses sqrt(std**2 + eps).
        metadata_float32("kimodo.normalization_epsilon", 1.0e-5),
    ]
    offsets, cursor = [], 0
    for tensor in tensors:
        cursor = (cursor + ALIGNMENT - 1) // ALIGNMENT * ALIGNMENT
        offsets.append(cursor); cursor += tensor.size
    header = struct.pack("<IIQQ", GGUF_MAGIC, GGUF_VERSION, len(tensors), len(meta)) + b"".join(meta)
    header += b"".join(tensor_info(t, off) for t, off in zip(tensors, offsets))
    padding = (-len(header)) % ALIGNMENT
    output = args.output.resolve(); output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_name(output.name + ".tmp")
    try:
        with temporary.open("wb") as out:
            out.write(header); out.write(b"\0" * padding)
            written = 0
            for tensor, offset in zip(tensors, offsets):
                out.write(b"\0" * (offset - written)); copy_range(out, tensor); written = offset + tensor.size
            # GGML validates the complete aligned tensor blob, including the
            # final tensor's padding (not merely its logical data bytes).
            out.write(b"\0" * ((-written) % ALIGNMENT))
        os.replace(temporary, output)
    finally:
        if temporary.exists(): temporary.unlink()
    print(f"wrote {output} ({output.stat().st_size} bytes, {len(tensors)} F32 tensors)")

if __name__ == "__main__": main()
