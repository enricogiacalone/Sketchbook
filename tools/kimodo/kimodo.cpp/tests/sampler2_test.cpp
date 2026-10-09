#include "denoiser.hpp"
#include "ggml_weights.hpp"
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <fstream>
#include <stdexcept>
#include <string>
#include <vector>
static std::vector<float> readf(const std::string&p){std::ifstream f(p,std::ios::binary|std::ios::ate);if(!f||f.tellg()<0)throw std::runtime_error("missing fixture: "+p);std::vector<float>x(size_t(f.tellg())/4);f.seekg(0);f.read(reinterpret_cast<char*>(x.data()),std::streamsize(x.size()*4));return x;}
int main(int c,char**v)try{if(c!=5)return 2;auto w=kimodo::detail::ggml_motion_weights::load(v[1]);if(!w)throw std::runtime_error(w.error());std::string d=std::string(v[2])+"/";auto o=kimodo::detail::sample_motion_from_noise(**w,readf(d+"sampling_initial_noise.f32"),readf(d+"text_features.f32"),std::stoul(v[3]),unsigned(std::stoul(v[4])),2.f,2.f);if(!o)throw std::runtime_error(o.error());auto e=readf(d+"sampling_final_state.f32");float m=0;for(size_t i=0;i<e.size();++i)m=std::max(m,std::abs(e[i]-(*o)[i]));std::printf("sampler max_abs=%g\n",m);return m<3.e-3f?0:1;}catch(const std::exception&e){std::fprintf(stderr,"%s\n",e.what());return 1;}
