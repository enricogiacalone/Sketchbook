#pragma once

#include <expected>
#include <memory>
#include <string>
#include <string_view>
#include <vector>

namespace kimodo::detail {

// Llama-3 byte-level BPE.  Its split/merge ordering is independently
// implemented from tokenizer.json; see the attribution in the .cpp file.
class llm_tokenizer {
public:
    static std::expected<std::unique_ptr<llm_tokenizer>, std::string> load(std::string_view tokenizer_gguf);
    std::expected<std::vector<int>, std::string> encode(std::string_view prepared_text) const;
    ~llm_tokenizer();
    llm_tokenizer(const llm_tokenizer &) = delete;
    llm_tokenizer &operator=(const llm_tokenizer &) = delete;
private:
    llm_tokenizer() = default;
    struct impl;
    std::unique_ptr<impl> impl_;
};

} // namespace kimodo::detail
