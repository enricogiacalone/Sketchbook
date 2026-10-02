// Command-line bridge for the localhost demo.  It deliberately uses only the
// public C++ model API, so the demo exercises the same text route as embedders.
#include <kimodo/kimodo.hpp>

#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <iterator>
#include <string>
#include <string_view>
#include <vector>

namespace {
void write_f32(const std::filesystem::path &path, const std::vector<float> &values) {
    std::ofstream out(path, std::ios::binary | std::ios::trunc);
    if (!out) throw std::runtime_error("cannot open " + path.string());
    out.write(reinterpret_cast<const char *>(values.data()),
              static_cast<std::streamsize>(values.size() * sizeof(float)));
    if (!out) throw std::runtime_error("cannot write " + path.string());
}
}

int main(int argc, char **argv) try {
    if (argc >= 10 && std::string_view(argv[3]) == "--sequence") {
        if ((argc - 8) % 2 != 0) throw std::runtime_error("sequence requires FRAME PROMPT.txt pairs");
        const auto transition = static_cast<unsigned>(std::stoul(argv[4]));
        const auto steps = static_cast<unsigned>(std::stoul(argv[5]));
        const auto seed = static_cast<std::uint64_t>(std::stoull(argv[6]));
        std::vector<kimodo::prompt_segment> segments;
        for (int index=8; index<argc; index+=2) {
            std::ifstream prompt_file(argv[index+1]);
            const std::string prompt{std::istreambuf_iterator<char>(prompt_file), {}};
            if (!prompt_file && prompt.empty()) throw std::runtime_error("cannot read sequence prompt");
            segments.push_back({prompt, static_cast<unsigned>(std::stoul(argv[index]))});
        }
        auto model = kimodo::model::load(argv[1], argv[2]);
        if (!model) throw std::runtime_error(model.error());
        auto motion = (*model)->generate_text_sequence(segments, transition, steps, seed, 2.F, 2.F);
        if (!motion) throw std::runtime_error(motion.error());
        const std::filesystem::path output(argv[7]); std::filesystem::create_directories(output);
        write_f32(output / "root_positions.f32", motion->root_positions);
        write_f32(output / "local_rotations_xyzw.f32", motion->local_rotations_xyzw);
        std::cout << "generated " << motion->frames << " frames with " << motion->joints << " joints\n";
        return 0;
    }
    if (argc != 8) {
        std::cerr << "usage: " << argv[0] << " MOTION.gguf TEXT_BUNDLE PROMPT.txt FRAMES STEPS SEED OUTPUT_DIR\n"
                  << "   or: " << argv[0] << " MOTION.gguf TEXT_BUNDLE --sequence TRANSITION STEPS SEED OUTPUT_DIR FRAME PROMPT.txt [FRAME PROMPT.txt ...]\n";
        return 2;
    }
    std::ifstream prompt_file(argv[3]);
    const std::string prompt{std::istreambuf_iterator<char>(prompt_file), {}};
    if (!prompt_file && prompt.empty()) throw std::runtime_error("cannot read prompt");
    const auto frames = static_cast<unsigned>(std::stoul(argv[4]));
    const auto steps = static_cast<unsigned>(std::stoul(argv[5]));
    const auto seed = static_cast<std::uint64_t>(std::stoull(argv[6]));
    auto model = kimodo::model::load(argv[1], argv[2]);
    if (!model) throw std::runtime_error(model.error());
    auto motion = (*model)->generate_text(prompt, frames, steps, seed, 2.F, 2.F);
    if (!motion) throw std::runtime_error(motion.error());
    const std::filesystem::path output(argv[7]);
    std::filesystem::create_directories(output);
    write_f32(output / "root_positions.f32", motion->root_positions);
    write_f32(output / "local_rotations_xyzw.f32", motion->local_rotations_xyzw);
    std::cout << "generated " << motion->frames << " frames with " << motion->joints << " joints\n";
    return 0;
} catch (const std::exception &error) {
    std::cerr << error.what() << '\n';
    return 1;
}
