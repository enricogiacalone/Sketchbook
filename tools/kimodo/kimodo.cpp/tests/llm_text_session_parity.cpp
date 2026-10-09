#include "llm_text_encoder.hpp"

#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <fstream>
#include <iostream>
#include <string>

namespace {
bool read_f32(const std::string &path, float *out, size_t count) {
    std::ifstream in(path, std::ios::binary);
    in.read(reinterpret_cast<char *>(out), static_cast<std::streamsize>(count * sizeof(float)));
    return in && in.peek() == std::ifstream::traits_type::eof();
}
} // namespace

int main(int argc, char **argv) {
    if (argc != 3) {
        std::cerr << "usage: " << argv[0] << " TEXT_BUNDLE FIXTURE_DIR\n";
        return 2;
    }
    // The versioned upstream fixture deliberately contains only tensors.  Its
    // captured prompt is kept here to make the complete native route explicit.
    constexpr std::string_view prompt =
        "A person runs forward and then leaps over an obstacle in front of them.";
    auto encoder = kimodo::detail::llm_text_encoder::load(argv[1]);
    if (!encoder) {
        std::cerr << "load failed: " << encoder.error() << '\n';
        return 1;
    }
    auto actual = (*encoder)->encode(prompt);
    if (!actual) {
        std::cerr << "encode failed: " << actual.error() << '\n';
        return 1;
    }
    std::array<float, 4096> expected{};
    if (!read_f32(std::string(argv[2]) + "/pooled_embedding.f32", expected.data(), expected.size())) {
        std::cerr << "cannot read fixture pooled_embedding.f32\n";
        return 2;
    }
    float maximum = 0.0F;
    double squared_error = 0.0, squared_reference = 0.0;
    for (size_t i = 0; i < expected.size(); ++i) {
        const double diff = double((*actual)[i]) - expected[i];
        maximum = std::max(maximum, std::abs(static_cast<float>(diff)));
        squared_error += diff * diff;
        squared_reference += double(expected[i]) * expected[i];
    }
    const double rel_l2 = std::sqrt(squared_error / squared_reference);
    const char *backend = std::getenv("KIMODO_BACKEND");
    std::cout << "native text session backend=" << (backend ? backend : "vulkan")
              << " max_abs=" << maximum << " rel_l2=" << rel_l2 << '\n';
    return rel_l2 < 0.01 ? 0 : 1;
}
