#include <kimodo/kimodo.hpp>
#include <array>
#include <cstdio>
#include <fstream>
int main(int argc,char**argv){if(argc<2||argc>4)return 2;const unsigned joints=argc>=3?static_cast<unsigned>(std::stoul(argv[2])):22;auto m=kimodo::model::load(argv[1]);if(!m){std::fprintf(stderr,"%s\n",m.error().c_str());return 1;}std::array<float,kimodo::embedding_width> e{};auto r=(*m)->generate_embedding(e,2,1,42,2.f,2.f);if(!r){std::fprintf(stderr,"%s\n",r.error().c_str());return 1;}if(r->frames!=2||r->joints!=joints||r->root_positions.size()!=6||r->local_rotations_xyzw.size()!=2*joints*4)return 1;if(argc==4){std::ofstream out(argv[3],std::ios::binary);out.write(reinterpret_cast<const char*>(r->root_positions.data()),static_cast<std::streamsize>(r->root_positions.size()*sizeof(float)));out.write(reinterpret_cast<const char*>(r->local_rotations_xyzw.data()),static_cast<std::streamsize>(r->local_rotations_xyzw.size()*sizeof(float)));if(!out)return 1;}return 0;}
