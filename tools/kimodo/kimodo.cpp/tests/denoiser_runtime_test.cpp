#include "denoiser.hpp"
#include "ggml_weights.hpp"
#include <algorithm>
#include <cmath>
#include <cstring>
#include <cstdio>
#include <fstream>
#include <stdexcept>
#include <string>
#include <vector>
static std::vector<float> read(const std::string&p){std::ifstream f(p,std::ios::binary|std::ios::ate);if(!f||f.tellg()<0)throw std::runtime_error("bad fixture");std::vector<float>x(size_t(f.tellg())/4);f.seekg(0);f.read(reinterpret_cast<char*>(x.data()),std::streamsize(x.size()*4));return x;}
int main(int argc,char**argv)try{if(argc!=4)return 2;const std::string dir=std::string(argv[2])+"/",stage=argv[3];auto w=kimodo::detail::ggml_motion_weights::load(argv[1]);if(!w)throw std::runtime_error(w.error());std::expected<std::vector<float>,std::string> out=std::unexpected("unset");std::vector<float> ref;if(stage=="full"){out=kimodo::detail::run_two_stage_denoiser(**w,read(dir+"root_input_0.f32"),read(dir+"root_input_2.f32"),read(dir+"root_input_4.f32"),read(dir+"root_input_5.f32"),read(dir+"root_input_1.f32"),3,8);auto r=read(dir+"root_output.f32"),b=read(dir+"body_output.f32");ref.resize(3*8*273);for(int i=0;i<24;++i){std::memcpy(ref.data()+i*273,r.data()+i*5,5*sizeof(float));std::memcpy(ref.data()+i*273+5,b.data()+i*268,268*sizeof(float));}}else if(stage=="cfg"){auto t=read(dir+"root_input_4.f32");out=kimodo::detail::run_separated_cfg_denoiser(**w,read(dir+"sampling_input_0.f32"),read(dir+"text_features.f32"),t[0],2.f,2.f,8);ref=read(dir+"sampling_output_0.f32");}else if(stage=="sample"){out=kimodo::detail::sample_motion_from_noise(**w,read(dir+"sampling_initial_noise.f32"),read(dir+"text_features.f32"),8,1,2.f,2.f);ref=read(dir+"sampling_final_state.f32");}else{const size_t dim=stage=="root"?546:545;out=kimodo::detail::run_motion_transformer(**w,stage+"_model.",read(dir+stage+"_input_0.f32"),dim,read(dir+stage+"_input_2.f32"),read(dir+stage+"_input_4.f32"),read(dir+stage+"_input_5.f32"),3,8);ref=read(dir+stage+"_output.f32");}if(!out)throw std::runtime_error(out.error());float m=0;for(size_t i=0;i<ref.size();++i)m=std::max(m,std::abs((*out)[i]-ref[i]));std::printf("runtime %s max_abs=%g\n",stage.c_str(),m);return m<2.e-3f?0:1;}catch(const std::exception&e){std::fprintf(stderr,"%s\n",e.what());return 1;}
