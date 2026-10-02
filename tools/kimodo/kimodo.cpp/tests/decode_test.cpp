#include "ggml_weights.hpp"
#include "motion_decode.hpp"
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <fstream>
#include <stdexcept>
#include <string>
#include <vector>
static std::vector<float> r(const std::string&p){std::ifstream f(p,std::ios::binary|std::ios::ate);std::vector<float>x(size_t(f.tellg())/4);f.seekg(0);f.read(reinterpret_cast<char*>(x.data()),std::streamsize(x.size()*4));return x;}
int main(int c,char**v)try{if(c!=3)return 2;auto w=kimodo::detail::ggml_motion_weights::load(v[1]);if(!w)throw std::runtime_error(w.error());auto x=r(std::string(v[2])+"/sampling_final_state.f32");auto gm=(**w).f32_values("stats.global_root.mean");auto gs=(**w).f32_values("stats.global_root.std");auto bm=(**w).f32_values("stats.body.mean");auto bs=(**w).f32_values("stats.body.std");auto d=kimodo::detail::decode_smplx22(x,8,*gm,*gs,*bm,*bs);if(!d)throw std::runtime_error(d.error());auto root=r(std::string(v[2])+"/motion_root_positions.f32"),rot=r(std::string(v[2])+"/motion_local_rot_mats.f32");float mr=0,mm=0;for(size_t i=0;i<root.size();++i)mr=std::max(mr,std::abs(root[i]-d->root_positions[i]));for(size_t i=0;i<8*22;++i){const float*q=d->local_xyzw.data()+i*4;float X=q[0],Y=q[1],Z=q[2],W=q[3];float a[]={1-2*(Y*Y+Z*Z),2*(X*Y-Z*W),2*(X*Z+Y*W),2*(X*Y+Z*W),1-2*(X*X+Z*Z),2*(Y*Z-X*W),2*(X*Z-Y*W),2*(Y*Z+X*W),1-2*(X*X+Y*Y)};for(int j=0;j<9;++j)mm=std::max(mm,std::abs(a[j]-rot[i*9+j]));}std::printf("decode root max_abs=%g rot_matrix=%g\n",mr,mm);return mr<3.e-4f&&mm<3.e-4f?0:1;}catch(const std::exception&e){std::fprintf(stderr,"%s\n",e.what());return 1;}
