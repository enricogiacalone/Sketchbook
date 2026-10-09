#include "diffusion.hpp"

#include <cmath>
#include <limits>

namespace kimodo::detail {
std::expected<diffusion_schedule, std::string> make_cosine_schedule(
    std::uint32_t base_steps, std::uint32_t sample_steps) {
    if (base_steps < 2 || base_steps > 100000 || sample_steps < 1 || sample_steps > base_steps)
        return std::unexpected("invalid diffusion schedule step count");
    std::vector<float> base_alpha(base_steps);
    auto alpha_bar = [](double t) { return std::pow(std::cos((t + .008) / 1.008 * std::acos(-1.) / 2.), 2.); };
    double cumulative = 1.;
    for (std::uint32_t i = 0; i < base_steps; ++i) {
        const double beta = std::min(1. - alpha_bar(static_cast<double>(i + 1) / base_steps) /
                                         alpha_bar(static_cast<double>(i) / base_steps), .999);
        cumulative *= 1. - beta;
        base_alpha[i] = static_cast<float>(cumulative);
    }
    diffusion_schedule result;
    result.use_timesteps.reserve(sample_steps); result.alpha_cumprod.reserve(sample_steps); result.alpha_cumprod_prev.reserve(sample_steps);
    const double stride = static_cast<double>(base_steps - 1) / std::max<std::uint32_t>(1, sample_steps - 1);
    float previous = 1.f;
    for (std::uint32_t i = 0; i < sample_steps; ++i) {
        const auto t = std::min<std::uint32_t>(static_cast<std::uint32_t>(std::floor(i * stride + .5)), base_steps - 1);
        // PyTorch calculates a new beta sequence from selected alpha-bars,
        // then cumulative-products it; algebraically this is the same selected
        // value, while retaining the explicit predecessor for DDIM.
        const float alpha = std::max(base_alpha[t], 1.e-9f);
        result.use_timesteps.push_back(t); result.alpha_cumprod.push_back(alpha); result.alpha_cumprod_prev.push_back(previous); previous = alpha;
    }
    return result;
}

std::expected<void, std::string> ddim_step(const diffusion_schedule &s, std::uint32_t index,
    const float *x_t, const float *pred, float *out, std::size_t values) {
    if (!x_t || !pred || !out || index >= s.alpha_cumprod.size()) return std::unexpected("invalid DDIM input");
    const float alpha = s.alpha_cumprod[index], previous = s.alpha_cumprod_prev[index];
    if (!(alpha > 0.f && alpha <= 1.f && previous > 0.f && previous <= 1.f)) return std::unexpected("invalid DDIM alpha");
    const float reciprocal = 1.f / std::sqrt(alpha);
    // PyTorch's sqrt_recipm1_alphas_cumprod is
    // rsqrt(alpha / (1-alpha)) == sqrt((1-alpha) / alpha).
    const float reciprocal_m1 = std::sqrt((1.f - alpha) / alpha);
    for (std::size_t i = 0; i < values; ++i) {
        if (!std::isfinite(x_t[i]) || !std::isfinite(pred[i])) return std::unexpected("non-finite DDIM input");
        const float epsilon = (reciprocal * x_t[i] - pred[i]) / reciprocal_m1;
        out[i] = pred[i] * std::sqrt(previous) + std::sqrt(1.f - previous) * epsilon;
    }
    return {};
}

std::expected<void, std::string> separated_cfg(const float *text, const float *constraint, const float *uncond,
    float text_weight, float constraint_weight, float *out, std::size_t values) {
    if (!text || !constraint || !uncond || !out || !std::isfinite(text_weight) || !std::isfinite(constraint_weight))
        return std::unexpected("invalid separated CFG input");
    for (std::size_t i = 0; i < values; ++i) {
        if (!std::isfinite(text[i]) || !std::isfinite(constraint[i]) || !std::isfinite(uncond[i]))
            return std::unexpected("non-finite separated CFG input");
        out[i] = uncond[i] + text_weight * (text[i] - uncond[i]) + constraint_weight * (constraint[i] - uncond[i]);
    }
    return {};
}
} // namespace kimodo::detail
