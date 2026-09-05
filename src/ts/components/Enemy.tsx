import React, { useRef, useEffect, useState, useMemo } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useCompoundBody } from "@react-three/cannon";
import { useGLTF, useAnimations, Html } from "@react-three/drei";
import { SkeletonUtils } from "three-stdlib";
import * as THREE from "three";
import { useStore } from "../store";
import { useShallow } from "zustand/react/shallow";
import SpeechBubble from "./UI/SpeechBubble";
import { useSpringVector } from "../hooks/useSpringVector";
import Explosion from "./Environment/Explosion";
import { getTerrainHeight } from "./Environment/Terrain";
import { getRoadOffset } from "./Environment/Road";
import { CollisionGroups } from "../enums/CollisionGroups";

interface EnemyProps {
  id: string;
  initialPosition: [number, number, number];
}

const Enemy: React.FC<EnemyProps> = ({ id, initialPosition }) => {
  const { scene, animations } = useGLTF("boxman.glb");
  const clonedScene = useMemo(() => SkeletonUtils.clone(scene), [scene]);
  const { actions } = useAnimations(animations, clonedScene);
  const { playerPos, updateEntity, removeEntity } = useStore(
    useShallow((state) => ({
      playerPos: state.playerPos,
      updateEntity: state.updateEntity,
      removeEntity: state.removeEntity,
    }))
  );

  const [health, setHealth] = useState(100);
  const [isExploded, setIsExploded] = useState(false);
  const [currentAnim, setCurrentAnim] = useState("idle");
  const [message, setMessage] = useState("");

  const radius = 0.3;
  const height = 1;
  const moveSpeed = 3.5;
  // The compound body's own origin is the middle of the three stacked
  // spheres; its actual bottom -- where it should rest on the ground -- is
  // height/2 + radius below that. Used both for the ground-snap target
  // below and to pull the rendered model down to match (see the JSX).
  const bodyBottomOffset = height / 2 + radius;
  const GROUND_SNAP_FORCE = 14;
  const MAX_SNAP_SPEED = 10;

  const [ref, api] = useCompoundBody<THREE.Group>(() => ({
    mass: 1,
    position: initialPosition,
    fixedRotation: true,
    material: "slippery",
    collisionFilterGroup: CollisionGroups.Characters,
    // Excludes TrimeshColliders (terrain + roads), same reasoning as the
    // player's sphere in Player.tsx: physically colliding with the ground
    // fights the manual ground-snap below every step (double authority over
    // Y), which is what made the player "walk badly" before that fix -- the
    // enemies never got the same treatment and had the same problem, plus
    // it let them take damage from touching the ground at all (see the
    // onCollide condition below, which used to key off this exact group).
    collisionFilterMask: ~CollisionGroups.TrimeshColliders,
    shapes: [
      { type: "Sphere", args: [radius], position: [0, 0, 0] },
      { type: "Sphere", args: [radius], position: [0, height / 2, 0] },
      { type: "Sphere", args: [radius], position: [0, -height / 2, 0] },
    ],
    onCollide: (e) => {
      if (e.body.userData?.type === "bullet" && health > 0) {
        setHealth((prev) => {
          const next = Math.max(0, prev - 25); // Increased damage
          if (next <= 0) {
            setIsExploded(true);
          } else {
            setMessage("OUCH!");
            setTimeout(() => setMessage(""), 1000);
          }
          return next;
        });
      }
    },
  }));

  const velocity = useRef([0, 0, 0]);
  useEffect(
    () => api.velocity.subscribe((v) => (velocity.current = v)),
    [api.velocity]
  );

  const position = useRef([0, 0, 0]);
  useEffect(
    () => api.position.subscribe((p) => (position.current = p)),
    [api.position]
  );

  const modelRotation = useRef(0);
  const velocitySim = useSpringVector(60, 0.7);

  const phrases = [
    "I'm coming for you!",
    "You can't escape!",
    "Gotcha!",
    "Stop right there!",
    "Found you!",
  ];

  useFrame((state, delta) => {
    if (!ref.current || health <= 0) return;

    const enemyPos = new THREE.Vector3(...position.current);
    const targetPos = new THREE.Vector3(...playerPos);
    const distance = enemyPos.distanceTo(targetPos);

    const direction = new THREE.Vector3().subVectors(targetPos, enemyPos);
    direction.y = 0;

    const isMoving = distance > 1.5 && distance < 50;

    if (direction.lengthSq() > 0.001) {
      direction.normalize();
      const targetRotation = Math.atan2(direction.x, direction.z);
      let diff = targetRotation - modelRotation.current;
      while (diff < -Math.PI) diff += Math.PI * 2;
      while (diff > Math.PI) diff -= Math.PI * 2;
      modelRotation.current += diff * 0.15;
    }

    velocitySim.target.current.set(0, 0, isMoving ? moveSpeed : 0);
    velocitySim.simulate(delta);

    const arcadeVelMagnitude = velocitySim.position.current.z;
    const worldVel = new THREE.Vector3(
      Math.sin(modelRotation.current),
      0,
      Math.cos(modelRotation.current)
    ).multiplyScalar(arcadeVelMagnitude);

    // Ground snap, mirroring Player.tsx: the compound body no longer
    // physically collides with the terrain/road (see collisionFilterMask
    // above), so this is the only thing placing it vertically. Enemies
    // never jump, so unlike the player this can run unconditionally.
    const groundY =
      getTerrainHeight(position.current[0], position.current[2]) +
      getRoadOffset(position.current[0], position.current[2]);
    const targetY = groundY + bodyBottomOffset;
    const heightError = targetY - position.current[1];
    const yVel = THREE.MathUtils.clamp(
      heightError * GROUND_SNAP_FORCE,
      -MAX_SNAP_SPEED,
      MAX_SNAP_SPEED
    );

    api.velocity.set(worldVel.x, yVel, worldVel.z);

    if (Math.random() < 0.002 && !message) {
      const phrase = phrases[Math.floor(Math.random() * phrases.length)];
      setMessage(phrase);
      setTimeout(() => setMessage(""), 3000);
    }

    const nextAnim = isMoving ? "run" : "idle";
    if (nextAnim !== currentAnim) {
      setCurrentAnim(nextAnim);
    }

    if (state.clock.getElapsedTime() % 0.2 < 0.02) {
      updateEntity(id, {
        type: "enemy",
        position: [
          position.current[0],
          position.current[1],
          position.current[2],
        ],
        rotation: modelRotation.current,
      });
    }
  });

  useEffect(() => {
    if (health > 0) {
      Object.values(actions).forEach((action) => action?.stop());
      if (actions[currentAnim]) {
        actions[currentAnim].reset().fadeIn(0.2).play();
      }
    }
  }, [currentAnim, actions, health]);

  if (isExploded) {
    return (
      <Explosion
        position={[
          position.current[0],
          position.current[1],
          position.current[2],
        ]}
        color="#ff4400"
        scale={1.5}
        onFinish={() => removeEntity(id)}
      />
    );
  }

  return (
    <group ref={ref}>
      <group rotation={[0, modelRotation.current, 0]}>
        <Html position={[0, 1.8, 0]} center distanceFactor={10}>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "4px",
              pointerEvents: "none",
              fontFamily: "Solway, serif"
            }}
          >
            <div
              style={{
                color: "#ff4444",
                background: "rgba(0,0,0,0.75)",
                padding: "2px 8px",
                borderRadius: "4px",
                fontSize: "11px",
                fontWeight: "bold",
                letterSpacing: "1px",
                whiteSpace: "nowrap",
                border: "1px solid rgba(255, 68, 68, 0.3)"
              }}
            >
              ENEMY
            </div>
            <div
              style={{
                width: "40px",
                height: "5px",
                backgroundColor: "rgba(255, 0, 0, 0.5)",
                borderRadius: "3px",
                overflow: "hidden",
                border: "1px solid rgba(0,0,0,0.5)"
              }}
            >
              <div
                style={{
                  width: `${health}%`,
                  height: "100%",
                  backgroundColor: "#00ff66",
                  transition: "width 0.2s ease"
                }}
              />
            </div>
          </div>
        </Html>

        <SpeechBubble message={message} position={[0, 1.2, 0]} />

        {/* Pulls the model's feet down to the compound body's actual
            bottom (see bodyBottomOffset above) -- without this the model
            was drawn at the body's origin, floating height/2+radius above
            where it's really standing. */}
        <group position={[0, -bodyBottomOffset, 0]}>
          <primitive object={clonedScene} />
        </group>
      </group>
    </group>
  );
};

export default Enemy;
