#!/usr/bin/env python3
"""Build comparable 22-joint positions from a GGML decoded-motion replay.

The current C++ motion decoder emits root translation and local rotations.  For
fixture visualisation, this tool calibrates the fixed SMPL-X22 bone offsets
from upstream's posed-joint/global-rotation capture, applies C++ local
rotations with forward kinematics, and writes a raw [T,22,3] F32 trajectory.
It is a test/demo bridge, not part of the runtime inference dependency set.
"""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np

PARENTS = np.array([-1, 0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 9, 9, 12, 13, 14, 16, 17, 18, 19])


def read(path: Path, shape: tuple[int, ...]) -> np.ndarray:
    value = np.fromfile(path, dtype="<f4")
    if value.size != int(np.prod(shape)):
        raise SystemExit(f"{path}: expected {shape}, got {value.size} values")
    return value.reshape(shape)


def quaternions_to_matrix(q: np.ndarray) -> np.ndarray:
    x, y, z, w = np.moveaxis(q, -1, 0)
    return np.stack((
        1 - 2 * (y*y + z*z), 2 * (x*y - z*w), 2 * (x*z + y*w),
        2 * (x*y + z*w), 1 - 2 * (x*x + z*z), 2 * (y*z - x*w),
        2 * (x*z - y*w), 2 * (y*z + x*w), 1 - 2 * (x*x + y*y),
    ), axis=-1).reshape(q.shape[:-1] + (3, 3))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("fixture", type=Path)
    parser.add_argument("ggml", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    shapes = __import__("json").loads((args.fixture / "shapes.json").read_text())
    frames = int(shapes["motion_posed_joints"]["shape"][1])
    upstream_pos = read(args.fixture / "motion_posed_joints.f32", (frames, 22, 3))
    upstream_global = read(args.fixture / "motion_global_rot_mats.f32", (frames, 22, 3, 3))
    root = read(args.ggml / "motion_root_positions.f32", (frames, 3))
    local = read(args.ggml / "motion_local_rotations_xyzw.f32", (frames, 22, 4))

    # Bone vectors are constant in the parent local space; average all frames
    # to remove the small numerical error in the recorded pose transforms.
    offsets = np.zeros((22, 3), dtype=np.float32)
    for joint in range(1, 22):
        parent = PARENTS[joint]
        world = upstream_pos[:, joint] - upstream_pos[:, parent]
        offsets[joint] = np.einsum("tji,tj->ti", upstream_global[:, parent], world).mean(axis=0)

    local_matrix = quaternions_to_matrix(local)
    global_matrix = np.empty_like(local_matrix)
    positions = np.empty((frames, 22, 3), dtype=np.float32)
    global_matrix[:, 0] = local_matrix[:, 0]
    positions[:, 0] = root
    for joint in range(1, 22):
        parent = PARENTS[joint]
        global_matrix[:, joint] = global_matrix[:, parent] @ local_matrix[:, joint]
        positions[:, joint] = positions[:, parent] + np.einsum("tij,j->ti", global_matrix[:, parent], offsets[joint])
    args.output.parent.mkdir(parents=True, exist_ok=True)
    positions.astype("<f4").tofile(args.output)
    difference = positions - upstream_pos
    print(f"joint max_abs={np.abs(difference).max():.7g} rms={np.sqrt(np.mean(difference*difference)):.7g}")


if __name__ == "__main__":
    main()
