#pragma once

#include <cstddef>
#include <expected>
#include <span>
#include <string>
#include <vector>

namespace kimodo::detail {
class ggml_motion_weights;

// One sequence segment with an already-encoded text condition and caller-
// supplied initial noise. Continuation noise includes its transition prefix.
struct sampled_sequence_segment {
    std::span<const float> embedding;
    std::span<const float> initial_noise;
    std::size_t frames;
};

struct sequence_transition {
    std::vector<float> observed;
    std::vector<float> observed_mask;
    float first_heading = 0.F;
    float origin_x = 0.F;
    float origin_z = 0.F;
};

// F32 TransformerEncoderBlock. Inputs/outputs are row-major [B,T,D], while
// the implementation creates GGML [D,T,B] views over the same byte order.
std::expected<std::vector<float>, std::string> run_motion_transformer(
    const ggml_motion_weights &weights, std::string_view prefix,
    std::span<const float> motion, std::size_t motion_dim,
    std::span<const float> text_embedding, std::span<const float> timesteps,
    std::span<const float> headings, std::size_t batch, std::size_t frames);

// Exact two-stage Kimodo denoiser for concatenated motion/mask inputs
// [B,T,2*motion_dim]. Returned clean prediction is [B,T,motion_dim].
std::expected<std::vector<float>, std::string> run_two_stage_denoiser(
    const ggml_motion_weights &weights, std::span<const float> motion_and_mask,
    std::span<const float> text_embedding, std::span<const float> timesteps,
    std::span<const float> headings, std::span<const float> motion_mask,
    std::size_t batch, std::size_t frames);

// Unconstrained separated CFG wrapper. `motion` is [T,motion_dim], embedding
// is [4096], and the result is one clean prediction.
std::expected<std::vector<float>, std::string> run_separated_cfg_denoiser(
    const ggml_motion_weights &weights, std::span<const float> motion,
    std::span<const float> embedding, float timestep, float text_weight,
    float constraint_weight, std::size_t frames);

// Deterministic eta=0 DDIM sampling from caller-supplied F32 initial noise.
std::expected<std::vector<float>, std::string> sample_motion_from_noise(
    const ggml_motion_weights &weights, std::span<const float> initial_noise,
    std::span<const float> embedding, std::size_t frames, unsigned steps,
    float text_weight, float constraint_weight);

// Multi-prompt transition sampler. `observed` and `observed_mask` are [T,motion_dim]
// normalized motion-representation values/masks. This mirrors the upstream
// concat-mask denoiser: text, constraint, and unconditional CFG branches.
std::expected<std::vector<float>, std::string> sample_motion_from_noise_conditioned(
    const ggml_motion_weights &weights, std::span<const float> initial_noise,
    std::span<const float> embedding, std::span<const float> observed,
    std::span<const float> observed_mask, float first_heading, std::size_t frames,
    unsigned steps, float text_weight, float constraint_weight);

// End-to-end upstream `_multiprompt` orchestration.  DDIM operates in
// normalized motion space; the returned joined representation is raw so its
// translated roots and blended tail preserve upstream semantics.
std::expected<std::vector<float>, std::string> sample_motion_sequence_from_noise(
    const ggml_motion_weights &weights, std::span<const sampled_sequence_segment> segments,
    unsigned transition_frames, unsigned steps, float text_weight, float constraint_weight);

// Build the exact condition consumed by the next `_multiprompt` DDIM run.
// Exposed for the raw fixture test as well as the runtime orchestrator.
std::expected<sequence_transition, std::string> prepare_sequence_transition(
    const ggml_motion_weights &weights, std::span<const float> previous,
    std::size_t continuation_frames, unsigned transition_frames);
}
