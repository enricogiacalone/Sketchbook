#include "motion_rep.hpp"

#include <cmath>

namespace kimodo::detail {
std::expected<std::vector<float>, std::string> global_root_to_local_root(
    std::span<const float> root, std::span<const float> mask,
    std::size_t batch, std::size_t frames,
    std::span<const float> global_mean, std::span<const float> global_std,
    std::span<const float> local_mean, std::span<const float> local_std, float fps) {
    if (batch == 0 || frames < 2 || root.size() != batch*frames*5 || mask.size() != batch*frames ||
        global_mean.size() != 5 || global_std.size() != 5 || local_mean.size() != 4 || local_std.size() != 4 ||
        !std::isfinite(fps) || fps <= 0.f) return std::unexpected("invalid global-root conversion input");
    for (float x : global_std) if (!std::isfinite(x) || x == 0.f) return std::unexpected("invalid global root standard deviation");
    for (float x : local_std) if (!std::isfinite(x) || x == 0.f) return std::unexpected("invalid local root standard deviation");
    // Match kimodo.motion_rep.stats.Stats: sqrt(std**2 + eps), eps=1e-5.
    auto scale=[](float stddev) { return std::sqrt(stddev*stddev + 1.e-5f); };
    std::vector<float> result(batch*frames*4);
    for (std::size_t b=0;b<batch;++b) {
        std::size_t length=0; for(std::size_t t=0;t<frames;++t) length += mask[b*frames+t] > .5f;
        if (length < 2 || length > frames) return std::unexpected("invalid root motion mask length");
        std::vector<float> angle(frames), x(frames), y(frames), z(frames);
        for (std::size_t t=0;t<frames;++t) {
            const auto p=(b*frames+t)*5;
            x[t]=root[p]*scale(global_std[0])+global_mean[0]; y[t]=root[p+1]*scale(global_std[1])+global_mean[1]; z[t]=root[p+2]*scale(global_std[2])+global_mean[2];
            angle[t]=std::atan2(root[p+4]*scale(global_std[4])+global_mean[4], root[p+3]*scale(global_std[3])+global_mean[3]);
        }
        for(std::size_t t=0;t<frames;++t) {
            const std::size_t next=t+1<length?t+1:length-1, previous=t+1<length?t:length-2;
            const float cos_diff=std::cos(angle[next])*std::cos(angle[previous])+std::sin(angle[next])*std::sin(angle[previous]);
            const float sin_diff=std::sin(angle[next])*std::cos(angle[previous])-std::cos(angle[next])*std::sin(angle[previous]);
            const float raw[]{fps*std::atan2(sin_diff,cos_diff), fps*(x[next]-x[previous]), fps*(z[next]-z[previous]), y[t]};
            for(std::size_t d=0;d<4;++d) result[(b*frames+t)*4+d]=(raw[d]-local_mean[d])/scale(local_std[d]);
        }
    }
    return result;
}
} // namespace kimodo::detail
