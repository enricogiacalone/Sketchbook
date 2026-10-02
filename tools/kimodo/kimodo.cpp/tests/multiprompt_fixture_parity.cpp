// Replay the upstream multi-prompt capture with its recorded initial noise.
// This isolates the motion transition from cross-framework RNG and text-model
// differences, while checking both DDIM trajectories and the final blend.
#include "denoiser.hpp"
#include "ggml_weights.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <stdexcept>
#include <string>
#include <vector>

namespace {
constexpr std::size_t features = 273;

std::vector<float> read(const std::string &path) {
    std::ifstream input(path, std::ios::binary | std::ios::ate);
    if (!input || input.tellg() < 0 || input.tellg() % static_cast<std::streamoff>(sizeof(float)))
        throw std::runtime_error("invalid fixture tensor: " + path);
    std::vector<float> value(static_cast<std::size_t>(input.tellg()) / sizeof(float));
    input.seekg(0);
    input.read(reinterpret_cast<char *>(value.data()), static_cast<std::streamsize>(value.size() * sizeof(float)));
    if (!input) throw std::runtime_error("short fixture tensor: " + path);
    return value;
}

struct error { float max_abs = 0; double relative_l2 = 0; };
error compare(const std::vector<float> &actual, const std::vector<float> &expected) {
    if (actual.size() != expected.size()) throw std::runtime_error("fixture shape mismatch");
    double squared_error = 0, squared_reference = 0;
    error result;
    for (std::size_t i = 0; i < actual.size(); ++i) {
        const float difference = actual[i] - expected[i];
        result.max_abs = std::max(result.max_abs, std::abs(difference));
        squared_error += static_cast<double>(difference) * difference;
        squared_reference += static_cast<double>(expected[i]) * expected[i];
    }
    result.relative_l2 = std::sqrt(squared_error / squared_reference);
    return result;
}

error compare_masked(const std::vector<float> &actual, const std::vector<float> &expected,
                     const std::vector<float> &mask) {
    if (actual.size() != expected.size() || actual.size() != mask.size())
        throw std::runtime_error("masked fixture shape mismatch");
    double squared_error = 0, squared_reference = 0;
    error result;
    for (std::size_t i = 0; i < actual.size(); ++i) {
        if (mask[i] == 0.F) continue;
        const float difference = actual[i] - expected[i];
        result.max_abs = std::max(result.max_abs, std::abs(difference));
        squared_error += static_cast<double>(difference) * difference;
        squared_reference += static_cast<double>(expected[i]) * expected[i];
    }
    result.relative_l2 = std::sqrt(squared_error / squared_reference);
    return result;
}

}

