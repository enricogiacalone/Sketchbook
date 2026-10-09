// Developer utility: replay an upstream capture with the exact F32 embedding
// and initial diffusion noise, then emit GGML's comparable raw/decoded output.
#include "denoiser.hpp"
#include "ggml_weights.hpp"
#include "motion_decode.hpp"
#include "skeleton.hpp"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <stdexcept>
#include <string>
#include <vector>

namespace {
std::vector<float> read_f32(const std::filesystem::path &path) {
    std::ifstream input(path, std::ios::binary | std::ios::ate);
    if (!input) throw std::runtime_error("cannot read " + path.string());
    const auto bytes = input.tellg();
    if (bytes < 0 || bytes % static_cast<std::streamoff>(sizeof(float)) != 0)
        throw std::runtime_error("invalid F32 file " + path.string());
    std::vector<float> values(static_cast<size_t>(bytes) / sizeof(float));
    input.seekg(0);
    input.read(reinterpret_cast<char *>(values.data()), bytes);
    if (!input) throw std::runtime_error("short F32 file " + path.string());
    return values;
}

void write_f32(const std::filesystem::path &path, const std::vector<float> &values) {
    std::ofstream output(path, std::ios::binary | std::ios::trunc);
    if (!output) throw std::runtime_error("cannot write " + path.string());
    output.write(reinterpret_cast<const char *>(values.data()), static_cast<std::streamsize>(values.size() * sizeof(float)));
    if (!output) throw std::runtime_error("short write " + path.string());
}

float max_abs(const std::vector<float> &a, const std::vector<float> &b) {
    if (a.size() != b.size()) throw std::runtime_error("comparison size mismatch");
    float result = 0.f;
    for (size_t i = 0; i < a.size(); ++i) result = std::max(result, std::abs(a[i] - b[i]));
    return result;
}
} // namespace

int main(int argc, char **argv) try {
    if (argc != 6) {
        std::fprintf(stderr, "usage: %s MODEL.gguf FIXTURE_DIR FRAMES STEPS OUTPUT_DIR\n", argv[0]);
        return 2;
    }
    const auto frames = static_cast<size_t>(std::stoul(argv[3]));
    const auto steps = static_cast<unsigned>(std::stoul(argv[4]));
    if (frames == 0 || steps == 0) throw std::runtime_error("frames and steps must be positive");
    const std::filesystem::path fixture(argv[2]), output(argv[5]);
    const auto embedding = read_f32(fixture / "text_features.f32");
    const auto noise = read_f32(fixture / "sampling_initial_noise.f32");
    auto weights = kimodo::detail::ggml_motion_weights::load(argv[1]);
    if (!weights) throw std::runtime_error(weights.error());
    const auto *skeleton=kimodo::detail::find_skeleton((*weights)->skeleton_key());
    if (!skeleton || embedding.size() != 4096 || noise.size() != frames * skeleton->motion_dim())
        throw std::runtime_error("fixture does not match the requested embedding and model motion dimensions");
    auto sampled = kimodo::detail::sample_motion_from_noise(**weights, noise, embedding, frames, steps, 2.f, 2.f);
    if (!sampled) throw std::runtime_error(sampled.error());
    auto gm = (**weights).f32_values("stats.global_root.mean");
    auto gs = (**weights).f32_values("stats.global_root.std");
    auto bm = (**weights).f32_values("stats.body.mean");
    auto bs = (**weights).f32_values("stats.body.std");
    if (!gm || !gs || !bm || !bs) throw std::runtime_error("missing motion normalisation tensors");
    auto decoded = kimodo::detail::decode_motion(*sampled, frames, *skeleton, *gm, *gs, *bm, *bs);
    if (!decoded) throw std::runtime_error(decoded.error());
    std::filesystem::create_directories(output);
    write_f32(output / "sampling_final_state.f32", *sampled);
    write_f32(output / "motion_root_positions.f32", decoded->root_positions);
    write_f32(output / "motion_local_rotations_xyzw.f32", decoded->local_xyzw);
    const auto upstream = read_f32(fixture / "sampling_final_state.f32");
    std::printf("sampling_final_state max_abs=%g\n", max_abs(*sampled, upstream));
    return 0;
} catch (const std::exception &error) {
    std::fprintf(stderr, "%s\n", error.what());
    return 1;
}
