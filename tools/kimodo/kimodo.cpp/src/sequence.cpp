#include "denoiser.hpp"
#include "ggml_weights.hpp"
#include "skeleton.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <vector>

namespace kimodo::detail {
namespace {
struct mat { double v[9]; };
mat mul(const mat&a,const mat&b){mat r{};for(int i=0;i<3;++i)for(int j=0;j<3;++j)for(int k=0;k<3;++k)r.v[i*3+j]+=a.v[i*3+k]*b.v[k*3+j];return r;}
mat trans(const mat&a){mat r{};for(int i=0;i<3;++i)for(int j=0;j<3;++j)r.v[i*3+j]=a.v[j*3+i];return r;}
mat cont6(const float*x){double a[3]={x[0],x[1],x[2]},n=std::sqrt(a[0]*a[0]+a[1]*a[1]+a[2]*a[2]);for(double&q:a)q/=n;double z[3]={a[1]*x[5]-a[2]*x[4],a[2]*x[3]-a[0]*x[5],a[0]*x[4]-a[1]*x[3]};n=std::sqrt(z[0]*z[0]+z[1]*z[1]+z[2]*z[2]);for(double&q:z)q/=n;double b[3]={z[1]*a[2]-z[2]*a[1],z[2]*a[0]-z[0]*a[2],z[0]*a[1]-z[1]*a[0]};return{{a[0],b[0],z[0],a[1],b[1],z[1],a[2],b[2],z[2]}};}
void rotate(const mat&m,const std::array<float,3>&x,float*o){for(int i=0;i<3;++i)o[i]=static_cast<float>(m.v[i*3]*x[0]+m.v[i*3+1]*x[1]+m.v[i*3+2]*x[2]);}

// Reconstruct the full-body/end-effector condition used by upstream
// `_multiprompt`, generalized over the three released skeleton layouts.
float condition_row(const float *raw, const skeleton_spec &s, float *value) {
    const size_t D=s.motion_dim(),J=s.joints(),rotation_begin=5+3*J;
    std::copy_n(raw,D,value);
    std::vector<mat> decoded(J),local(J),global(J);
    for(size_t j=0;j<J;++j)decoded[j]=cont6(value+rotation_begin+j*6);
    for(size_t j=0;j<J;++j)local[j]=s.parents[j]<0?decoded[j]:mul(trans(decoded[static_cast<size_t>(s.parents[j])]),decoded[j]);
    const float root[3]={value[0]+value[5],value[6],value[2]+value[7]};
    std::vector<std::array<float,3>> posed(J);
    for(size_t j=0;j<J;++j){const int parent=s.parents[j];if(parent<0){global[j]=local[j];posed[j]={root[0],root[1],root[2]};}else{global[j]=mul(global[static_cast<size_t>(parent)],local[j]);float offset[3];rotate(global[static_cast<size_t>(parent)],s.offsets[j],offset);for(int k=0;k<3;++k)posed[j][k]=posed[static_cast<size_t>(parent)][k]+offset[k];}}
    const auto right=s.hips[0],left=s.hips[1];
    const float angle=std::atan2(posed[right][2]-posed[left][2],-(posed[right][0]-posed[left][0]));
    value[1]=root[1];value[3]=std::cos(angle);value[4]=std::sin(angle);
    for(size_t j=0;j<J;++j){value[5+j*3]=posed[j][0]-value[0];value[6+j*3]=posed[j][1];value[7+j*3]=posed[j][2]-value[2];}
    for(unsigned joint:s.end_effectors)for(int d=0;d<6;++d)value[rotation_begin+joint*6+static_cast<size_t>(d)]=static_cast<float>(global[joint].v[(d%3)*3+d/3]);
    return angle;
}
}

std::expected<sequence_transition, std::string> prepare_sequence_transition(
    const ggml_motion_weights &weights, std::span<const float> previous,
    std::size_t continuation_frames, unsigned transition_frames) {
    const auto *s=find_skeleton(weights.skeleton_key());
    if(!s)return std::unexpected("unsupported sequence skeleton");
    const size_t D=s->motion_dim(),J=s->joints(),rotation_begin=5+3*J,rotation_end=rotation_begin+6*J,overlap=transition_frames;
    if(!overlap||overlap>=continuation_frames||previous.size()<=overlap*D||previous.size()%D)
        return std::unexpected("invalid sequence transition");
    sequence_transition result;
    result.observed.resize((continuation_frames+overlap)*D);
    result.observed_mask.resize(result.observed.size());
    const size_t previous_start=previous.size()-overlap*D;
    std::vector<float> value(D);
    for(size_t frame=0;frame<overlap;++frame){const size_t base=frame*D;condition_row(previous.data()+previous_start+base,*s,value.data());std::copy_n(value.data(),rotation_end,result.observed.data()+base);std::fill(result.observed_mask.begin()+static_cast<std::ptrdiff_t>(base),result.observed_mask.begin()+static_cast<std::ptrdiff_t>(base+rotation_begin),1.F);for(unsigned joint:s->end_effectors){const size_t first=base+rotation_begin+joint*6;std::fill(result.observed_mask.begin()+static_cast<std::ptrdiff_t>(first),result.observed_mask.begin()+static_cast<std::ptrdiff_t>(first+6),1.F);}}
    result.origin_x=result.observed[0];result.origin_z=result.observed[2];
    for(size_t frame=0;frame<overlap;++frame){auto*row=result.observed.data()+frame*D;row[0]-=result.origin_x;row[2]-=result.origin_z;}
    result.first_heading=condition_row(previous.data()+previous_start,*s,value.data());
    return result;
}

std::expected<std::vector<float>, std::string> sample_motion_sequence_from_noise(
    const ggml_motion_weights &weights, std::span<const sampled_sequence_segment> segments,
    unsigned transition_frames, unsigned steps, float text_weight, float constraint_weight) {
    const size_t D=weights.motion_dim(),body=D-5;
    if(segments.empty()||!transition_frames||!D)return std::unexpected("sequence requires segments and a transition");
    auto gm=weights.f32_values("stats.global_root.mean"),gs=weights.f32_values("stats.global_root.std");
    auto bm=weights.f32_values("stats.body.mean"),bs=weights.f32_values("stats.body.std");
    if(!gm||!gs||!bm||!bs||gm->size()!=5||gs->size()!=5||bm->size()!=body||bs->size()!=body)return std::unexpected("motion GGUF lacks compatible motion statistics");
    auto scale=[](float stddev){return std::sqrt(stddev*stddev+1.e-5F);};
    auto unnormalize=[&](std::vector<float>&motion){for(size_t row=0;row<motion.size()/D;++row){auto*v=motion.data()+row*D;for(size_t d=0;d<5;++d)v[d]=v[d]*scale((*gs)[d])+(*gm)[d];for(size_t d=0;d<body;++d)v[5+d]=v[5+d]*scale((*bs)[d])+(*bm)[d];}};
    auto normalize=[&](std::vector<float>&motion){for(size_t row=0;row<motion.size()/D;++row){auto*v=motion.data()+row*D;for(size_t d=0;d<5;++d)v[d]=(v[d]-(*gm)[d])/scale((*gs)[d]);for(size_t d=0;d<body;++d)v[5+d]=(v[5+d]-(*bm)[d])/scale((*bs)[d]);}};
    std::vector<float> joined,previous;
    for(size_t index=0;index<segments.size();++index){const auto&segment=segments[index];const size_t sampled_frames=segment.frames+(index?transition_frames:0);if(segment.frames<2||segment.embedding.size()!=4096||segment.initial_noise.size()!=sampled_frames*D)return std::unexpected("invalid sampled sequence segment");std::vector<float>current;if(!index){auto sampled=sample_motion_from_noise(weights,segment.initial_noise,segment.embedding,sampled_frames,steps,text_weight,constraint_weight);if(!sampled)return std::unexpected(sampled.error());current=std::move(*sampled);unnormalize(current);}else{const size_t overlap=transition_frames;if(overlap>=segment.frames||previous.size()<overlap*D)return std::unexpected("transition must be shorter than every following segment");auto transition=prepare_sequence_transition(weights,previous,segment.frames,transition_frames);if(!transition)return std::unexpected(transition.error());const float origin_x=transition->origin_x,origin_z=transition->origin_z;normalize(transition->observed);auto sampled=sample_motion_from_noise_conditioned(weights,segment.initial_noise,segment.embedding,transition->observed,transition->observed_mask,transition->first_heading,sampled_frames,steps,text_weight,constraint_weight);if(!sampled)return std::unexpected(sampled.error());current=std::move(*sampled);unnormalize(current);for(size_t frame=0;frame<sampled_frames;++frame){auto*row=current.data()+frame*D;row[0]+=origin_x;row[2]+=origin_z;}const size_t start=joined.size()-overlap*D;for(size_t frame=0;frame<overlap;++frame){const float alpha=overlap==1?.5F:1.F-float(frame)/float(overlap-1);for(size_t d=0;d<D;++d)joined[start+frame*D+d]=alpha*joined[start+frame*D+d]+(1.F-alpha)*current[frame*D+d];}joined.insert(joined.end(),current.begin()+static_cast<std::ptrdiff_t>(overlap*D),current.end());}if(!index)joined=current;previous=std::move(current);}
    return joined;
}

namespace {
mat quat_matrix(const float *q) {
    double x=q[0],y=q[1],z=q[2],w=q[3],n=std::sqrt(x*x+y*y+z*z+w*w);
    if(n<1.e-12)return{{1,0,0,0,1,0,0,0,1}};
    x/=n;y/=n;z/=n;w/=n;
    return{{1-2*(y*y+z*z),2*(x*y-z*w),2*(x*z+y*w),2*(x*y+z*w),1-2*(x*x+z*z),2*(y*z-x*w),2*(x*z-y*w),2*(y*z+x*w),1-2*(x*x+y*y)}};
}

// Motion-representation row (raw, un-normalized, up to the rotation block) for
// a SOMA pose: local rotations -> global 6D rotations, pelvis at (0, y, 0),
// everything else (positions, heading, end-effector rotations) derived by
// condition_row exactly as the multi-prompt path does. Returns the heading.
float pose_row(const pose_key &key, const skeleton_spec &s, float yaw, float *out) {
    const size_t D=s.motion_dim(),J=s.joints(),rotation_begin=5+3*J;
    std::vector<float> raw(D,0.F);
    std::vector<mat> local(J),global(J);
    const double c=std::cos(yaw),sn=std::sin(yaw);
    const mat ry{{c,0,sn,0,1,0,-sn,0,c}};
    for(size_t j=0;j<J;++j)local[j]=quat_matrix(key.local_xyzw.data()+j*4);
    local[0]=mul(ry,local[0]);
    for(size_t j=0;j<J;++j)global[j]=s.parents[j]<0?local[j]:mul(global[static_cast<size_t>(s.parents[j])],local[j]);
    raw[6]=key.root_y;
    for(size_t j=0;j<J;++j)for(int d=0;d<6;++d)raw[rotation_begin+j*6+static_cast<size_t>(d)]=static_cast<float>(global[j].v[(d%3)*3+d/3]);
    return condition_row(raw.data(),s,out);
}
}

std::expected<std::vector<float>, std::string> sample_motion_with_pose_keys(
    const ggml_motion_weights &weights, std::span<const float> initial_noise,
    std::span<const float> embedding, std::size_t frames, unsigned steps,
    float text_weight, float constraint_weight, std::span<const pose_key> keys) {
    const auto *s=find_skeleton(weights.skeleton_key());
    if(!s)return std::unexpected("unsupported pose-key skeleton");
    const size_t D=s->motion_dim(),J=s->joints(),body=D-5,rotation_begin=5+3*J,rotation_end=rotation_begin+6*J;
    auto gm=weights.f32_values("stats.global_root.mean"),gs=weights.f32_values("stats.global_root.std");
    auto bm=weights.f32_values("stats.body.mean"),bs=weights.f32_values("stats.body.std");
    if(!gm||!gs||!bm||!bs||gm->size()!=5||gs->size()!=5||bm->size()!=body||bs->size()!=body)return std::unexpected("motion GGUF lacks compatible motion statistics");
    if(keys.empty())return std::unexpected("pose keys required");
    std::vector<float> observed(frames*D,0.F),mask(frames*D,0.F),value(D);
    float heading=0.F;
    bool have_first=false;
    for(const auto&key:keys){
        if(key.local_xyzw.size()!=J*4||!key.hold||key.frame+key.hold>frames)return std::unexpected("invalid pose key");
        // measure the pose's own heading, then rotate it to the requested one
        const float own=pose_row(key,*s,0.F,value.data());
        const float angle=pose_row(key,*s,key.heading-own,value.data());
        if(key.frame==0&&!have_first){heading=angle;have_first=true;}
        if(std::getenv("KIMODO_DEBUG"))std::fprintf(stderr,"pose key frame %zu hold %zu: own heading %.3f -> %.3f, root y %.3f\n",key.frame,key.hold,own,angle,value[1]);
        for(size_t f=key.frame;f<key.frame+key.hold;++f){
            float*o=observed.data()+f*D,*m=mask.data()+f*D;
            std::copy_n(value.data(),rotation_end,o);
            std::fill(m,m+rotation_begin,1.F);
            if(key.free_xz){m[0]=0.F;m[2]=0.F;}
            for(unsigned joint:s->end_effectors)std::fill(m+rotation_begin+joint*6,m+rotation_begin+joint*6+6,1.F);
            auto scale=[](float v){return std::sqrt(v*v+1.e-5F);};
            for(size_t d=0;d<5;++d)o[d]=(o[d]-(*gm)[d])/scale((*gs)[d]);
            for(size_t d=0;d<rotation_end-5;++d)o[5+d]=(o[5+d]-(*bm)[d])/scale((*bs)[d]);
        }
    }
    return sample_motion_from_noise_conditioned(weights,initial_noise,embedding,observed,mask,heading,frames,steps,text_weight,constraint_weight);
}
} // namespace kimodo::detail
