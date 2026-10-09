#pragma once
#include <expected>
#include <span>
#include <string>
#include <vector>
namespace kimodo::detail {
struct skeleton_spec;
struct decoded_motion { std::vector<float> local_xyzw, root_positions; };
std::expected<decoded_motion,std::string> decode_motion(std::span<const float> normalized, std::size_t frames, const skeleton_spec &skeleton, std::span<const float> global_mean, std::span<const float> global_std, std::span<const float> body_mean, std::span<const float> body_std);
std::expected<decoded_motion,std::string> decode_smplx22(std::span<const float> normalized, std::size_t frames, std::span<const float> global_mean, std::span<const float> global_std, std::span<const float> body_mean, std::span<const float> body_std);
}
