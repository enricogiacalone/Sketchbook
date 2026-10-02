#include "diffusion.hpp"
#include <cassert>
#include <cmath>

int main() {
    auto schedule = kimodo::detail::make_cosine_schedule(1000, 100);
    assert(schedule && schedule->use_timesteps.front() == 0 && schedule->use_timesteps.back() == 999);
    float text[]{3.f, 5.f}, constraint[]{2.f, 9.f}, uncond[]{1.f, 1.f}, result[2]{};
    assert(kimodo::detail::separated_cfg(text, constraint, uncond, 2.f, .5f, result, 2));
    assert(result[0] == 5.5f && result[1] == 13.f);
    float x[]{.4f}, pred[]{.1f}, next[1]{};
    assert(kimodo::detail::ddim_step(*schedule, 1, x, pred, next, 1));
    assert(std::isfinite(next[0]));
}
