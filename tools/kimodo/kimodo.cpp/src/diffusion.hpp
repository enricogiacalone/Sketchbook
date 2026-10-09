#pragma once

#include <cstdint>
#include <expected>
#include <string>
#include <vector>

namespace kimodo::detail {

struct diffusion_schedule {
    std::vector<std::uint32_t> use_timesteps;
    std::vector<float> alpha_cumprod;
    std::vector<float> alpha_cumprod_prev;
};

std::expected<diffusion_schedule, std::string> make_cosine_schedule(
    std::uint32_t base_steps, std::uint32_t sample_steps);

// In-place DDIM eta=0 update for a contiguous [B,T,D] F32 tensor.
std::expected<void, std::string> ddim_step(
    const diffusion_schedule &schedule, std::uint32_t index,
    const float *x_t, const float *pred_xstart, float *output,
    std::size_t values);

// Exact separated CFG chunk order from upstream: text, constraint, uncond.
std::expected<void, std::string> separated_cfg(
    const float *text, const float *constraint, const float *uncond,
    float text_weight, float constraint_weight, float *output,
    std::size_t values);

} // namespace kimodo::detail
