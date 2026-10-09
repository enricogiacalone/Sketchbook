#include "denoiser.hpp"
#include "ggml_weights.hpp"
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <fstream>
#include <stdexcept>
#include <string>
#include <vector>

static std::vector<float> read(const std::string &path) {
    std::ifstream input(path, std::ios::binary | std::ios::ate);
    if (!input || input.tellg() < 0 || input.tellg() % 4) throw std::runtime_error("bad fixture: " + path);
    std::vector<float> value(static_cast<size_t>(input.tellg()) / 4); input.seekg(0);
    input.read(reinterpret_cast<char *>(value.data()), static_cast<std::streamsize>(value.size() * 4));
    if (!input) throw std::runtime_error("short fixture"); return value;
}
int main(int argc, char **argv) try {
    if (argc != 5) return 2;
    const std::string stage(argv[3]), directory = std::string(argv[2]) + "/";
    const auto frames = static_cast<size_t>(std::stoul(argv[4]));
    if (stage != "root" && stage != "body") throw std::runtime_error("stage must be root or body");
    auto weights = kimodo::detail::ggml_motion_weights::load(argv[1]); if (!weights) throw std::runtime_error(weights.error());
    const size_t dimension = stage == "root" ? 546 : 545;
    auto output = kimodo::detail::run_motion_transformer(
        **weights, stage + "_model.", read(directory + stage + "_input_0.f32"), dimension,
        read(directory + stage + "_input_2.f32"), read(directory + stage + "_input_4.f32"),
        read(directory + stage + "_input_5.f32"), 3, frames);
    if (!output) throw std::runtime_error(output.error());
    const auto expected = read(directory + stage + "_output.f32");
    if (output->size() != expected.size()) throw std::runtime_error("shape mismatch");
    float maximum = 0; double error = 0, reference = 0;
    for (size_t i = 0; i < expected.size(); ++i) { const float d = (*output)[i] - expected[i]; maximum = std::max(maximum, std::abs(d)); error += double(d)*d; reference += double(expected[i])*expected[i]; }
    std::printf("%s max_abs=%g rel_l2=%g\n", stage.c_str(), maximum, std::sqrt(error/reference));
    return maximum < 2.e-3f ? 0 : 1;
} catch (const std::exception &error) { std::fprintf(stderr, "%s\n", error.what()); return 1; }
