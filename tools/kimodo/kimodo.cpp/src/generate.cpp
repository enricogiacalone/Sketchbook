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
#include <cmath>

namespace {
void write_f32(const std::filesystem::path &path, const std::vector<float> &values) {
    std::ofstream out(path, std::ios::binary | std::ios::trunc);
    if (!out) throw std::runtime_error("cannot open " + path.string());
    out.write(reinterpret_cast<const char *>(values.data()),
              static_cast<std::streamsize>(values.size() * sizeof(float)));
    if (!out) throw std::runtime_error("cannot write " + path.string());
}
}

std::vector<float> read_f32(const std::filesystem::path &path) {
    std::ifstream in(path, std::ios::binary | std::ios::ate);
    if (!in) throw std::runtime_error("cannot open " + path.string());
    std::vector<float> values(static_cast<std::size_t>(in.tellg()) / sizeof(float));
    in.seekg(0);
    in.read(reinterpret_cast<char *>(values.data()), static_cast<std::streamsize>(values.size() * sizeof(float)));
    return values;
}

// "DIR:FRAME[:HOLD[:HEADING_DEG]]" -> a pose taken from a generated clip folder
kimodo::pose_key load_key(const std::string &spec, unsigned at_frame, bool free_xz) {
    std::vector<std::string> part;
    for (std::size_t from = 0, to; ; from = to + 1) {
        to = spec.find(':', from);
        part.push_back(spec.substr(from, to == std::string::npos ? std::string::npos : to - from));
        if (to == std::string::npos) break;
    }
    const std::filesystem::path dir(part.at(0));
    const auto root = read_f32(dir / "root_positions.f32");
    const auto rot = read_f32(dir / "local_rotations_xyzw.f32");
    const std::size_t frames = root.size() / 3, joints = rot.size() / (frames * 4);
    const std::size_t src = part.size() > 1 ? std::stoul(part[1]) : 0;
    if (src >= frames) throw std::runtime_error("pose frame out of range in " + spec);
    kimodo::pose_key key;
    key.frame = at_frame;
    key.hold = part.size() > 2 ? static_cast<unsigned>(std::stoul(part[2])) : 8;
    key.heading = part.size() > 3 ? std::stof(part[3]) * 3.14159265F / 180.F : 0.F;
    key.free_xz = free_xz;
    key.root_y = root[src * 3 + 1];
    key.local_rotations_xyzw.assign(rot.begin() + static_cast<std::ptrdiff_t>(src * joints * 4),
                                    rot.begin() + static_cast<std::ptrdiff_t>((src + 1) * joints * 4));
    return key;
}

int main(int argc, char **argv) try {
    // pose-conditioned: MOTION TEXT PROMPT FRAMES STEPS SEED OUTDIR [--start DIR:FRAME[:HOLD[:DEG]]] [--end DIR:FRAME[:HOLD[:DEG]]]
    if (argc >= 10 && std::string_view(argv[8]) != "" && (std::string_view(argv[8]) == "--start" || std::string_view(argv[8]) == "--end")) {
        std::ifstream prompt_file(argv[3]);
        const std::string prompt{std::istreambuf_iterator<char>(prompt_file), {}};
        if (!prompt_file && prompt.empty()) throw std::runtime_error("cannot read prompt");
        const auto frames = static_cast<unsigned>(std::stoul(argv[4]));
        const auto steps = static_cast<unsigned>(std::stoul(argv[5]));
        const auto seed = static_cast<std::uint64_t>(std::stoull(argv[6]));
        std::vector<kimodo::pose_key> keys;
        for (int i = 8; i + 1 < argc; i += 2) {
            const std::string flag = argv[i];
            if (flag == "--start") keys.push_back(load_key(argv[i + 1], 0, false));
            else if (flag == "--end") {
                auto key = load_key(argv[i + 1], 0, true);
                if (key.hold >= frames) throw std::runtime_error("end hold longer than the clip");
                key.frame = frames - key.hold;
                keys.push_back(std::move(key));
            } else throw std::runtime_error("unknown option " + flag);
        }
        auto model = kimodo::model::load(argv[1], argv[2]);
        if (!model) throw std::runtime_error(model.error());
        auto motion = (*model)->generate_text_posed(prompt, frames, steps, seed, 2.F, 2.F, keys);
        if (!motion) throw std::runtime_error(motion.error());
        const std::filesystem::path output(argv[7]);
        std::filesystem::create_directories(output);
        write_f32(output / "root_positions.f32", motion->root_positions);
        write_f32(output / "local_rotations_xyzw.f32", motion->local_rotations_xyzw);
        std::cout << "generated " << motion->frames << " frames with " << motion->joints << " joints\n";
        return 0;
    }
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
