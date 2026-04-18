import React, { useEffect, useMemo } from "react";
import { useGLTF, useAnimations, Html } from "@react-three/drei";
import { SkeletonUtils } from "three-stdlib";
import { useCompoundBody } from "@react-three/cannon";
import * as THREE from "three";
import { NetworkPlayerData } from "../hooks/useNetwork";
import SpeechBubble from "./UI/SpeechBubble";

const NetworkPlayer: React.FC<{ data: NetworkPlayerData }> = ({ data }) => {
  const { scene, animations } = useGLTF("boxman.glb");
  const clonedScene = useMemo(() => SkeletonUtils.clone(scene), [scene]);
  const { actions } = useAnimations(animations, clonedScene);

  // Character physical parameters (same as Player.tsx)
  const radius = 0.3;
  const height = 1;

  // Add physical body for the remote player so the local player can collide with it
  const [ref, api] = useCompoundBody<THREE.Group>(() => ({
    mass: 0,
    position: [data.position_x, data.position_y, data.position_z],
    fixedRotation: true,
    collisionFilterGroup: 2,
    shapes: [
      { type: "Sphere", args: [radius], position: [0, 0, 0] },
      { type: "Sphere", args: [radius], position: [0, height / 2, 0] },
      { type: "Sphere", args: [radius], position: [0, -height / 2, 0] },
    ],
  }));

  // Update physical body position when data from network changes
  useEffect(() => {
    api.position.set(data.position_x, data.position_y, data.position_z);
    api.quaternion.set(
      data.quaternion_x,
      data.quaternion_y,
      data.quaternion_z,
      data.quaternion_w
    );
  }, [data, api]);

  useEffect(() => {
    Object.values(actions).forEach((action) => action?.stop());
    const animation = data.animation || "idle";
    if (actions[animation]) {
      actions[animation].reset().fadeIn(0.2).play();
    }
  }, [data.animation, actions]);

  return (
    <group ref={ref}>
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

      {/* Adjust visual model offset. 
          If only the head was visible with -0.8, we need to move it UP.
          Trying -0.3 instead of -0.8 to bring more of the body above ground.
      */}
      <group position={[0, 0, 0]}>
        <primitive object={clonedScene} />
      </group>
    </group>
  );
};

export default NetworkPlayer;
