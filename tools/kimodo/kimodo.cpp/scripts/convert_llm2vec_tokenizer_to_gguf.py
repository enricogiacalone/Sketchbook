#!/usr/bin/env python3
"""Convert a trusted Llama-3 tokenizer.json to a tokenizer-only GGUF.

The input is JSON, not a Python checkpoint.  The output deliberately keeps
the tokenizer separate from streamed weight shards so it is small and can be
validated/loaded without transformers.
"""
from __future__ import annotations

import argparse
import json
import struct
from pathlib import Path

MAGIC, VERSION, STRING, ARRAY, UINT32, UINT64 = 0x46554747, 3, 8, 9, 4, 10


def string(value: str) -> bytes:
    data = value.encode("utf-8")
    return struct.pack("<Q", len(data)) + data


def meta_string(key: str, value: str) -> bytes:
    return string(key) + struct.pack("<I", STRING) + string(value)


def meta_uint(key: str, value: int, kind: int = UINT64) -> bytes:
    return string(key) + struct.pack("<I", kind) + (struct.pack("<I", value) if kind == UINT32 else struct.pack("<Q", value))


def meta_strings(key: str, values: list[str]) -> bytes:
    return string(key) + struct.pack("<I", ARRAY) + struct.pack("<I", STRING) + struct.pack("<Q", len(values)) + b"".join(string(value) for value in values)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tokenizer", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    opt = parser.parse_args()
    source = json.loads(opt.tokenizer.read_text(encoding="utf-8"))
    model = source.get("model")
    if not isinstance(model, dict) or model.get("type") != "BPE":
        raise SystemExit("tokenizer must contain a BPE model")
    vocab, merges = model.get("vocab"), model.get("merges")
    if not isinstance(vocab, dict) or not isinstance(merges, list) or len(vocab) != 128000 or len(merges) != 280147:
        raise SystemExit("unexpected Llama-3 tokenizer vocabulary or merge count")
    tokens = [""] * len(vocab)
    for token, index in vocab.items():
        if not isinstance(token, str) or not isinstance(index, int) or index < 0 or index >= len(tokens) or tokens[index]:
            raise SystemExit("invalid or non-contiguous tokenizer vocabulary")
        tokens[index] = token
    if any(not token for token in tokens):
        raise SystemExit("tokenizer vocabulary has an empty entry")
    if not all(isinstance(merge, str) and " " in merge for merge in merges):
        raise SystemExit("invalid BPE merge list")
    metadata = [
        meta_string("general.architecture", "kimodo-llm2vec-tokenizer"),
        meta_uint("kimodo.format_version", 1),
        meta_string("kimodo.tokenizer", "llama3-byte-bpe"),
        meta_uint("kimodo.vocab_size", len(tokens), UINT32),
        meta_uint("kimodo.bos_token_id", 128000, UINT32),
        meta_strings("kimodo.tokenizer.tokens", tokens),
        meta_strings("kimodo.tokenizer.merges", merges),
    ]
    payload = struct.pack("<IIQQ", MAGIC, VERSION, 0, len(metadata)) + b"".join(metadata)
    opt.output.parent.mkdir(parents=True, exist_ok=True)
    opt.output.write_bytes(payload)
    print(f"wrote {opt.output} ({opt.output.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
