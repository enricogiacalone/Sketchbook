import React, { useRef, useEffect, useState, useMemo } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useCompoundBody } from "@react-three/cannon";
import { useGLTF, useAnimations, Html } from "@react-three/drei";
import { SkeletonUtils } from "three-stdlib";
import * as THREE from "three";
import { useStore } from "../store";
import SpeechBubble from "./UI/SpeechBubble";
import { useSpringVector } from "../hooks/useSpringVector";

interface EnemyProps {
  id: string;
  initialPosition: [number, number, number];
}

const Enemy: React.FC<EnemyProps> = ({ id, initialPosition }) => {
  const { scene, animations } = useGLTF("boxman.glb");
  const clonedScene = useMemo(() => SkeletonUtils.clone(scene), [scene]);
  const { actions } = useAnimations(animations, clonedScene);
  const { playerPos, updateEntity, removeEntity } = useStore();

  const [health, setHealth] = useState(100);
  const [currentAnim, setCurrentAnim] = useState("idle");
  const [message, setMessage] = useState("");

  const radius = 0.3;
  const height = 1;
  const moveSpeed = 3.5;

  const [ref, api] = useCompoundBody<THREE.Group>(() => ({
    mass: 1,
    position: initialPosition,
    fixedRotation: true,
    material: "slippery",
    collisionFilterGroup: 2,
    shapes: [
      { type: "Sphere", args: [radius], position: [0, 0, 0] },
      { type: "Sphere", args: [radius], position: [0, height / 2, 0] },
      { type: "Sphere", args: [radius], position: [0, -height / 2, 0] },
    ],
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
    if (!ref.current) return;

    const enemyPos = new THREE.Vector3(...position.current);
    const targetPos = new THREE.Vector3(...playerPos);
    const distance = enemyPos.distanceTo(targetPos);

    const direction = new THREE.Vector3().subVectors(targetPos, enemyPos);
    direction.y = 0;

    const isMoving = distance > 1.5 && distance < 50;

    if (direction.lengthSq() > 0.001) {
      direction.normalize();
      // targetRotation uses Math.atan2(x, z) which is compatible with Three.js forward (+Z)
      const targetRotation = Math.atan2(direction.x, direction.z);
      let diff = targetRotation - modelRotation.current;
      while (diff < -Math.PI) diff += Math.PI * 2;
      while (diff > Math.PI) diff -= Math.PI * 2;
      modelRotation.current += diff * 0.15; // Increased responsiveness
    }

    velocitySim.target.current.set(0, 0, isMoving ? moveSpeed : 0);
    velocitySim.simulate(delta);

    const arcadeVelMagnitude = velocitySim.position.current.z;
    // Calculate world velocity based on current model rotation
    const worldVel = new THREE.Vector3(
      Math.sin(modelRotation.current),
      0,
      Math.cos(modelRotation.current)
    ).multiplyScalar(arcadeVelMagnitude);

    api.velocity.set(worldVel.x, velocity.current[1], worldVel.z);

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
    Object.values(actions).forEach((action) => action?.stop());
    if (actions[currentAnim]) {
      actions[currentAnim].reset().fadeIn(0.2).play();
    }
  }, [currentAnim, actions]);

  useEffect(() => {
    return () => removeEntity(id);
  }, [id, removeEntity]);

  if (health <= 0) return null;

  return (
    <group ref={ref}>
      {/* Visual representation with manual rotation */}
      <group rotation={[0, modelRotation.current, 0]}>
        {/* Nameplate */}
        <Html position={[0, 1.8, 0]} center distanceFactor={10}>
          <div
            style={{
              color: "#ff4444",
              background: "rgba(0,0,0,0.5)",
              padding: "2px 8px",
              borderRadius: "4px",
              fontSize: "12px",
              fontWeight: "bold",
              whiteSpace: "nowrap",
              pointerEvents: "none",
            }}
          >
            ENEMY
          </div>
        </Html>

        {/* Health Bar */}
        <group position={[0, 1.5, 0]}>
          <mesh>
            <planeGeometry args={[0.8, 0.1]} />
            <meshBasicMaterial color="red" />
          </mesh>
          <mesh position={[0, 0, 0.01]} scale={[health / 100, 1, 1]}>
            <planeGeometry args={[0.8, 0.1]} />
            <meshBasicMaterial color="#00ff00" />
          </mesh>
        </group>

        <SpeechBubble message={message} position={[0, 1.2, 0]} />

        <group position={[0, 0, 0]}>
          <primitive object={clonedScene} />
        </group>
      </group>
    </group>
  );
};

export default Enemy;
