import React, { useEffect, useMemo, useRef } from "react";
import { useGLTF, useAnimations, Html } from "@react-three/drei";
import { SkeletonUtils } from "three-stdlib";
import { RigidBody, BallCollider, RapierRigidBody } from "@react-three/rapier";
import * as THREE from "three";
import { NetworkPlayerData } from "../hooks/useNetwork";
import SpeechBubble from "./UI/SpeechBubble";
import { CollisionGroups, groupsExcluding } from "../enums/CollisionGroups";

const NetworkPlayer: React.FC<{ data: NetworkPlayerData }> = ({ data }) => {
  const { scene, animations } = useGLTF("boxman.glb");
  const clonedScene = useMemo(() => SkeletonUtils.clone(scene), [scene]);
  const { actions } = useAnimations(animations, clonedScene);

  // Character physical parameters (same as Player.tsx)
  const radius = 0.3;
  const height = 1;

  // Migrated from cannon's mass:0 body (immovable, but still a collision
  // target for the local player) to Rapier's "kinematicPosition" type --
  // the closest match: driven entirely by explicit position/rotation writes
  // below (never by forces), but unlike a "fixed" body it still computes a
  // proper implicit velocity for collision response each time its position
  // changes, so the local player pushing against a remote player still
  // feels physical instead of clipping through.
  const ref = useRef<RapierRigidBody>(null);

  // Update physical body position when data from network changes.
  // setNextKinematicTranslation/Rotation (rather than setTranslation/
  // setRotation) is the correct API for a kinematicPosition body -- it lets
  // Rapier compute the body's velocity for this step from the position
  // delta, which is what makes it push against dynamic bodies correctly
  // instead of just teleporting through them.
  useEffect(() => {
    const body = ref.current;
    if (!body) return;
    body.setNextKinematicTranslation({ x: data.position_x, y: data.position_y, z: data.position_z });
    body.setNextKinematicRotation({
      x: data.quaternion_x,
      y: data.quaternion_y,
      z: data.quaternion_z,
      w: data.quaternion_w,
    });
  }, [data]);

  useEffect(() => {
    Object.values(actions).forEach((action) => action?.stop());
    const animation = data.animation || "idle";
    if (actions[animation]) {
      actions[animation].reset().fadeIn(0.2).play();
    }
  }, [data.animation, actions]);

  return (
    <RigidBody
      ref={ref}
      type="kinematicPosition"
      colliders={false}
      position={[data.position_x, data.position_y, data.position_z]}
      collisionGroups={groupsExcluding(CollisionGroups.Characters)}
    >
      <BallCollider args={[radius]} position={[0, 0, 0]} />
      <BallCollider args={[radius]} position={[0, height / 2, 0]} />
      <BallCollider args={[radius]} position={[0, -height / 2, 0]} />

      {/* Nameplate */}
      <Html position={[0, 1.8, 0]} center distanceFactor={10}>
        <div
          style={{
            color: data.color || "white",
            background: "rgba(0,0,0,0.5)",
            padding: "2px 8px",
            borderRadius: "4px",
            fontSize: "12px",
            fontWeight: "bold",
            whiteSpace: "nowrap",
            pointerEvents: "none",
          }}
        >
          {data.name}
        </div>
      </Html>

      <SpeechBubble message={data.lastMessage || ""} position={[0, 1.2, 0]} />

      <group position={[0, 0, 0]}>
        <primitive object={clonedScene} />
      </group>
    </RigidBody>
  );
};

export default NetworkPlayer;