int main(int argc, char **argv) try {
    if (argc != 3) {
        std::fprintf(stderr, "usage: %s MOTION.gguf FIXTURE_DIR\n", argv[0]);
        return 2;
    }
    const std::string directory = std::string(argv[2]) + "/";
    auto weights = kimodo::detail::ggml_motion_weights::load(argv[1]);
    if (!weights) throw std::runtime_error(weights.error());

    const auto first = kimodo::detail::sample_motion_from_noise(
        **weights, read(directory + "segment_00_sampling_input_000.f32"),
        read(directory + "segment_00_text_features.f32"), 30, 2, 2.F, 2.F);
    if (!first) throw std::runtime_error(first.error());
    const auto first_error = compare(*first, read(directory + "segment_00_sampling_output_001.f32"));

    const auto heading = read(directory + "segment_01_first_heading_angle.f32");
    const auto second = kimodo::detail::sample_motion_from_noise_conditioned(
        **weights, read(directory + "segment_01_sampling_input_000.f32"),
        read(directory + "segment_01_text_features.f32"), read(directory + "segment_01_observed_motion.f32"),
        read(directory + "segment_01_motion_mask.f32"), heading.at(0), 35, 2, 2.F, 2.F);
    if (!second) throw std::runtime_error(second.error());
    const auto second_error = compare(*second, read(directory + "segment_01_sampling_output_001.f32"));

    auto prior=read(directory + "segment_00_sampling_output_001.f32");
    auto gm=(*weights)->f32_values("stats.global_root.mean"), gs=(*weights)->f32_values("stats.global_root.std");
    auto bm=(*weights)->f32_values("stats.body.mean"), bs=(*weights)->f32_values("stats.body.std");
    if (!gm || !gs || !bm || !bs) throw std::runtime_error("missing motion statistics");
    auto scale=[](float stddev) { return std::sqrt(stddev*stddev+1.e-5F); };
    for (std::size_t row=0;row<30;++row) { auto *v=prior.data()+row*features; for(std::size_t d=0;d<5;++d)v[d]=v[d]*scale((*gs)[d])+(*gm)[d]; for(std::size_t d=0;d<268;++d)v[5+d]=v[5+d]*scale((*bs)[d])+(*bm)[d]; }
    const auto transition=kimodo::detail::prepare_sequence_transition(**weights,prior,30,5);
    if (!transition) throw std::runtime_error(transition.error());
    auto actual_observed=transition->observed;
    for (std::size_t row=0;row<35;++row) { auto *v=actual_observed.data()+row*features; for(std::size_t d=0;d<5;++d)v[d]=(v[d]-(*gm)[d])/scale((*gs)[d]); for(std::size_t d=0;d<268;++d)v[5+d]=(v[5+d]-(*bm)[d])/scale((*bs)[d]); }
    const auto expected_observed=read(directory + "segment_01_observed_motion.f32");
    const auto expected_mask=read(directory + "segment_01_motion_mask.f32");
    const auto observed_error=compare_masked(actual_observed,expected_observed,expected_mask);
    std::size_t worst=0; float worst_value=0.F;
    for (std::size_t i=0;i<expected_mask.size();++i) if (expected_mask[i] != 0.F) {
        const float difference=std::abs(actual_observed[i]-expected_observed[i]);
        if (difference>worst_value) { worst_value=difference; worst=i; }
    }
    const auto mask_error=compare(transition->observed_mask,expected_mask);
    const float heading_error=std::abs(transition->first_heading-heading.at(0));
    const auto constructed_second=kimodo::detail::sample_motion_from_noise_conditioned(
        **weights, read(directory + "segment_01_sampling_input_000.f32"),
        read(directory + "segment_01_text_features.f32"), actual_observed, transition->observed_mask,
        transition->first_heading, 35, 2, 2.F, 2.F);
    if (!constructed_second) throw std::runtime_error(constructed_second.error());
    const auto constructed_error=compare(*constructed_second,read(directory + "segment_01_sampling_output_001.f32"));
    const auto first_noise=read(directory + "segment_00_sampling_input_000.f32");
    const auto first_text=read(directory + "segment_00_text_features.f32");
    const auto second_noise=read(directory + "segment_01_sampling_input_000.f32");
    const auto second_text=read(directory + "segment_01_text_features.f32");
    const std::array<kimodo::detail::sampled_sequence_segment, 2> segments{{
        {first_text, first_noise, 30}, {second_text, second_noise, 30},
    }};
    const auto joined=kimodo::detail::sample_motion_sequence_from_noise(
        **weights, segments, 5, 2, 2.F, 2.F);
    if (!joined) throw std::runtime_error(joined.error());
    const auto joined_error=compare(*joined,read(directory + "stitched_motion_rep.f32"));
    std::printf("segment0 max_abs=%g rel_l2=%g\nsegment1 max_abs=%g rel_l2=%g\ntransition observed max_abs=%g worst=%zu mask max_abs=%g heading_abs=%g constructed max_abs=%g stitched max_abs=%g\n",
                first_error.max_abs, first_error.relative_l2, second_error.max_abs, second_error.relative_l2,
                observed_error.max_abs, worst, mask_error.max_abs, heading_error, constructed_error.max_abs,
                joined_error.max_abs);
    return (first_error.max_abs <= 3.e-3F && second_error.max_abs <= 3.e-3F &&
            observed_error.max_abs <= 3.e-5F && mask_error.max_abs == 0.F && heading_error <= 2.e-3F &&
            joined_error.max_abs <= 3.e-3F) ? 0 : 1;
} catch (const std::exception &error) {
    std::fprintf(stderr, "multi-prompt fixture parity error: %s\n", error.what());
    return 1;
}
