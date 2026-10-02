#pragma once

#include <cstddef>
#include <expected>
#include <memory>
#include <string>
#include <string_view>
#include <vector>

struct ggml_context;
struct gguf_context;
struct ggml_backend;
struct ggml_backend_buffer;
struct ggml_tensor;

namespace kimodo::detail {

// Owns a CPU-resident, F32 GGUF tensor set.  Loading is deliberately separate
// from model-header validation so hostile files never reach a backend before
// the checked parser has accepted their Kimodo metadata and tensor directory.
class ggml_motion_weights {
public:
    static std::expected<std::unique_ptr<ggml_motion_weights>, std::string> load(std::string_view path);
    ~ggml_motion_weights();
    ggml_motion_weights(const ggml_motion_weights &) = delete;
    ggml_motion_weights &operator=(const ggml_motion_weights &) = delete;

    ggml_tensor *tensor(std::string_view name) const;
    std::expected<std::vector<float>, std::string> f32_values(std::string_view name) const;
    ggml_backend *backend() const noexcept { return backend_; }
    std::string_view skeleton_key() const noexcept { return skeleton_; }
    std::size_t motion_dim() const noexcept { return motion_dim_; }
    std::size_t body_dim() const noexcept { return body_dim_; }

private:
    ggml_motion_weights() = default;
    ggml_context *context_ = nullptr;
    gguf_context *gguf_ = nullptr;
    ggml_backend *backend_ = nullptr;
    ggml_backend_buffer *buffer_ = nullptr;
    std::string skeleton_;
    std::size_t motion_dim_ = 0;
    std::size_t body_dim_ = 0;
};

} // namespace kimodo::detail
