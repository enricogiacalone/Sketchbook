import React, { useRef, useEffect, useState, useMemo, useCallback } from "react";
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
import Bullet from "./Bullet";

const Player: React.FC<{ userName: string }> = ({ userName }) => {
  const input = useInput();
  const { camera } = useThree();
  const { scene, animations } = useGLTF("boxman.glb");
  const { actions } = useAnimations(animations, scene);
  const { currentControllable, setCurrentControllable, setPlayerInfo, playerMessage } = useStore();

  const [posState, setPosState] = useState<[number, number, number]>([0, 5, 0]);
  const [quatState, setQuatState] = useState<number[]>([0, 0, 0, 1]);
  const [currentAnim, setCurrentAnim] = useState("idle");
  const currentAnimRef = useRef("idle");

  // Shooting state
  const [bullets, setBullets] = useState<{ id: string, pos: [number, number, number], vel: [number, number, number] }[]>([]);
  const lastFireTime = useRef(0);
  const fireRate = 200; // ms between shots

  const { remotePlayers, sendChatMessage } = useNetwork(userName, posState, quatState, currentAnim);

  const moveSpeed = 4;
  const sprintMultiplier = 2.5;
  const radius = 0.3;
  const height = 1;
  const jumpForce = 6;

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

  const velocity = useRef([0, 0, 0]);
  useEffect(() => api.velocity.subscribe((v) => (velocity.current = v)), [api.velocity]);

  const position = useRef([0, 0, 0]);
  useEffect(() => api.position.subscribe((p) => (position.current = p)), [api.position]);

  const isGrounded = useRef(true);
  const jumpPressed = useRef(false);

  const playerTarget = useMemo(() => new THREE.Vector3(), []);
  const { theta } = useThirdPersonCamera(
    playerTarget,
    currentControllable === "player"
  );

  const modelRotation = useRef(0);

  const playAnim = (name: string) => {
    if (currentAnimRef.current === name) return;
    currentAnimRef.current = name;
    setCurrentAnim(name);
    Object.values(actions).forEach((action) => action?.stop());
    if (actions[name]) {
        actions[name].reset().fadeIn(0.15).play();
    }
  };

  const removeBullet = useCallback((id: string) => {
    setBullets(prev => prev.filter(b => b.id !== id));
  }, []);

  useFrame((state, delta) => {
    if (!ref.current || !scene || currentControllable !== "player") {
      api.velocity.set(0, 0, 0);
      return;
    }

    playerTarget.set(position.current[0], position.current[1], position.current[2]);
    isGrounded.current = Math.abs(velocity.current[1]) < 0.2;

    // 1. Directional Logic
    const thetaRad = THREE.MathUtils.degToRad(theta.current);
    const cameraForward = new THREE.Vector3(Math.sin(thetaRad), 0, Math.cos(thetaRad)).normalize().negate();
    const cameraRight = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), cameraForward).normalize();

    const desiredMove = new THREE.Vector3(0, 0, 0);
    if (input.forward) desiredMove.add(cameraForward);
    if (input.backward) desiredMove.add(cameraForward.clone().negate());
    if (input.left) desiredMove.add(cameraRight.clone().negate());
    if (input.right) desiredMove.add(cameraRight);

    const isMoving = desiredMove.lengthSq() > 0.01;
    if (isMoving) {
      desiredMove.normalize();
      const targetRotation = Math.atan2(desiredMove.x, desiredMove.z);
      let diff = targetRotation - modelRotation.current;
      while (diff < -Math.PI) diff += Math.PI * 2;
      while (diff > Math.PI) diff -= Math.PI * 2;
      modelRotation.current += diff * 0.15;
    }

    // 2. Movement Simulation
    const targetSpeed = isMoving ? (input.shift ? moveSpeed * sprintMultiplier : moveSpeed) : 0;
    const airInfluence = isGrounded.current ? 1 : 0.2; 
    velocitySim.target.current.set(0, 0, targetSpeed);
    velocitySim.simulate(delta * airInfluence);

    const arcadeVelMagnitude = velocitySim.position.current.z;
    const worldVel = new THREE.Vector3(
      Math.sin(modelRotation.current),
      0,
      Math.cos(modelRotation.current)
    ).multiplyScalar(arcadeVelMagnitude);

    if (input.jump && isGrounded.current && !jumpPressed.current) {
        api.velocity.set(worldVel.x, jumpForce, worldVel.z);
        jumpPressed.current = true;
    } else {
        api.velocity.set(worldVel.x, velocity.current[1], worldVel.z);
    }
    if (!input.jump) jumpPressed.current = false;

    // 3. Shooting Logic
    if (input.primary && state.clock.elapsedTime * 1000 - lastFireTime.current > fireRate) {
        const bulletId = `bullet-${Date.now()}`;
        const bulletDir = new THREE.Vector3(Math.sin(modelRotation.current), 0, Math.cos(modelRotation.current));
        const bulletVel: [number, number, number] = [bulletDir.x * 50, 0, bulletDir.z * 50];
        const bulletPos: [number, number, number] = [
            position.current[0] + bulletDir.x * 0.5,
            position.current[1] + 0.5,
            position.current[2] + bulletDir.z * 0.5
        ];
        
        setBullets(prev => [...prev, { id: bulletId, pos: bulletPos, vel: bulletVel }]);
        lastFireTime.current = state.clock.elapsedTime * 1000;
    }

    // 4. Animation Selection
    let nextAnim = "idle";
    if (!isGrounded.current && Math.abs(velocity.current[1]) > 0.5) {
        if (velocity.current[1] > 0.5) nextAnim = isMoving ? "jump_running" : "jump_idle";
        else nextAnim = "falling";
    } else {
        nextAnim = isMoving ? (input.shift ? "sprint" : "run") : "idle";
    }
    playAnim(nextAnim);

    // 5. Stores update
    setPlayerInfo([position.current[0], position.current[1], position.current[2]], modelRotation.current);
    
    if (state.clock.getElapsedTime() % 0.05 < 0.02) { 
        setPosState([position.current[0], position.current[1], position.current[2]]);
        const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), modelRotation.current);
        setQuatState([q.x, q.y, q.z, q.w]);
    }
  });

  useEffect(() => {
    if (playerMessage) sendChatMessage(playerMessage);
  }, [playerMessage, sendChatMessage]);

  useEffect(() => {
    if (currentControllable !== "player") {
      api.collisionFilterGroup.set(0); 
      api.velocity.set(0, 0, 0);
    } else {
      api.collisionFilterGroup.set(2);
    }
  }, [currentControllable, api]);

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
      {bullets.map(b => (
        <Bullet key={b.id} id={b.id} position={b.pos} velocity={b.vel} onKill={removeBullet} />
      ))}
    </>
  );
};

export default Player;
