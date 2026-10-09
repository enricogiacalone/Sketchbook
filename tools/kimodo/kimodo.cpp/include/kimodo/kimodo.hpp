#pragma once

#include <kimodo/kimodo_capi.h>

#include <array>
#include <cstdint>
#include <expected>
#include <memory>
#include <span>
#include <string>
#include <string_view>
#include <vector>

namespace kimodo {

inline constexpr unsigned embedding_width = 4096;

struct motion_data {
    unsigned frames = 0;
    unsigned joints = 0;
    std::vector<float> local_rotations_xyzw;
    std::vector<float> root_positions;
};

struct prompt_segment {
    std::string prompt;
    unsigned frames = 0;
};

class KIMODO_API model {
public:
    static std::expected<std::unique_ptr<model>, std::string> load(
        std::string_view motion_gguf, std::string_view text_bundle = {});
    std::expected<motion_data, std::string> generate_embedding(
        const std::array<float, embedding_width> &embedding,
        unsigned frames, unsigned steps, std::uint64_t seed,
        float text_cfg, float constraint_cfg) const;
    std::expected<motion_data, std::string> generate_text(
        std::string_view utf8_prompt, unsigned frames, unsigned steps, std::uint64_t seed,
        float text_cfg, float constraint_cfg) const;
    std::expected<motion_data, std::string> generate_text_sequence(
        std::span<const prompt_segment> segments, unsigned transition_frames,
        unsigned steps, std::uint64_t seed, float text_cfg, float constraint_cfg) const;
    ~model();
    model(const model &) = delete;
    model &operator=(const model &) = delete;
private:
    struct impl;
    explicit model(std::unique_ptr<impl> impl);
    std::unique_ptr<impl> impl_;
};

} // namespace kimodo
