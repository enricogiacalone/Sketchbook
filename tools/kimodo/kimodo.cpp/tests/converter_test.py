#!/usr/bin/env python3
"""Focused hostile-input tests for the safe motion GGUF converter."""

from __future__ import annotations

import importlib.util
import json
import struct
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "convert_motion_to_gguf", ROOT / "scripts" / "convert_motion_to_gguf.py"
)
assert SPEC and SPEC.loader
CONVERTER = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = CONVERTER
SPEC.loader.exec_module(CONVERTER)


class ConverterInputTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / "input"

    def tearDown(self) -> None:
        self.temp.cleanup()

    def write_safe(self, header: str | dict, payload: bytes = b"\0" * 8) -> Path:
        encoded = header.encode() if isinstance(header, str) else json.dumps(header).encode()
        output = self.path.with_suffix(".safetensors")
        output.write_bytes(struct.pack("<Q", len(encoded)) + encoded + payload)
        return output

    def test_valid_f32_safetensors(self) -> None:
        path = self.write_safe({"weight": {"dtype": "F32", "shape": [2], "data_offsets": [0, 8]}})
        tensors = CONVERTER.read_safetensors(path)
        self.assertEqual([(item.name, item.shape, item.size) for item in tensors], [("weight", (2,), 8)])

    def test_safetensors_duplicate_json_key_is_rejected(self) -> None:
        path = self.write_safe('{"weight":{"dtype":"F32","shape":[1],"data_offsets":[0,4]},"weight":{"dtype":"F32","shape":[1],"data_offsets":[4,8]}}')
        with self.assertRaises(ValueError):
            CONVERTER.read_safetensors(path)

    def test_safetensors_out_of_range_and_overlap_are_rejected(self) -> None:
        out_of_range = self.write_safe({"weight": {"dtype": "F32", "shape": [2], "data_offsets": [0, 8]}}, b"\0" * 4)
        with self.assertRaises(ValueError):
            CONVERTER.read_safetensors(out_of_range)
        overlap = self.write_safe({
            "left": {"dtype": "F32", "shape": [1], "data_offsets": [0, 4]},
            "right": {"dtype": "F32", "shape": [1], "data_offsets": [2, 6]},
        })
        with self.assertRaises(ValueError):
            CONVERTER.read_safetensors(overlap)

    def write_npy(self, descriptor: str, payload: bytes) -> Path:
        output = self.path.with_suffix(".npy")
        header = descriptor.encode("latin1")
        output.write_bytes(b"\x93NUMPY" + bytes((1, 0)) + struct.pack("<H", len(header)) + header + payload)
        return output

    def test_npy_payload_and_layout_are_checked(self) -> None:
        valid = self.write_npy("{'descr': '<f4', 'fortran_order': False, 'shape': (2,), }", b"\0" * 8)
        self.assertEqual(CONVERTER.read_npy(valid, "stats.test").size, 8)
        truncated = self.write_npy("{'descr': '<f4', 'fortran_order': False, 'shape': (2,), }", b"\0" * 4)
        with self.assertRaises(ValueError):
            CONVERTER.read_npy(truncated, "stats.test")
        fortran = self.write_npy("{'descr': '<f4', 'fortran_order': True, 'shape': (1,), }", b"\0" * 4)
        with self.assertRaises(ValueError):
            CONVERTER.read_npy(fortran, "stats.test")


if __name__ == "__main__":
    unittest.main()
