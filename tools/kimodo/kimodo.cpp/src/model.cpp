#include <kimodo/kimodo.hpp>
#include "gguf.hpp"
#include "skeleton.hpp"
#ifdef KIMODO_HAVE_GGML
#include "ggml_weights.hpp"
#include "denoiser.hpp"
#include "motion_decode.hpp"
#include "llm_text_encoder.hpp"
#endif

#include <cmath>
#include <algorithm>
#include <random>

namespace kimodo {
struct model::impl {
    detail::gguf_file motion;
    std::string motion_path;
    const detail::skeleton_spec *skeleton = nullptr;
#ifdef KIMODO_HAVE_GGML
    mutable std::unique_ptr<detail::ggml_motion_weights> weights;
    std::unique_ptr<detail::llm_text_encoder> text;
#endif
};
model::model(std::unique_ptr<impl> state) : impl_(std::move(state)) {}
model::~model() = default;

std::expected<std::unique_ptr<model>, std::string> model::load(std::string_view motion_path, std::string_view text_path) {
    auto file = detail::read_gguf_header(motion_path);
    if (!file) return std::unexpected(file.error());
    if (auto valid = detail::validate_motion_gguf(*file); !valid) return std::unexpected(valid.error());
    auto state = std::make_unique<impl>();
    state->motion = std::move(*file);
    state->motion_path = std::string(motion_path);
    state->skeleton = detail::find_skeleton(state->motion.strings.at("kimodo.skeleton"));
#ifdef KIMODO_HAVE_GGML
    if (!text_path.empty()) {
        auto text = detail::llm_text_encoder::load(text_path);
        if (!text) return std::unexpected(text.error());
        state->text = std::move(*text);
    }
#else
    if (!text_path.empty()) return std::unexpected("Kimodo was built without GGML support");
#endif
    return std::unique_ptr<model>(new model(std::move(state)));
}

std::expected<motion_data, std::string> model::generate_text(
    std::string_view utf8_prompt, unsigned frames, unsigned steps, std::uint64_t seed,
    float text_cfg, float constraint_cfg) const {
#ifdef KIMODO_HAVE_GGML
    if (!impl_->text) return std::unexpected("model was loaded without a native text bundle");
    auto embedding = impl_->text->encode(utf8_prompt);
    if (!embedding) return std::unexpected(embedding.error());
    return generate_embedding(*embedding, frames, steps, seed, text_cfg, constraint_cfg);
#else
    (void) utf8_prompt; (void) frames; (void) steps; (void) seed; (void) text_cfg; (void) constraint_cfg;
    return std::unexpected("Kimodo was built without GGML support");
#endif
}

std::expected<motion_data, std::string> model::generate_embedding(
    const std::array<float, embedding_width> &embedding, unsigned frames, unsigned steps,
    std::uint64_t seed, float text_cfg, float constraint_cfg) const {
    if (frames == 0 || frames > 10000) return std::unexpected("frames must be in 1..10000");
    if (steps == 0 || steps > 1000) return std::unexpected("diffusion_steps must be in 1..1000");
    if (!std::isfinite(text_cfg) || !std::isfinite(constraint_cfg)) return std::unexpected("CFG weights must be finite");
    for (float value : embedding) if (!std::isfinite(value)) return std::unexpected("embedding contains a non-finite value");
#ifdef KIMODO_HAVE_GGML
    // Weight residency is deferred until inference so model-load stays a
    // bounded metadata operation.  The graph integration consumes this exact
    // session; no separate unchecked tensor loader exists in the runtime.
    if (!impl_->weights) {
        auto loaded = detail::ggml_motion_weights::load(impl_->motion_path);
        if (!loaded) return std::unexpected(loaded.error());
        impl_->weights = std::move(*loaded);
    }
    std::mt19937_64 rng(seed);
    std::normal_distribution<float> normal(0.f, 1.f);
    const size_t motion_dim=impl_->skeleton->motion_dim();
    std::vector<float> noise(static_cast<size_t>(frames)*motion_dim);
    for (float &value : noise) value = normal(rng);
    auto sampled = detail::sample_motion_from_noise(*impl_->weights, noise, embedding, frames, steps, text_cfg, constraint_cfg);
    if (!sampled) return std::unexpected(sampled.error());
    auto global_mean=impl_->weights->f32_values("stats.global_root.mean"), global_std=impl_->weights->f32_values("stats.global_root.std");
    auto body_mean=impl_->weights->f32_values("stats.body.mean"), body_std=impl_->weights->f32_values("stats.body.std");
    if (!global_mean) return std::unexpected(global_mean.error());
    if (!global_std) return std::unexpected(global_std.error());
    if (!body_mean) return std::unexpected(body_mean.error());
    if (!body_std) return std::unexpected(body_std.error());
    auto decoded=detail::decode_motion(*sampled,frames,*impl_->skeleton,*global_mean,*global_std,*body_mean,*body_std);
    if (!decoded) return std::unexpected(decoded.error());
    motion_data result;
    result.frames=frames; result.joints=static_cast<unsigned>(impl_->skeleton->joints());
    result.local_rotations_xyzw=std::move(decoded->local_xyzw);
    result.root_positions=std::move(decoded->root_positions);
    return result;
#else
    return std::unexpected("Kimodo was built without GGML support");
#endif
}

std::expected<motion_data, std::string> model::generate_text_sequence(
    std::span<const prompt_segment> segments, unsigned transition_frames,
    unsigned steps, std::uint64_t seed, float text_cfg, float constraint_cfg) const {
#ifdef KIMODO_HAVE_GGML
    if (!impl_->text) return std::unexpected("model was loaded without a native text bundle");
    if (segments.empty() || segments.size() > 16) return std::unexpected("sequence requires 1..16 prompt segments");
    if (steps == 0 || steps > 1000 || transition_frames == 0 || transition_frames > 60)
        return std::unexpected("invalid sequence sampling parameters");
    if (!impl_->weights) {
        auto loaded = detail::ggml_motion_weights::load(impl_->motion_path);
        if (!loaded) return std::unexpected(loaded.error());
        impl_->weights = std::move(*loaded);
    }
    auto bm=impl_->weights->f32_values("stats.body.mean"), bs=impl_->weights->f32_values("stats.body.std");
    auto gm=impl_->weights->f32_values("stats.global_root.mean"), gs=impl_->weights->f32_values("stats.global_root.std");
    if (!gm || !gs || !bm || !bs) return std::unexpected("motion GGUF lacks normalization statistics");
    std::mt19937_64 rng(seed); std::normal_distribution<float> normal(0.f, 1.f);
    std::vector<std::array<float, embedding_width>> embeddings;
    std::vector<std::vector<float>> noise;
    std::vector<detail::sampled_sequence_segment> sampled;
    embeddings.reserve(segments.size()); noise.reserve(segments.size()); sampled.reserve(segments.size());
    for (size_t index=0; index<segments.size(); ++index) {
        const auto &segment=segments[index];
        if (segment.prompt.empty() || segment.frames < 2 || segment.frames > 300)
            return std::unexpected("each sequence segment must contain a prompt and have 2..300 frames");
        if (index && transition_frames >= segment.frames) return std::unexpected("transition must be shorter than every following segment");
        auto embedding=impl_->text->encode(segment.prompt);
        if (!embedding) return std::unexpected(embedding.error());
        const auto sampled_frames = static_cast<size_t>(segment.frames) +
            (index == 0 ? 0 : transition_frames);
        embeddings.push_back(*embedding);
        noise.emplace_back(sampled_frames*impl_->skeleton->motion_dim());
        for (float &value : noise.back()) value=normal(rng);
        sampled.push_back({embeddings.back(), noise.back(), segment.frames});
    }
    auto joined=detail::sample_motion_sequence_from_noise(*impl_->weights,sampled,transition_frames,steps,text_cfg,constraint_cfg);
    if (!joined) return std::unexpected(joined.error());
    const size_t motion_dim=impl_->skeleton->motion_dim(), body_dim=impl_->skeleton->body_dim();
    const auto frames=static_cast<unsigned>(joined->size()/motion_dim);
    auto normalized=*joined;
    for (size_t row=0; row<frames; ++row) {
        auto *value=normalized.data()+row*motion_dim;
        for (size_t d=0; d<5; ++d) value[d]=(value[d]-(*gm)[d])/std::sqrt((*gs)[d]*(*gs)[d]+1.e-5F);
        for (size_t d=0; d<body_dim; ++d) value[5+d]=(value[5+d]-(*bm)[d])/std::sqrt((*bs)[d]*(*bs)[d]+1.e-5F);
    }
    auto decoded=detail::decode_motion(normalized,frames,*impl_->skeleton,*gm,*gs,*bm,*bs);
    if (!decoded) return std::unexpected(decoded.error());
    motion_data result; result.frames=frames; result.joints=static_cast<unsigned>(impl_->skeleton->joints());
    result.local_rotations_xyzw=std::move(decoded->local_xyzw); result.root_positions=std::move(decoded->root_positions);
    return result;
#else
    (void) segments; (void) transition_frames; (void) steps; (void) seed; (void) text_cfg; (void) constraint_cfg;
    return std::unexpected("Kimodo was built without GGML support");
#endif
}
} // namespace kimodo
