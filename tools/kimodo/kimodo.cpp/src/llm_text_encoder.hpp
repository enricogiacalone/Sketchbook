#pragma once

#include <array>
#include <expected>
#include <memory>
#include <string>
#include <string_view>

namespace kimodo::detail {

class llm_text_encoder {
public:
    // A text bundle is a directory containing tokenizer.gguf, embedding.gguf,
    // final-norm.gguf, and layer-00.gguf through layer-31.gguf.  Components
    // are loaded serially so only one transformer layer is GPU-resident.
    static std::expected<std::unique_ptr<llm_text_encoder>, std::string> load(std::string_view bundle_directory);
    std::expected<std::array<float, 4096>, std::string> encode(std::string_view utf8_prompt) const;
    ~llm_text_encoder();
    llm_text_encoder(const llm_text_encoder &) = delete;
    llm_text_encoder &operator=(const llm_text_encoder &) = delete;
private:
    llm_text_encoder() = default;
    struct impl;
    std::unique_ptr<impl> impl_;
};

} // namespace kimodo::detail
