#include <kimodo/kimodo_capi.h>
#include <cassert>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <string>
#include <vector>

template <class T> static void put(std::ofstream &out, T value) {
    out.write(reinterpret_cast<const char *>(&value), sizeof(value));
}
static void put_string(std::ofstream &out, const char *value) {
    const auto n = static_cast<std::uint64_t>(std::strlen(value)); put(out, n); out.write(value, static_cast<std::streamsize>(n));
}
static void put_key_string(std::ofstream &out, const char *key, const char *value) {
    put_string(out, key); put(out, std::uint32_t{8}); put_string(out, value);
}
static void put_key_uint(std::ofstream &out, const char *key, std::uint64_t value) {
    put_string(out, key); put(out, std::uint32_t{10}); put(out, value);
}
static void motion_gguf(const char *path) {
    std::ofstream out(path, std::ios::binary);
    put(out, std::uint32_t{0x46554747}); put(out, std::uint32_t{3}); put(out, std::uint64_t{0}); put(out, std::uint64_t{5});
    put_key_string(out, "general.architecture", "kimodo-motion");
    put_key_uint(out, "kimodo.format_version", 1);
    put_key_string(out, "kimodo.skeleton", "smplx22");
    put_key_uint(out, "kimodo.text_embedding_width", 4096);
    put_key_string(out, "kimodo.model_identity", "fixture-v1");
}

int main(int argc, char **argv) {
    assert(kimodo_abi_version() == 1);
    char error[64];
    auto *model = kimodo_model_load("does-not-exist.gguf", nullptr, nullptr, nullptr, error, sizeof(error));
    assert(model == nullptr && std::strlen(error) > 0);
    const char *path = "kimodo-test-motion.gguf";
    motion_gguf(path);
    model = kimodo_model_load(path, nullptr, nullptr, nullptr, error, sizeof(error));
    assert(model == nullptr);
    assert(std::strlen(error) > 0);
    // A tensorless metadata-only fixture must never be treated as a model.
    std::remove(path);
    assert(kimodo_generate_embedding(nullptr, nullptr, nullptr, error, sizeof(error)) == nullptr);

    if (argc == 2 || argc == 3) {
        kimodo_runtime_options runtime{};
        runtime.size = sizeof(runtime);
        auto *loaded = kimodo_model_load(argv[1], argc == 3 ? argv[2] : nullptr, nullptr, &runtime, error, sizeof(error));
        assert(loaded != nullptr);

        std::vector<float> embedding(4096);
        kimodo_embedding input{embedding.data(), static_cast<uint32_t>(embedding.size())};
        kimodo_generation_options options{};
        options.size = sizeof(options);
        options.seed = 42;
        options.frames = 2;
        options.diffusion_steps = 1;
        options.text_cfg_weight = 2.f;
        options.constraint_cfg_weight = 2.f;
        auto *motion = kimodo_generate_embedding(loaded, &input, &options, error, sizeof(error));
        assert(motion != nullptr);
        assert(kimodo_motion_frames(motion) == 2);
        assert(kimodo_motion_joints(motion) == 22);
        const float *root = kimodo_motion_root_positions(motion);
        const float *rotations = kimodo_motion_local_rotations_xyzw(motion);
        assert(root != nullptr && rotations != nullptr);
        for (int i = 0; i < 6; ++i) assert(std::isfinite(root[i]));
        for (int i = 0; i < 2 * 22 * 4; ++i) assert(std::isfinite(rotations[i]));
        kimodo_motion_free(motion);
        if (argc == 3) {
            motion = kimodo_generate(loaded,
                "A person runs forward and then leaps over an obstacle in front of them.",
                &options, error, sizeof(error));
            assert(motion != nullptr);
            assert(kimodo_motion_frames(motion) == 2);
            assert(kimodo_motion_joints(motion) == 22);
            kimodo_motion_free(motion);
        }
        kimodo_model_free(loaded);
    }
}
