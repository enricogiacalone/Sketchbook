#!/usr/bin/env python3
"""Extract an upstream Kimodo NPZ capture into checked raw F32 tensors.

The raw files are intentionally dependency-free inputs for the C++ parity
tests and demo tooling.  ``shapes.json`` preserves every original array shape
and dtype; integral arrays stay integral while floating arrays are canonical
little-endian F32.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path, help="upstream .npz capture")
    parser.add_argument("output", type=Path, help="output fixture directory")
    args = parser.parse_args()

    if args.input.suffix != ".npz" or not args.input.is_file():
        raise SystemExit("input must be an existing .npz file")
    args.output.mkdir(parents=True, exist_ok=True)
    shapes: dict[str, dict[str, object]] = {}
    with np.load(args.input, allow_pickle=False) as archive:
        for name in sorted(archive.files):
            value = np.ascontiguousarray(archive[name])
            if value.dtype.kind == "f":
                value = np.asarray(value, dtype="<f4")
                suffix = ".f32"
            elif value.dtype.kind in "iu":
                value = np.asarray(value, dtype="<i8")
                suffix = ".i64"
            elif value.dtype.kind == "b":
                value = np.asarray(value, dtype="u1")
                suffix = ".u8"
            else:
                raise SystemExit(f"unsupported capture tensor {name}: {value.dtype}")
            (args.output / f"{name}{suffix}").write_bytes(value.tobytes())
            shapes[name] = {"shape": list(value.shape), "dtype": str(value.dtype), "file": f"{name}{suffix}"}
    (args.output / "shapes.json").write_text(json.dumps(shapes, indent=2, sort_keys=True) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
