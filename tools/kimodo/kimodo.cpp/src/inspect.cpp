#include <kimodo/kimodo.hpp>

#include <cstdio>

#if defined(KIMODO_HAVE_GGML)
#include <gguf.h>
#endif

int main(int argc, char **argv) {
    if (argc != 2) { std::fprintf(stderr, "usage: kmd-inspect MOTION.gguf\n"); return 2; }
    auto model = kimodo::model::load(argv[1]);
    if (!model) { std::fprintf(stderr, "invalid Kimodo motion GGUF: %s\n", model.error().c_str()); return 1; }
#if defined(KIMODO_HAVE_GGML)
    ggml_context *tensor_context = nullptr;
    gguf_init_params parameters{true, &tensor_context};
    gguf_context *file = gguf_init_from_file(argv[1], parameters);
    if (!file || !tensor_context || gguf_get_n_tensors(file) != 414) {
        if (file) gguf_free(file);
        if (tensor_context) ggml_free(tensor_context);
        std::fputs("GGML rejected the otherwise valid GGUF\n", stderr);
        return 1;
    }
    gguf_free(file); ggml_free(tensor_context);
#endif
    std::puts("Kimodo motion GGUF: valid (414 F32 tensors)");
}
