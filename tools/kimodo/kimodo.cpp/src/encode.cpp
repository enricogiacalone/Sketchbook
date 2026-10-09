// Small developer utility for capturing a portable F32 LLM2Vec embedding.
// It uses the same serial GGML text session as the public prompt API.
#include "llm_text_encoder.hpp"

#include <filesystem>
#include <fstream>
#include <iostream>
#include <iterator>
#include <stdexcept>

int main(int argc, char **argv) try {
    if (argc != 4) {
        std::cerr << "usage: " << argv[0] << " TEXT_BUNDLE PROMPT.txt OUTPUT.f32\n";
        return 2;
    }
    std::ifstream prompt_file(argv[2]);
    const std::string prompt{std::istreambuf_iterator<char>(prompt_file), {}};
    if (!prompt_file && prompt.empty()) throw std::runtime_error("cannot read prompt");
    auto encoder = kimodo::detail::llm_text_encoder::load(argv[1]);
    if (!encoder) throw std::runtime_error(encoder.error());
    auto embedding = (*encoder)->encode(prompt);
    if (!embedding) throw std::runtime_error(embedding.error());
    std::ofstream output(argv[3], std::ios::binary | std::ios::trunc);
    if (!output) throw std::runtime_error("cannot open output");
    output.write(reinterpret_cast<const char *>(embedding->data()),
                 static_cast<std::streamsize>(embedding->size() * sizeof(float)));
    if (!output) throw std::runtime_error("cannot write output");
    return 0;
} catch (const std::exception &error) {
    std::cerr << error.what() << '\n';
    return 1;
}
