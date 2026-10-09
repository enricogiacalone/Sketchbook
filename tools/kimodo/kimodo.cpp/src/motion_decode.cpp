#include "motion_decode.hpp"
#include "skeleton.hpp"
#include <cmath>
#include <vector>
namespace kimodo::detail { namespace {
struct M{float v[9];};
M mul(const M&a,const M&b){M r{};for(int i=0;i<3;++i)for(int j=0;j<3;++j)for(int k=0;k<3;++k)r.v[i*3+j]+=a.v[i*3+k]*b.v[k*3+j];return r;}
M tr(const M&a){M r{};for(int i=0;i<3;++i)for(int j=0;j<3;++j)r.v[i*3+j]=a.v[j*3+i];return r;}
M six(const float*x){float n=std::sqrt(x[0]*x[0]+x[1]*x[1]+x[2]*x[2]);float a[3]={x[0]/n,x[1]/n,x[2]/n};float z[3]={a[1]*x[5]-a[2]*x[4],a[2]*x[3]-a[0]*x[5],a[0]*x[4]-a[1]*x[3]};n=std::sqrt(z[0]*z[0]+z[1]*z[1]+z[2]*z[2]);for(float&v:z)v/=n;float b[3]={z[1]*a[2]-z[2]*a[1],z[2]*a[0]-z[0]*a[2],z[0]*a[1]-z[1]*a[0]};return M{{a[0],b[0],z[0],a[1],b[1],z[1],a[2],b[2],z[2]}};}
void quat(const M&m,float*q){float w,x,y,z,t=m.v[0]+m.v[4]+m.v[8];if(t>0){float s=2*std::sqrt(t+1);w=.25f*s;x=(m.v[7]-m.v[5])/s;y=(m.v[2]-m.v[6])/s;z=(m.v[3]-m.v[1])/s;}else if(m.v[0]>m.v[4]&&m.v[0]>m.v[8]){float s=2*std::sqrt(1+m.v[0]-m.v[4]-m.v[8]);w=(m.v[7]-m.v[5])/s;x=.25f*s;y=(m.v[1]+m.v[3])/s;z=(m.v[2]+m.v[6])/s;}else if(m.v[4]>m.v[8]){float s=2*std::sqrt(1+m.v[4]-m.v[0]-m.v[8]);w=(m.v[2]-m.v[6])/s;x=(m.v[1]+m.v[3])/s;y=.25f*s;z=(m.v[5]+m.v[7])/s;}else{float s=2*std::sqrt(1+m.v[8]-m.v[0]-m.v[4]);w=(m.v[3]-m.v[1])/s;x=(m.v[2]+m.v[6])/s;y=(m.v[5]+m.v[7])/s;z=.25f*s;}q[0]=x;q[1]=y;q[2]=z;q[3]=w;}
}
std::expected<decoded_motion,std::string> decode_motion(std::span<const float>x,size_t T,const skeleton_spec&s,std::span<const float>gm,std::span<const float>gs,std::span<const float>bm,std::span<const float>bs){const size_t D=s.motion_dim(),J=s.joints(),body=D-5,rotation=5+3*J;if(x.size()!=T*D||gm.size()!=5||gs.size()!=5||bm.size()!=body||bs.size()!=body)return std::unexpected("invalid "+std::string(s.key)+" decode inputs");decoded_motion o;o.local_xyzw.resize(T*J*4);o.root_positions.resize(T*3);auto scale=[](float v){return std::sqrt(v*v+1.e-5f);};std::vector<float>f(D);std::vector<M>g(J),l(J);for(size_t t=0;t<T;++t){const float*in=x.data()+t*D;for(size_t i=0;i<5;++i)f[i]=in[i]*scale(gs[i])+gm[i];for(size_t i=0;i<body;++i)f[5+i]=in[5+i]*scale(bs[i])+bm[i];o.root_positions[t*3]=f[0]+f[5];o.root_positions[t*3+1]=f[6];o.root_positions[t*3+2]=f[2]+f[7];for(size_t j=0;j<J;++j)g[j]=six(f.data()+rotation+j*6);for(size_t j=0;j<J;++j)l[j]=s.parents[j]<0?g[j]:mul(tr(g[static_cast<size_t>(s.parents[j])]),g[j]);for(size_t j=0;j<J;++j)quat(l[j],o.local_xyzw.data()+(t*J+j)*4);}return o;}
std::expected<decoded_motion,std::string> decode_smplx22(std::span<const float>x,size_t T,std::span<const float>gm,std::span<const float>gs,std::span<const float>bm,std::span<const float>bs){return decode_motion(x,T,smplx22_spec,gm,gs,bm,bs);}
}
