#include "llm_tokenizer.hpp"

#include <cstdio>
#include <filesystem>
#include <fstream>
#include <vector>

int main(int argc, char **argv) {
    if (argc != 3) { std::fprintf(stderr, "usage: %s TOKENIZER.gguf FIXTURE_DIR\n", argv[0]); return 2; }
    auto tokenizer = kimodo::detail::llm_tokenizer::load(argv[1]);
    if (!tokenizer) { std::fprintf(stderr, "%s\n", tokenizer.error().c_str()); return 1; }
    const std::string prompt = "A person runs forward and then leaps over an obstacle in front of them.";
    auto tokens = (*tokenizer)->encode(prompt);
    if (!tokens) { std::fprintf(stderr, "%s\n", tokens.error().c_str()); return 1; }
    std::ifstream input(std::filesystem::path(argv[2]) / "input_ids.i64", std::ios::binary | std::ios::ate);
    if (!input) { std::fprintf(stderr, "cannot read input fixture\n"); return 1; }
    if (input.tellg() != static_cast<std::streamoff>(tokens->size() * sizeof(std::int64_t))) { std::fprintf(stderr, "token count: got %zu fixture bytes=%lld; IDs:", tokens->size(), static_cast<long long>(input.tellg())); for (int id : *tokens) std::fprintf(stderr, " %d", id); std::fprintf(stderr, "\n"); return 1; }
    std::vector<std::int64_t> expected(tokens->size()); input.seekg(0); input.read(reinterpret_cast<char *>(expected.data()), static_cast<std::streamsize>(expected.size() * sizeof(std::int64_t)));
    for (size_t i = 0; i < tokens->size(); ++i) if ((*tokens)[i] != expected[i]) { std::fprintf(stderr, "token %zu: got %d expected %lld\n", i, (*tokens)[i], static_cast<long long>(expected[i])); return 1; }
    const std::pair<const char *, std::vector<int>> cases[] = {
        {"hello, world!", {128000, 15339, 11, 1917, 0}},
        {"caf\xc3\xa9 d\xc3\xa9j\xc3\xa0 vu", {128000, 936, 59958, 46939, 33614}},
        {"\xe4\xbd\xa0\xe5\xa5\xbd\xef\xbc\x8c\xe4\xb8\x96\xe7\x95\x8c", {128000, 57668, 53901, 3922, 102616}},
        {"\xf0\x9f\x99\x82 running\nfast", {128000, 9468, 19044, 4401, 198, 9533}},
    };
    for (const auto &[text, reference] : cases) {
        auto actual = (*tokenizer)->encode(text);
        if (!actual || *actual != reference) { std::fprintf(stderr, "UTF-8 tokenizer mismatch for %s\n", text); return 1; }
    }
    if ((*tokenizer)->encode("\xc3").has_value()) { std::fprintf(stderr, "malformed UTF-8 was accepted\n"); return 1; }
    std::printf("tokenizer matched prompt and %zu UTF-8 upstream cases\n", std::size(cases)); return 0;
}
