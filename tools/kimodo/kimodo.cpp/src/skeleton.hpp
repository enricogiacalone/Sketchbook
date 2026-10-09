#pragma once

#include <array>
#include <cstddef>
#include <span>
#include <string_view>

namespace kimodo::detail {

// Joint names and parent graphs are copied from NVIDIA Kimodo's Apache-2.0
// kimodo/skeleton/definitions.py. Parent-local offsets were extracted from
// the accompanying joints.p assets in the trusted reference container.
struct skeleton_spec {
    std::string_view key;
    std::span<const std::string_view> names;
    std::span<const int> parents;
    std::span<const std::array<float, 3>> offsets;
    std::array<unsigned, 2> hips; // right, left
    std::array<unsigned, 4> end_effectors; // left foot, right foot, left hand, right hand

    [[nodiscard]] constexpr std::size_t joints() const noexcept { return names.size(); }
    [[nodiscard]] constexpr std::size_t motion_dim() const noexcept { return 9 + 12 * joints(); }
    [[nodiscard]] constexpr std::size_t body_dim() const noexcept { return motion_dim() - 5; }
};

inline constexpr std::array<std::string_view,22> smplx22_names{
    std::string_view{"pelvis"}, "left_hip", "right_hip", "spine1", "left_knee", "right_knee",
    "spine2", "left_ankle", "right_ankle", "spine3", "left_foot", "right_foot", "neck",
    "left_collar", "right_collar", "head", "left_shoulder", "right_shoulder", "left_elbow",
    "right_elbow", "left_wrist", "right_wrist"};
inline constexpr std::array smplx22_parents{-1,0,0,0,1,2,3,4,5,6,7,8,9,9,9,12,13,14,16,17,18,19};
inline constexpr std::array<std::array<float,3>,22> smplx22_offsets{{
    {0,0,0},{.052299179F,-.093935639F,-.027606763F},{-.057192899F,-.106548190F,-.022217851F},
    {-.001495834F,.112929940F,-.024981268F},{.058866613F,-.416441321F,-.006556974F},
    {-.048074268F,-.397559673F,-.014061437F},{.006900469F,.145636231F,-.006858510F},
    {-.041737989F,-.437583506F,-.029511765F},{.014489345F,-.446852267F,-.018029511F},
    {-.010334037F,.056081813F,.021115851F},{.049293540F,-.065279245F,.126259089F},
    {-.040575184F,-.065286517F,.127075911F},{-.011025756F,.171365142F,-.028827066F},
    {.047724526F,.087643057F,-.008375450F},{-.046636276F,.086612143F,-.014864366F},
    {.024654359F,.175390735F,.024463326F},{.126284808F,.057680372F,-.013885141F},
    {-.109341696F,.053674292F,-.009117880F},{.272907287F,-.069853373F,-.039094493F},
    {-.292028785F,-.035440356F,-.024564851F},{.276173830F,.021254137F,-.002478220F},
    {-.271878421F,-.004834589F,-.016445294F}}};

inline constexpr std::array<std::string_view,30> soma30_names{
    std::string_view{"Hips"}, "Spine1", "Spine2", "Chest", "Neck1", "Neck2", "Head", "Jaw",
    "LeftEye", "RightEye", "LeftShoulder", "LeftArm", "LeftForeArm", "LeftHand",
    "LeftHandThumbEnd", "LeftHandMiddleEnd", "RightShoulder", "RightArm", "RightForeArm",
    "RightHand", "RightHandThumbEnd", "RightHandMiddleEnd", "LeftLeg", "LeftShin", "LeftFoot",
    "LeftToeBase", "RightLeg", "RightShin", "RightFoot", "RightToeBase"};
inline constexpr std::array soma30_parents{-1,0,1,2,3,4,5,6,6,6,3,10,11,12,13,13,3,16,17,18,19,19,0,22,23,24,0,26,27,28};
inline constexpr std::array<std::array<float,3>,30> soma30_offsets{{
    {0,0,0},{-.00013727F,.0500376256F,-.00053726669F},{-1.86574103e-9F,.0712530139F,-.000298248546F},
    {-5.75188398e-9F,.0755006305F,-.00815970992F},{-.00181676517F,.263112953F,-.00553348292F},
    {-2.85102231e-8F,.0770939664F,.0230258546F},{-4.5975437e-8F,.0612891595F,.0195370861F},
    {2.63687901e-5F,.0047559225F,.0309494062F},{.0320638079F,.0538020513F,.0758688308F},
    {-.0322244017F,.05361869F,.0755823359F},{.0162165175F,.232371641F,.0511341324F},
    {.149198457F,2.19397873e-8F,-.0550232576F},{.287393078F,2.50268389e-9F,-2.58787737e-5F},
    {.270939812F,-7.06625108e-9F,2.60897248e-5F},{.122686267F,-.0322017573F,.0483306876F},
    {.190119595F,-.00312878387F,-.000339570373F},{-.0138011824F,.231803086F,.0521415786F},
    {-.150371962F,1.17387901e-7F,-.0554560437F},{-.287366393F,1.87628082e-8F,-2.59709359e-5F},
    {-.271336198F,-1.16767401e-9F,2.61269368e-5F},{-.122642483F,-.0321145448F,.0480403904F},
    {-.190005945F,-.00306615542F,-.0003157343F},{.10043214F,-.0843452671F,.0259565473F},
    {-1e-8F,-.432217537F,-.00802912805F},{1e-8F,-.421550959F,-.0348152298F},
    {0,-.0505947206F,.132315294F},{-.10047278F,-.0829525995F,.0262031695F},
    {1e-8F,-.433622059F,-.00805555828F},{2e-8F,-.421173943F,-.0347839785F},
    {-3.42907669e-9F,-.0507960932F,.132841956F}}};

inline constexpr std::array<std::string_view,34> g1skel34_names{
    std::string_view{"pelvis_skel"}, "left_hip_pitch_skel", "left_hip_roll_skel", "left_hip_yaw_skel",
    "left_knee_skel", "left_ankle_pitch_skel", "left_ankle_roll_skel", "left_toe_base",
    "right_hip_pitch_skel", "right_hip_roll_skel", "right_hip_yaw_skel", "right_knee_skel",
    "right_ankle_pitch_skel", "right_ankle_roll_skel", "right_toe_base", "waist_yaw_skel",
    "waist_roll_skel", "waist_pitch_skel", "left_shoulder_pitch_skel", "left_shoulder_roll_skel",
    "left_shoulder_yaw_skel", "left_elbow_skel", "left_wrist_roll_skel", "left_wrist_pitch_skel",
    "left_wrist_yaw_skel", "left_hand_roll_skel", "right_shoulder_pitch_skel",
    "right_shoulder_roll_skel", "right_shoulder_yaw_skel", "right_elbow_skel",
    "right_wrist_roll_skel", "right_wrist_pitch_skel", "right_wrist_yaw_skel", "right_hand_roll_skel"};
inline constexpr std::array g1skel34_parents{-1,0,1,2,3,4,5,6,0,8,9,10,11,12,13,0,15,16,17,18,19,20,21,22,23,24,17,26,27,28,29,30,31,32};
inline constexpr std::array<std::array<float,3>,34> g1skel34_offsets{{
    {0,0,0},{.064452F,-.1027F,0},{.052F,-.030465F,0},{0,-.12412F,.025001F},
    {.0021489F,-.17734F,-.078273F},{-.000094445F,-.30001F,0},{0,-.017558F,0},{0,-.035F,.14F},
    {-.064452F,-.1027F,0},{-.052F,-.030465F,0},{0,-.12412F,.025001F},{-.0021489F,-.17734F,-.078273F},
    {.000094445F,-.30001F,0},{0,-.017558F,0},{0,-.035F,.14F},{0,0,0},{0,.044F,-.0039635F},
    {0,0,0},{.10022F,.24778F,.0039563F},{.038F,-.013831F,0},{.00624F,-.1032F,0},
    {0,-.080518F,.015783F},{.00188791F,-.01F,.1F},{0,0,.038F},{0,0,.046F},{0,0,.1F},
    {-.10021F,.24778F,.0039563F},{-.038F,-.013831F,0},{-.00624F,-.1032F,0},
    {0,-.080518F,.015783F},{-.00188791F,-.01F,.1F},{0,0,.038F},{0,0,.046F},{0,0,.1F}}};

inline constexpr skeleton_spec smplx22_spec{"smplx22", smplx22_names, smplx22_parents, smplx22_offsets, {2,1}, {7,8,20,21}};
inline constexpr skeleton_spec soma30_spec{"soma30", soma30_names, soma30_parents, soma30_offsets, {26,22}, {24,28,13,19}};
inline constexpr skeleton_spec g1skel34_spec{"g1skel34", g1skel34_names, g1skel34_parents, g1skel34_offsets, {8,1}, {6,13,24,32}};

inline constexpr const skeleton_spec *find_skeleton(std::string_view key) noexcept {
    if (key == smplx22_spec.key) return &smplx22_spec;
    if (key == soma30_spec.key) return &soma30_spec;
    if (key == g1skel34_spec.key) return &g1skel34_spec;
    return nullptr;
}

} // namespace kimodo::detail
