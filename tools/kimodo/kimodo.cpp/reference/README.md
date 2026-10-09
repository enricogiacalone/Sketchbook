# PyTorch reference harness

This directory is intentionally separate from the C++ build.  It captures
trusted upstream tensors before conversion, so a future GGML graph is compared
at each boundary rather than only by subjective motion quality.

Set these paths for your machine. The upstream checkout and Hugging Face cache
remain outside this repository:

```sh
export KIMODO_UPSTREAM_DIR=/path/to/kimodo
export KIMODO_HF_CACHE=/path/to/huggingface-cache
export KIMODO_PROJECT_DIR="$PWD"
docker build -t kimodo-reference:upstream "$KIMODO_UPSTREAM_DIR"
```

Run a bundled upstream demo case, mounting source/checkpoints read-only and
this project writable.  The checkpoint downloader must already have populated
the supplied cache and the relevant model licence must have been accepted:

```sh
docker run --rm --gpus all \
  -v "$KIMODO_UPSTREAM_DIR:/opt/kimodo:ro" \
  -v "$KIMODO_HF_CACHE:/cache:ro" \
  -v "$KIMODO_PROJECT_DIR:/work" \
  -e HUGGINGFACE_CACHE_DIR=/cache \
  -e LOCAL_CACHE=True \
  kimodo-reference:upstream \
  python /work/reference/dump_kimodo_reference.py \
    --upstream /opt/kimodo \
    --model kimodo-smplx-rp \
    --prompt "A person runs forward and then leaps over an obstacle in front of them." \
    --frames 150 --steps 100 --seed 42 \
    --output /work/dumps/smplx-single-prompt
```

The first fixture deliberately disables motion post-processing.  The C++
MotionCorrection source is a separate algorithm with its own tests; mixing it
into the neural fixture would hide an inference mismatch.

For motion-only graph bring-up, a deterministic zero `[1,1,4096]` embedding
can be used without loading the 8B text model. It is a layer fixture, not a
text-quality result:

```sh
CHECKPOINT_DIR=/models python /work/reference/dump_kimodo_reference.py \
  --upstream /opt/kimodo --checkpoint-dir /models --zero-embedding \
  --model kimodo-smplx-rp --prompt fixture --frames 8 --steps 1 --seed 42 \
  --device cpu --output /work/dumps/smplx-zero-embedding
```

`dump_kimodo_reference.py` writes only NPZ/JSON.  It records the first root
and body transformer invocation (including all masks) plus the final sampled
motion.  More granular operations should be added one at a time as the GGML
implementation reaches them.
