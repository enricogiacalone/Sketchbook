#pragma once

#include <cstddef>
#include <expected>
#include <span>
#include <string>
#include <vector>

namespace kimodo::detail {

// Exact SMPL-X RP global-root -> local-root conditioning boundary.  Inputs and
// output are row-major [batch, frames, feature], with feature widths 5 and 4.
std::expected<std::vector<float>, std::string> global_root_to_local_root(
    std::span<const float> normalized_global_root,
    std::span<const float> motion_mask,
    std::size_t batch, std::size_t frames,
    std::span<const float> global_mean, std::span<const float> global_std,
    std::span<const float> local_mean, std::span<const float> local_std,
    float fps = 30.f);

} // namespace kimodo::detail
