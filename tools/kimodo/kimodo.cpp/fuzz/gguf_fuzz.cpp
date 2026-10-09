#include "gguf.hpp"

#include <cstddef>
#include <cstdint>
#include <fstream>
#include <string>

extern "C" int LLVMFuzzerTestOneInput(const std::uint8_t *data, std::size_t size) {
    // File APIs are intentionally fuzzed through a bounded temporary name in
    // the fuzzer harness, not by passing attacker-controlled paths to C API.
    if (size > 4 * 1024 * 1024) return 0;
    const std::string path = "/tmp/kimodo-gguf-fuzz-input";
    { std::ofstream out(path, std::ios::binary); out.write(reinterpret_cast<const char *>(data), static_cast<std::streamsize>(size)); }
    (void) kimodo::detail::read_gguf_header(path);
    return 0;
}
