#include "ggml_weights.hpp"

#include <cstdio>

int main(int argc, char **argv) {
    if (argc != 2) { std::fprintf(stderr, "usage: kimodo-ggml-weights-test MODEL.gguf\n"); return 2; }
    auto weights = kimodo::detail::ggml_motion_weights::load(argv[1]);
    if (!weights) { std::fprintf(stderr, "%s\n", weights.error().c_str()); return 1; }
    if (!(*weights)->tensor("root_model.input_linear.weight") || !(*weights)->tensor("body_model.output_linear.bias")) {
        std::fprintf(stderr, "expected motion tensors missing after GGML load\n"); return 1;
    }
    return 0;
}
