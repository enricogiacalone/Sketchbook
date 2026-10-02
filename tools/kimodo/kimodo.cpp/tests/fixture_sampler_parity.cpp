#include "diffusion.hpp"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <fstream>
#include <stdexcept>
#include <string>
#include <vector>

namespace {
std::vector<float> read_f32(const std::string &path) {
    std::ifstream in(path, std::ios::binary | std::ios::ate);
    if (!in || in.tellg() < 0 || static_cast<std::size_t>(in.tellg()) % sizeof(float)) throw std::runtime_error("invalid fixture: " + path);
    std::vector<float> values(static_cast<std::size_t>(in.tellg())/sizeof(float));
    in.seekg(0); in.read(reinterpret_cast<char *>(values.data()), static_cast<std::streamsize>(values.size()*sizeof(float)));
    if (!in) throw std::runtime_error("short fixture: " + path); return values;
}
}

int main(int argc, char **argv) try {
    if (argc != 2) { std::fprintf(stderr, "usage: kimodo-fixture-sampler-parity FIXTURE_DIR\n"); return 2; }
    const std::string dir = std::string(argv[1]) + "/";
    const auto root=read_f32(dir+"root_output.f32"), body=read_f32(dir+"body_output.f32"), expected=read_f32(dir+"sampling_output_0.f32");
    if (root.size() % 15 || body.size() % (3*268)) throw std::runtime_error("unexpected CFG fixture dimensions");
    const size_t frames=root.size()/(3*5); std::vector<float> predicted(expected.size());
    if (expected.size() != frames*273 || body.size()/(3*268) != frames) throw std::runtime_error("unexpected fixture dimensions");
    for(size_t b=0;b<1;++b) for(size_t t=0;t<frames;++t) {
        const size_t out=(b*frames+t)*273;
        for(size_t d=0;d<5;++d) predicted[out+d]=root[(2*frames+t)*5+d] + 2.f*(root[(0*frames+t)*5+d]-root[(2*frames+t)*5+d]) + 2.f*(root[(1*frames+t)*5+d]-root[(2*frames+t)*5+d]);
        for(size_t d=0;d<268;++d) predicted[out+5+d]=body[(2*frames+t)*268+d] + 2.f*(body[(0*frames+t)*268+d]-body[(2*frames+t)*268+d]) + 2.f*(body[(1*frames+t)*268+d]-body[(2*frames+t)*268+d]);
    }
    float max_abs=0.f; for(size_t i=0;i<predicted.size();++i) max_abs=std::max(max_abs,std::abs(predicted[i]-expected[i]));
    std::printf("one-step CFG/DDIM fixture max_abs=%g\n",max_abs);
    return max_abs < 2.e-4f ? 0 : 1;
} catch(const std::exception &e) { std::fprintf(stderr,"fixture sampler parity error: %s\n",e.what()); return 1; }
