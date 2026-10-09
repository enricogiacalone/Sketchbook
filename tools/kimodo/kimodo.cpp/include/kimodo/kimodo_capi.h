/*
 * kimodo_capi.h -- stable C ABI for kimodo.cpp.
 *
 * All entry points are implemented as an exception firewall.  Neural graph
 * execution is enabled only after its converted tensors pass reference tests.
 */
#pragma once

#include <stdint.h>

#if defined(KIMODO_SHARED)
#  if defined(_WIN32) && !defined(__MINGW32__)
#    if defined(KIMODO_BUILD)
#      define KIMODO_API __declspec(dllexport)
#    else
#      define KIMODO_API __declspec(dllimport)
#    endif
#  else
#    define KIMODO_API __attribute__((visibility("default")))
#  endif
#else
#  define KIMODO_API
#endif

#ifdef __cplusplus
extern "C" {
#endif

#define KIMODO_CAPI_ABI_VERSION 1

typedef struct kimodo_model kimodo_model;
typedef struct kimodo_motion kimodo_motion;

typedef enum kimodo_device {
    KIMODO_DEVICE_AUTO = 0,
    KIMODO_DEVICE_CPU = 1,
    KIMODO_DEVICE_VULKAN = 2,
} kimodo_device;

typedef struct kimodo_runtime_options {
    uint32_t size;              /* caller sets sizeof(kimodo_runtime_options) */
    uint32_t threads;           /* 0 selects the runtime default */
    kimodo_device device;
    const char *backend_dir;    /* NULL selects the executable/library directory */
} kimodo_runtime_options;

typedef struct kimodo_generation_options {
    uint32_t size;              /* caller sets sizeof(kimodo_generation_options) */
    uint64_t seed;
    uint32_t frames;
    uint32_t diffusion_steps;
    float text_cfg_weight;
    float constraint_cfg_weight;
} kimodo_generation_options;

/* A borrowed, row-major [1, 1, 4096] F32 LLM2Vec embedding. */
typedef struct kimodo_embedding {
    const float *data;
    uint32_t values;            /* must be exactly 4096 */
} kimodo_embedding;

/* Returns KIMODO_CAPI_ABI_VERSION. */
KIMODO_API int kimodo_abi_version(void);

/*
 * Load a converted motion model. `text_gguf` is optional only for a
 * precomputed-embedding workflow; ordinary prompt generation requires it.
 * `text_adapter_gguf` is the merged or separately converted LLM2Vec adapter.
 * On failure returns NULL and writes a NUL-terminated reason if `err` permits.
 */
KIMODO_API kimodo_model *kimodo_model_load(
    const char *motion_gguf,
    const char *text_gguf,
    const char *text_adapter_gguf,
    const kimodo_runtime_options *options,
    char *err,
    int err_len);

KIMODO_API void kimodo_model_free(kimodo_model *model);
KIMODO_API const char *kimodo_model_last_error(const kimodo_model *model);

/* Prompt is UTF-8. Returns an owning motion or NULL on failure. */
KIMODO_API kimodo_motion *kimodo_generate(
    kimodo_model *model,
    const char *prompt,
    const kimodo_generation_options *options,
    char *err,
    int err_len);

/*
 * Denoiser-only entry point.  This is the first supported integration
 * boundary and deliberately does not start Python or load a text runtime.
 */
KIMODO_API kimodo_motion *kimodo_generate_embedding(
    kimodo_model *model,
    const kimodo_embedding *embedding,
    const kimodo_generation_options *options,
    char *err,
    int err_len);

KIMODO_API void kimodo_motion_free(kimodo_motion *motion);
KIMODO_API int kimodo_motion_frames(const kimodo_motion *motion);
KIMODO_API int kimodo_motion_joints(const kimodo_motion *motion);
/* Borrowed row-major buffers, valid until kimodo_motion_free: [T,J,4], [T,3]. */
KIMODO_API const float *kimodo_motion_local_rotations_xyzw(const kimodo_motion *motion);
KIMODO_API const float *kimodo_motion_root_positions(const kimodo_motion *motion);

#ifdef __cplusplus
}
#endif
