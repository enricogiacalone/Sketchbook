import React, { useRef, useEffect, useState, useMemo } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useCompoundBody } from "@react-three/cannon";
import { useGLTF, useAnimations } from "@react-three/drei";
import * as THREE from "three";
import { useInput } from "../hooks/useInput";
import { useNetwork } from "../hooks/useNetwork";
import { useSpringVector } from "../hooks/useSpringVector";
import { useThirdPersonCamera } from "../hooks/useThirdPersonCamera";
import { useStore } from "../store";
import NetworkPlayer from "./NetworkPlayer";
import SpeechBubble from "./UI/SpeechBubble";

const Player: React.FC<{ userName: string }> = ({ userName }) => {
  const input = useInput();
  const { camera } = useThree();
  const { scene, animations } = useGLTF("boxman.glb");
  const { actions } = useAnimations(animations, scene);
  const { currentControllable, setCurrentControllable, setPlayerInfo, playerMessage, setPlayerMessage } = useStore();

  const [currentAnim, setCurrentAnim] = useState("idle");
  const [posState, setPosState] = useState<[number, number, number]>([0, 5, 0]);
  const [quatState, setQuatState] = useState<number[]>([0, 0, 0, 1]);

  const { remotePlayers, sendChatMessage } = useNetwork(userName, posState, quatState, currentAnim);

  // Character parameters
  const moveSpeed = 4;
  const sprintMultiplier = 2.5;
  const radius = 0.3;
  const height = 1;

  // Spring Simulators
  const velocitySim = useSpringVector(60, 0.7);

  const [ref, api] = useCompoundBody<THREE.Group>(() => ({
    mass: 1,
    position: [0, 15, 0],
    fixedRotation: true,
    material: "slippery",
    collisionFilterGroup: 2, 
    shapes: [
      { type: "Sphere", args: [radius], position: [0, 0, 0] },
      { type: "Sphere", args: [radius], position: [0, height / 2, 0] },
      { type: "Sphere", args: [radius], position: [0, -height / 2, 0] },
    ],
  }));

  // Sync internal store message with network
  useEffect(() => {
    if (playerMessage) {
        sendChatMessage(playerMessage);
    }
  }, [playerMessage, sendChatMessage]);

  useEffect(() => {
    if (currentControllable !== "player") {
      api.collisionFilterGroup.set(0); 
      api.velocity.set(0, 0, 0);
    } else {
      api.collisionFilterGroup.set(2);
    }
  }, [currentControllable, api]);

  const velocity = useRef([0, 0, 0]);
  useEffect(
    () => api.velocity.subscribe((v) => (velocity.current = v)),
    [api.velocity]
  );

  const position = useRef([0, 0, 0]);
  useEffect(
    () =>
      api.position.subscribe((p) => {
        position.current = p;
      }),
    [api.position]
  );

  const playerTarget = useMemo(() => new THREE.Vector3(), []);
  const { theta } = useThirdPersonCamera(
    playerTarget,
    currentControllable === "player"
  );

  const modelRotation = useRef(0);
  const moveDirection = useRef(new THREE.Vector3());

  useFrame((state, delta) => {
    if (!ref.current || !scene || currentControllable !== "player") {
      api.velocity.set(0, 0, 0);
      return;
    }

    playerTarget.set(
      position.current[0],
      position.current[1],
      position.current[2]
    );

    // 1. Calculate camera-relative movement direction
    const thetaRad = THREE.MathUtils.degToRad(theta.current);
    const cameraForward = new THREE.Vector3(Math.sin(thetaRad), 0, Math.cos(thetaRad)).normalize().negate();
    const cameraRight = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), cameraForward).normalize();

    // 2. Compute movement vector based on inputs
    const desiredMove = new THREE.Vector3(0, 0, 0);
    if (input.forward) desiredMove.add(cameraForward);
    if (input.backward) desiredMove.add(cameraForward.clone().negate());
    if (input.left) desiredMove.add(cameraRight.clone().negate());
    if (input.right) desiredMove.add(cameraRight);

    const isMoving = desiredMove.lengthSq() > 0.01;
    if (isMoving) {
      desiredMove.normalize();
      moveDirection.current.lerp(desiredMove, 0.2); 
    }

    // 3. Update Simulators
    const targetSpeed = isMoving ? (input.shift ? moveSpeed * sprintMultiplier : moveSpeed) : 0;
    velocitySim.target.current.set(0, 0, targetSpeed);
    velocitySim.simulate(delta);

    // 4. Update Model Rotation
    if (isMoving) {
      const targetRotation = Math.atan2(desiredMove.x, desiredMove.z);
      let diff = targetRotation - modelRotation.current;
      while (diff < -Math.PI) diff += Math.PI * 2;
      while (diff > Math.PI) diff -= Math.PI * 2;
      modelRotation.current += diff * 0.15;
    }

    // 5. Apply Physics Velocity
    const arcadeVelMagnitude = velocitySim.position.current.z;
    const worldVel = new THREE.Vector3(
      Math.sin(modelRotation.current),
      0,
      Math.cos(modelRotation.current)
    ).multiplyScalar(arcadeVelMagnitude);

    api.velocity.set(worldVel.x, velocity.current[1], worldVel.z);

    // 6. Jump Logic
    if (input.jump && Math.abs(velocity.current[1]) < 0.1) {
      api.velocity.set(velocity.current[0], 5, velocity.current[2]);
    }

    // 7. Update Store and Local State for Network
    setPlayerInfo([position.current[0], position.current[1], position.current[2]], modelRotation.current);
    
    if (state.clock.getElapsedTime() % 0.05 < 0.02) { // 20 times per second
        setPosState([position.current[0], position.current[1], position.current[2]]);
        const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), modelRotation.current);
        setQuatState([q.x, q.y, q.z, q.w]);
    }
  });

  useEffect(() => {
    if (currentControllable !== "player") return;

    const isMoving = input.forward || input.backward || input.left || input.right;
    const animation = isMoving ? (input.shift ? "sprint" : "run") : "idle";

    if (animation !== currentAnim) {
      setCurrentAnim(animation);
      Object.values(actions).forEach((action) => action?.stop());
      if (actions[animation]) {
        actions[animation].reset().fadeIn(0.2).play();
      }
    }
  }, [input, actions, currentAnim, currentControllable]);

  return (
    <>
      <group ref={ref} visible={currentControllable === "player"}>
        <SpeechBubble message={playerMessage} position={[0, 1.2, 0]} />
        <group rotation={[0, modelRotation.current, 0]}>
          <primitive object={scene} position={[0, -0.8, 0]} />
        </group>
      </group>

      {Array.from(remotePlayers.values()).map((playerData) => (
        <NetworkPlayer key={playerData.id} data={playerData} />
      ))}
    </>
  );
};

export default Player;
