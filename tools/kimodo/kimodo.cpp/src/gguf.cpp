#include "gguf.hpp"
#include "skeleton.hpp"

#include <algorithm>
#include <array>
#include <fstream>
#include <limits>
#include <string>

namespace kimodo::detail {
namespace {
constexpr std::uint32_t gguf_magic = 0x46554747; // "GGUF", little endian
constexpr std::uint32_t max_metadata = 100000;
constexpr std::uint64_t max_string_bytes = 16 * 1024 * 1024;

template <class T> bool read(std::istream &in, T &value) {
    return static_cast<bool>(in.read(reinterpret_cast<char *>(&value), sizeof(value)));
}
bool read_string(std::istream &in, std::string &out) {
    std::uint64_t size = 0;
    if (!read(in, size) || size > max_string_bytes) return false;
    out.resize(static_cast<size_t>(size));
    return size == 0 || static_cast<bool>(in.read(out.data(), static_cast<std::streamsize>(size)));
}
bool skip(std::istream &in, std::uint32_t type) {
    // GGUF metadata scalar types. Arrays are rejected below: Kimodo metadata
    // never needs them in this small, hostile-input loader.
    static constexpr std::array<unsigned, 12> widths{1, 1, 2, 2, 4, 4, 4, 1, 1, 1, 8, 8};
    if (type >= widths.size()) return false;
    in.seekg(widths[type], std::ios::cur);
    return static_cast<bool>(in);
}
}

std::expected<gguf_file, std::string> read_gguf_header(std::string_view path) {
    std::ifstream in(std::string(path), std::ios::binary);
    if (!in) return std::unexpected("cannot open GGUF file");
    std::uint32_t magic = 0, version = 0;
    std::uint64_t tensor_count = 0, metadata_count = 0;
    if (!read(in, magic) || !read(in, version) || !read(in, tensor_count) || !read(in, metadata_count))
        return std::unexpected("truncated GGUF header");
    if (magic != gguf_magic) return std::unexpected("not a GGUF file");
    if (version < 2 || version > 3) return std::unexpected("unsupported GGUF version");
    if (metadata_count > max_metadata || tensor_count > 10000000)
        return std::unexpected("GGUF count exceeds safety limit");
    gguf_file result;
    for (std::uint64_t i = 0; i < metadata_count; ++i) {
        std::string key;
        std::uint32_t type = 0;
        if (!read_string(in, key) || !read(in, type)) return std::unexpected("truncated GGUF metadata");
        if (key.empty() || key.size() > 4096) return std::unexpected("invalid GGUF metadata key");
        if (type == 8) {
            std::string value;
            if (!read_string(in, value)) return std::unexpected("invalid GGUF string metadata");
            result.strings.emplace(std::move(key), std::move(value));
        } else if (type == 10 || type == 11) {
            std::uint64_t value = 0;
            if (!read(in, value)) return std::unexpected("truncated GGUF integer metadata");
            result.uints.emplace(std::move(key), value);
        } else if (type == 9) {
            return std::unexpected("GGUF array metadata is not accepted by the minimal loader");
        } else if (!skip(in, type)) {
            return std::unexpected("unsupported or truncated GGUF metadata");
        }
    }
    // Tensor directory is also untrusted. Read every descriptor even though
    // tensor mapping/graph construction is deferred, preventing a truncated
    // or malformed file from being accepted merely because its metadata is
    // well formed.
    std::uint64_t max_tensor_end = 0;
    for (std::uint64_t i = 0; i < tensor_count; ++i) {
        std::string name;
        std::uint32_t dimensions = 0, type = 0;
        if (!read_string(in, name) || !read(in, dimensions) || name.empty() || dimensions == 0 || dimensions > 4)
            return std::unexpected("invalid GGUF tensor descriptor");
        if (!result.tensor_names.emplace(name).second) return std::unexpected("duplicate GGUF tensor name");
        std::uint64_t elements = 1;
        for (std::uint32_t dim = 0; dim < dimensions; ++dim) {
            std::uint64_t extent = 0;
            if (!read(in, extent) || extent == 0 || extent > 100000000 || elements > std::numeric_limits<std::uint64_t>::max() / extent)
                return std::unexpected("invalid GGUF tensor dimension");
            elements *= extent;
        }
        std::uint64_t offset = 0;
        if (!read(in, type) || !read(in, offset) || type != 0 || offset % 32 != 0 || elements > std::numeric_limits<std::uint64_t>::max() / 4)
            return std::unexpected("unsupported GGUF tensor type or offset");
        if (offset > std::numeric_limits<std::uint64_t>::max() - elements * 4)
            return std::unexpected("GGUF tensor offset overflows");
        max_tensor_end = std::max(max_tensor_end, offset + elements * 4);
    }
    const auto directory_end = static_cast<std::uint64_t>(in.tellg());
    if (directory_end == std::numeric_limits<std::uint64_t>::max()) return std::unexpected("invalid GGUF tensor directory");
    const auto data_start = (directory_end + 31U) & ~std::uint64_t{31U};
    in.seekg(0, std::ios::end);
    const auto file_end = static_cast<std::uint64_t>(in.tellg());
    if (file_end < data_start || max_tensor_end > file_end - data_start)
        return std::unexpected("GGUF tensor data is truncated");
    result.tensor_count = tensor_count;
    return result;
}

std::expected<void, std::string> validate_motion_gguf(const gguf_file &file) {
    const auto architecture = file.strings.find("general.architecture");
    if (architecture == file.strings.end() || architecture->second != "kimodo-motion")
        return std::unexpected("GGUF is not a Kimodo motion model");
    const auto format = file.uints.find("kimodo.format_version");
    if (format == file.uints.end() || format->second != 1)
        return std::unexpected("unsupported Kimodo motion GGUF format");
    const auto skeleton = file.strings.find("kimodo.skeleton");
    if (skeleton == file.strings.end() || !find_skeleton(skeleton->second))
        return std::unexpected("motion GGUF has an unsupported skeleton");
    const auto &spec = *find_skeleton(skeleton->second);
    const auto motion_dim = file.uints.find("kimodo.motion_dim");
    const auto body_dim = file.uints.find("kimodo.body_dim");
    if (motion_dim == file.uints.end() || motion_dim->second != spec.motion_dim() ||
        body_dim == file.uints.end() || body_dim->second != spec.body_dim())
        return std::unexpected("motion GGUF dimensions do not match its skeleton");
    const auto width = file.uints.find("kimodo.text_embedding_width");
    if (width == file.uints.end() || width->second != 4096)
        return std::unexpected("motion GGUF has incompatible text embedding width");
    if (file.tensor_count != 414)
        return std::unexpected("motion GGUF has an unexpected tensor count");
    for (const char *stage : {"root_model", "body_model"}) {
        for (const char *name : {"embed_text.weight", "embed_text.bias", "input_linear.weight", "input_linear.bias",
                                 "output_linear.weight", "output_linear.bias", "linear_first_heading_angle.weight",
                                 "linear_first_heading_angle.bias", "embed_timestep.time_embed.0.weight",
                                 "embed_timestep.time_embed.0.bias", "embed_timestep.time_embed.2.weight",
                                 "embed_timestep.time_embed.2.bias"}) {
            if (!file.tensor_names.contains(std::string(stage) + "." + name))
                return std::unexpected("motion GGUF is missing a transformer projection tensor");
        }
        for (unsigned layer = 0; layer < 16; ++layer) {
            const std::string prefix = std::string(stage) + ".seqTransEncoder.layers." + std::to_string(layer) + ".";
            for (const char *name : {"linear1.weight", "linear1.bias", "linear2.weight", "linear2.bias", "norm1.weight",
                                     "norm1.bias", "norm2.weight", "norm2.bias", "self_attn.in_proj_weight",
                                     "self_attn.in_proj_bias", "self_attn.out_proj.weight", "self_attn.out_proj.bias"}) {
                if (!file.tensor_names.contains(prefix + name)) return std::unexpected("motion GGUF is missing a transformer layer tensor");
            }
        }
    }
    for (const char *group : {"global_root", "local_root", "body"})
        for (const char *stat : {"mean", "std"})
            if (!file.tensor_names.contains(std::string("stats.") + group + "." + stat))
                return std::unexpected("motion GGUF is missing normalization statistics");
    return {};
}

std::expected<void, std::string> validate_text_gguf(const gguf_file &file) {
    const auto architecture = file.strings.find("general.architecture");
    if (architecture == file.strings.end() || architecture->second != "kimodo-llm2vec")
        return std::unexpected("GGUF is not a Kimodo LLM2Vec model");
    const auto width = file.uints.find("kimodo.text_embedding_width");
    if (width == file.uints.end() || width->second != 4096)
        return std::unexpected("text GGUF has incompatible embedding width");
    return {};
}

} // namespace kimodo::detail
