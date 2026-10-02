#include <kimodo/kimodo_capi.h>
#include <kimodo/kimodo.hpp>

#include <algorithm>
#include <array>
#include <cstring>
#include <memory>
#include <string>

struct kimodo_model { std::unique_ptr<kimodo::model> value; std::string last_error; };
struct kimodo_motion { kimodo::motion_data value; };
namespace {
void set_error(kimodo_model *model, char *buffer, int length, const std::string &message) noexcept {
    if (model) model->last_error = message;
    if (!buffer || length <= 0) return;
    const size_t n = std::min(message.size(), static_cast<size_t>(length - 1));
    std::memcpy(buffer, message.data(), n); buffer[n] = '\0';
}
bool valid_options(const kimodo_generation_options *o, std::string &error) {
    if (!o || o->size != sizeof(*o)) { error = "invalid kimodo_generation_options"; return false; }
    return true;
}
}
extern "C" {
int kimodo_abi_version(void) { return KIMODO_CAPI_ABI_VERSION; }
kimodo_model *kimodo_model_load(const char *motion, const char *text, const char *adapter, const kimodo_runtime_options *options, char *err, int err_len) {
    try {
        if (!motion || !*motion) { set_error(nullptr, err, err_len, "motion_gguf is required"); return nullptr; }
        if (options && options->size != sizeof(*options)) { set_error(nullptr, err, err_len, "invalid kimodo_runtime_options"); return nullptr; }
        if (adapter && *adapter) { set_error(nullptr, err, err_len, "separate text adapters are unsupported; convert a merged native text bundle"); return nullptr; }
        auto loaded = kimodo::model::load(motion, text ? text : "");
        if (!loaded) { set_error(nullptr, err, err_len, loaded.error()); return nullptr; }
        return new kimodo_model{std::move(*loaded), {}};
    } catch (const std::exception &e) { set_error(nullptr, err, err_len, e.what()); return nullptr; }
    catch (...) { set_error(nullptr, err, err_len, "unknown C++ exception"); return nullptr; }
}
void kimodo_model_free(kimodo_model *m) { delete m; }
const char *kimodo_model_last_error(const kimodo_model *m) { return m ? m->last_error.c_str() : "invalid model"; }
kimodo_motion *kimodo_generate(kimodo_model *m, const char *prompt, const kimodo_generation_options *o, char *err, int len) {
    try {
        std::string error;
        if (!m || !m->value) { set_error(m, err, len, "invalid model"); return nullptr; }
        if (!prompt) { set_error(m, err, len, "UTF-8 prompt is required"); return nullptr; }
        if (!valid_options(o, error)) { set_error(m, err, len, error); return nullptr; }
        auto generated = m->value->generate_text(prompt, o->frames, o->diffusion_steps, o->seed, o->text_cfg_weight, o->constraint_cfg_weight);
        if (!generated) { set_error(m, err, len, generated.error()); return nullptr; }
        m->last_error.clear(); return new kimodo_motion{std::move(*generated)};
    } catch (const std::exception &x) { set_error(m, err, len, x.what()); return nullptr; }
    catch (...) { set_error(m, err, len, "unknown C++ exception"); return nullptr; }
}
kimodo_motion *kimodo_generate_embedding(kimodo_model *m, const kimodo_embedding *e, const kimodo_generation_options *o, char *err, int len) {
    try {
        std::string error;
        if (!m || !m->value) { set_error(m, err, len, "invalid model"); return nullptr; }
        if (!e || !e->data || e->values != kimodo::embedding_width) { set_error(m, err, len, "embedding must contain exactly 4096 values"); return nullptr; }
        if (!valid_options(o, error)) { set_error(m, err, len, error); return nullptr; }
        std::array<float, kimodo::embedding_width> values;
        std::copy_n(e->data, values.size(), values.data());
        auto generated = m->value->generate_embedding(values, o->frames, o->diffusion_steps, o->seed, o->text_cfg_weight, o->constraint_cfg_weight);
        if (!generated) { set_error(m, err, len, generated.error()); return nullptr; }
        m->last_error.clear(); return new kimodo_motion{std::move(*generated)};
    } catch (const std::exception &x) { set_error(m, err, len, x.what()); return nullptr; }
    catch (...) { set_error(m, err, len, "unknown C++ exception"); return nullptr; }
}
void kimodo_motion_free(kimodo_motion *m) { delete m; }
int kimodo_motion_frames(const kimodo_motion *m) { return m ? static_cast<int>(m->value.frames) : 0; }
int kimodo_motion_joints(const kimodo_motion *m) { return m ? static_cast<int>(m->value.joints) : 0; }
const float *kimodo_motion_local_rotations_xyzw(const kimodo_motion *m) { return m && !m->value.local_rotations_xyzw.empty() ? m->value.local_rotations_xyzw.data() : nullptr; }
const float *kimodo_motion_root_positions(const kimodo_motion *m) { return m && !m->value.root_positions.empty() ? m->value.root_positions.data() : nullptr; }
}
