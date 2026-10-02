#!/usr/bin/env python3
"""Publish the reproducible Kimodo GGUF distribution to Hugging Face.

The default is deliberately a dry run: it validates the exact converter
outputs, prints every path, size and SHA-256, and performs no network I/O.
Use --upload only after reviewing the upstream licence obligations.

The text bundle contains merged Meta Llama 3 weights and is published separately
from the Kimodo motion model, so the latter keeps a direct relationship to its
upstream NVIDIA model repository.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
HF_ORG = "LocalAI-io"  # Hugging Face organisation; GitHub is localai-org.
DEFAULT_REPOS = {
    "text": f"{HF_ORG}/Llama-3-Kimodo-GGML",
}
MOTION_MODELS = {
    "smplx-rp-v1": {
        "repo": f"{HF_ORG}/Kimodo-SMPLX-RP-v1-GGML",
        "source": "nvidia/Kimodo-SMPLX-RP-v1",
        "folder": "Kimodo-SMPLX-RP-v1",
        "revision": "1419ba56b734c48bbafb41fefa84088ca94583b5",
        "file": "kimodo-smplx-rp-v1-f32.gguf",
        "redistributable": False,
    },
    "soma-rp-v1.1": {
        "repo": f"{HF_ORG}/Kimodo-SOMA-RP-v1.1-GGML",
        "source": "nvidia/Kimodo-SOMA-RP-v1.1",
        "folder": "Kimodo-SOMA-RP-v1.1",
        "revision": "6c9233af1180b8151e3c4703477104af5dce9dd5",
        "file": "kimodo-soma-rp-v1.1-f32.gguf",
        "redistributable": True,
    },
    "soma-seed-v1.1": {
        "repo": f"{HF_ORG}/Kimodo-SOMA-SEED-v1.1-GGML",
        "source": "nvidia/Kimodo-SOMA-SEED-v1.1",
        "folder": "Kimodo-SOMA-SEED-v1.1",
        "revision": "aae3af194322c60d21bc44062b64c3fec912be50",
        "file": "kimodo-soma-seed-v1.1-f32.gguf",
        "redistributable": True,
    },
    "g1-rp-v1": {
        "repo": f"{HF_ORG}/Kimodo-G1-RP-v1-GGML",
        "source": "nvidia/Kimodo-G1-RP-v1",
        "folder": "Kimodo-G1-RP-v1",
        "revision": "3020ad8c419c244e0429d360163730c63c4ed011",
        "file": "kimodo-g1-rp-v1-f32.gguf",
        "redistributable": True,
    },
    "g1-seed-v1": {
        "repo": f"{HF_ORG}/Kimodo-G1-SEED-v1-GGML",
        "source": "nvidia/Kimodo-G1-SEED-v1",
        "folder": "Kimodo-G1-SEED-v1",
        "revision": "5e6f2c7e18c2ab834c8d7983b9dcce701e5c6097",
        "file": "kimodo-g1-seed-v1-f32.gguf",
        "redistributable": True,
    },
}
TEXT_NAMES = (
    "tokenizer.gguf", "embedding.gguf", "final-norm.gguf",
    *(f"layer-{index:02d}.gguf" for index in range(32)),
)
SOURCE_REVISIONS = {
    "meta-llama/Meta-Llama-3-8B-Instruct": "8afb486c1db24fe5011ec46dfbe5b5dccdb575c2",
    "McGill-NLP/LLM2Vec-Meta-Llama-3-8B-Instruct-mntp": "31474e395ada192e8ed1586db6be79fb3b70c9c0",
    "McGill-NLP/LLM2Vec-Meta-Llama-3-8B-Instruct-mntp-supervised": "baa8ebf04a1c2500e61288e7dad65e8ae42601a7",
}
LLAMA_LICENSE = ROOT / "models/llama3-8b-instruct-base/LICENSE"


def digest(path: Path) -> str:
    value = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()


def require_revision(repo: str, expected: str, folder: str | None = None) -> None:
    revision = ROOT / "models" / (folder or {
        "meta-llama/Meta-Llama-3-8B-Instruct": "llama3-8b-instruct-base",
        "McGill-NLP/LLM2Vec-Meta-Llama-3-8B-Instruct-mntp": "llm2vec-mntp-adapter",
        "McGill-NLP/LLM2Vec-Meta-Llama-3-8B-Instruct-mntp-supervised": "llm2vec-adapter",
    }[repo]) / "REVISION"
    if not revision.is_file():
        raise ValueError(f"missing provenance file: {revision}")
    actual = revision.read_text(encoding="utf-8").split()[0]
    if actual != expected:
        raise ValueError(f"unexpected {repo} revision: {actual} (expected {expected})")


def artifacts(component: str, motion: Path, motion_name: str, bundle: Path) -> list[tuple[Path, str]]:
    result: list[tuple[Path, str]] = []
    if component == "motion":
        result.append((motion, f"models/{motion_name}"))
    else:
        result.extend((bundle / name, f"generated/llm2vec-text-bundle/{name}") for name in TEXT_NAMES)
    for source, destination in result:
        if not source.is_file() or source.stat().st_size == 0:
            raise ValueError(f"missing or empty GGUF: {source}")
        if source.suffix != ".gguf":
            raise ValueError(f"not a GGUF: {source}")
        with source.open("rb") as handle:
            if handle.read(4) != b"GGUF":
                raise ValueError(f"invalid GGUF magic: {source}")
        if ".." in Path(destination).parts:
            raise ValueError(f"unsafe destination: {destination}")
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--motion", type=Path, default=None,
                        help="motion GGUF (defaults to the selected model's converted output)")
    parser.add_argument("--motion-model", choices=tuple(MOTION_MODELS), default="soma-rp-v1.1")
    parser.add_argument("--text-bundle", type=Path,
                        default=ROOT / "generated/llm2vec-text-bundle")
    parser.add_argument("--component", choices=("text", "motion"), required=True,
                        help="which independently licensed distribution to publish")
    parser.add_argument("--repo", default=None, help="override the component's HF repository")
    parser.add_argument("--upload", action="store_true",
                        help="actually create/update the Hugging Face model repo")
    parser.add_argument("--confirm-upstream-licences", action="store_true",
                        help="required with --upload; confirms authority to redistribute all inputs")
    args = parser.parse_args()
    motion_spec = MOTION_MODELS[args.motion_model]
    if args.component == "motion" and args.upload and not motion_spec["redistributable"]:
        print("error: the SMPL-X checkpoint licence prohibits distributing Derivative Models; local conversion only",
              file=sys.stderr)
        return 2
    motion = args.motion or ROOT / "models" / motion_spec["file"]
    repo = args.repo or (DEFAULT_REPOS["text"] if args.component == "text" else motion_spec["repo"])
    card_dir = ROOT / "scripts/hf" / ("Llama-3-Kimodo-GGML" if args.component == "text" else repo.rsplit("/", 1)[1])
    card = card_dir / "README.md"
    notice = card_dir / "NOTICE"
    relevant_sources = (SOURCE_REVISIONS if args.component == "text"
                        else {motion_spec["source"]: motion_spec["revision"]})

    try:
        if not card.is_file() or not notice.is_file():
            raise ValueError("version-controlled model card or NOTICE is missing")
        if args.component == "text" and not LLAMA_LICENSE.is_file():
            raise ValueError("Meta Llama 3 licence is missing")
        for source_repo, revision in relevant_sources.items():
            folder = motion_spec["folder"] if args.component == "motion" else None
            require_revision(source_repo, revision, folder)
        files = artifacts(args.component, motion, motion_spec["file"], args.text_bundle)
    except ValueError as error:
        print(f"error: {error}", file=sys.stderr)
        return 1

    entries = []
    for source, destination in files:
        entries.append({"path": destination, "bytes": source.stat().st_size, "sha256": digest(source)})
    manifest = {
        "format": "kimodo-gguf-manifest-v1",
        "repository": repo,
        "component": args.component,
        "source_revisions": relevant_sources,
        "files": entries,
    }
    sums = "".join(f"{entry['sha256']}  {entry['path']}\n" for entry in entries)
    total = sum(entry["bytes"] for entry in entries)

    print(f"repo:  https://huggingface.co/{repo}")
    print(f"files: {len(entries)} GGUFs, {total / 1e9:.2f} GB")
    for entry in entries:
        print(f"  {entry['sha256']}  {entry['bytes']:>12}  {entry['path']}")
    if not args.upload:
        print("\n[dry-run] nothing uploaded. Re-run with --upload --confirm-upstream-licences to publish.")
        return 0
    if not args.confirm_upstream_licences:
        print("error: --upload requires --confirm-upstream-licences", file=sys.stderr)
        return 2

    from huggingface_hub import HfApi
    api = HfApi()
    api.create_repo(repo, repo_type="model", exist_ok=True)
    uploads = [(card, "README.md"), (notice, "NOTICE")]
    if args.component == "text":
        uploads.append((LLAMA_LICENSE, "LICENSE-META-LLAMA-3.txt"))
    for source, destination in uploads + files:
        print(f"uploading {destination} ...", flush=True)
        api.upload_file(path_or_fileobj=str(source), path_in_repo=destination,
                        repo_id=repo, repo_type="model",
                        commit_message=f"Add {destination}")
    for payload, destination in ((json.dumps(manifest, indent=2, sort_keys=True).encode() + b"\n", "MANIFEST.json"),
                                 (sums.encode(), "SHA256SUMS")):
        print(f"uploading {destination} ...", flush=True)
        api.upload_file(path_or_fileobj=io.BytesIO(payload), path_in_repo=destination,
                        repo_id=repo, repo_type="model",
                        commit_message=f"Add {destination}")
    print(f"done -> https://huggingface.co/{repo}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
