import React, { useRef, useEffect, useState, useMemo, useCallback } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useSphere } from "@react-three/cannon";
import { useGLTF, useAnimations } from "@react-three/drei";
import * as THREE from "three";
import { SkeletonUtils } from "three-stdlib";
import { useInput } from "../hooks/useInput";
import { useNetwork } from "../hooks/useNetwork";
import { useThirdPersonCamera } from "../hooks/useThirdPersonCamera";
import { useStore } from "../store";
import { getTerrainHeight } from "./Environment/Terrain";
import NetworkPlayer from "./NetworkPlayer";
import SpeechBubble from "./UI/SpeechBubble";
import Bullet from "./Bullet";

const Player: React.FC<{ userName: string }> = ({ userName }) => {
  const input = useInput();
  const { scene, animations } = useGLTF("boxman.glb");
  const clonedScene = useMemo(() => SkeletonUtils.clone(scene), [scene]);
  const { actions } = useAnimations(animations, clonedScene);
  const { currentControllable, setCurrentControllable, setPlayerInfo, playerMessage, entities, setIsLoading } = useStore();

  useEffect(() => {
    if (scene) setIsLoading(false);
  }, [scene, setIsLoading]);

  const [posState, setPosState] = useState<[number, number, number]>([0, 5, 0]);
  const [quatState, setQuatState] = useState<number[]>([0, 0, 0, 1]);
  const [currentAnim, setCurrentAnim] = useState("idle");
  const currentAnimRef = useRef("idle");

  const [bullets, setBullets] = useState<{ id: string, pos: [number, number, number], vel: [number, number, number] }[]>([]);
  const lastFireTime = useRef(0);
  
  const { remotePlayers, sendChatMessage } = useNetwork(userName, posState, quatState, currentAnim);

  // Constants
  const RUN_SPEED = 7;
  const SPRINT_SPEED = RUN_SPEED * 2.0;
  const JUMP_FORCE = 8;
  const RADIUS = 0.4;

  // 1. Solid Physics Body (Sphere is the most reliable for character controllers)
  const [ref, api] = useSphere<THREE.Group>(() => ({
    mass: 1,
    position: [0, 15, 0],
    args: [RADIUS],
    fixedRotation: true,
    linearDamping: 0.05,
    material: "slippery",
    collisionFilterGroup: 2,
    collisionFilterMask: -1,
  }));

  const velocity = useRef([0, 0, 0]);
  useEffect(() => api.velocity.subscribe((v) => (velocity.current = v)), [api.velocity]);

  const position = useRef([0, 0, 0]);
  useEffect(() => api.position.subscribe((p) => (position.current = p)), [api.position]);

  const modelRotation = useRef(0);
  const isGrounded = useRef(true);
  const jumpPressed = useRef(false);
  
  const playerTarget = useMemo(() => new THREE.Vector3(), []);
  const { theta } = useThirdPersonCamera(playerTarget, currentControllable === "player");

  const playAnim = (name: string) => {
    if (currentAnimRef.current === name) return;
    currentAnimRef.current = name;
    setCurrentAnim(name);
    Object.values(actions).forEach((action) => action?.fadeOut(0.1));
    if (actions[name]) actions[name].reset().fadeIn(0.1).play();
  };

  const removeBullet = useCallback((id: string) => {
    setBullets(prev => prev.filter(b => b.id !== id));
  }, []);

  useFrame((state, delta) => {
    if (!ref.current || !clonedScene || currentControllable !== "player") {
      api.velocity.set(0, velocity.current[1], 0);
      return;
    }

    // Sync camera target
    playerTarget.set(position.current[0], position.current[1] + 1.0, position.current[2]);
    
    // 2. Ground Detection & Height Following
    const terrainY = getTerrainHeight(position.current[0], position.current[2]);
    // The sphere center is RADIUS (0.4) above the ground when standing
    const distToGround = position.current[1] - (terrainY + RADIUS);
    
    isGrounded.current = distToGround < 0.2 && velocity.current[1] < 1.0;

    // 3. Movement Direction (Always relative to camera view)
    const thetaRad = THREE.MathUtils.degToRad(theta.current);
    const forward = new THREE.Vector3(Math.sin(thetaRad), 0, Math.cos(thetaRad)).normalize().negate();
    const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), forward).normalize();

    const moveDir = new THREE.Vector3(0, 0, 0);
    if (input.forward) moveDir.add(forward);
    if (input.backward) moveDir.add(forward.clone().negate());
    if (input.left) moveDir.add(right.clone().negate());
    if (input.right) moveDir.add(right);

    const isMoving = moveDir.lengthSq() > 0.001;
    let targetVel = new THREE.Vector3(0, 0, 0);

    if (isMoving) {
      moveDir.normalize();
      const speed = input.shift ? SPRINT_SPEED : RUN_SPEED;
      targetVel.copy(moveDir).multiplyScalar(speed);
      
      // Smoothly rotate character to face movement
      const targetRotation = Math.atan2(moveDir.x, moveDir.z);
      let diff = targetRotation - modelRotation.current;
      while (diff < -Math.PI) diff += Math.PI * 2;
      while (diff > Math.PI) diff -= Math.PI * 2;
      modelRotation.current += diff * 0.2;
    }

    // 4. Vertical Logic (Jump & Ground Snapping)
    let yVel = velocity.current[1];
    
    if (isGrounded.current) {
        if (input.consumeJustPressed('jump')) {
            yVel = JUMP_FORCE;
        } else {
            // Ground Snapping: keep sphere pinned to terrain
            // target position.y = terrainY + RADIUS
            const yCorrection = (terrainY + RADIUS - position.current[1]) * 10;
            yVel = yCorrection; 
        }
    } else {
        // Air control: blend horizontal input into current air velocity
        const airInfluence = 0.05;
        targetVel.x = THREE.MathUtils.lerp(velocity.current[0], targetVel.x, airInfluence);
        targetVel.z = THREE.MathUtils.lerp(velocity.current[2], targetVel.z, airInfluence);
    }

    // 5. Apply Final Velocity
    api.velocity.set(targetVel.x, yVel, targetVel.z);

    // 6. Combat Logic
    if (input.primary && state.clock.elapsedTime * 1000 - lastFireTime.current > 200) {
        const bulletId = `bullet-${Date.now()}`;
        const bulletDir = new THREE.Vector3(Math.sin(modelRotation.current), 0, Math.cos(modelRotation.current));
        setBullets(prev => [...prev, { 
            id: bulletId, 
            pos: [position.current[0] + bulletDir.x * 0.5, position.current[1] + 0.2, position.current[2] + bulletDir.z * 0.5], 
            vel: [bulletDir.x * 50, 0, bulletDir.z * 50] 
        }]);
        lastFireTime.current = state.clock.elapsedTime * 1000;
    }

    // 7. Animation State Machine
    let nextAnim = "idle";
    const hSpeed = new THREE.Vector2(velocity.current[0], velocity.current[2]).length();
    
    if (!isGrounded.current && velocity.current[1] < -3.0) {
        nextAnim = "falling";
    } else if (!isGrounded.current && velocity.current[1] > 1.0) {
        nextAnim = isMoving ? "jump_running" : "jump_idle";
    } else if (hSpeed > 0.5) {
        nextAnim = hSpeed > RUN_SPEED * 1.5 ? "sprint" : "run";
    }
    playAnim(nextAnim);

    // 8. Stores & Networking
    setPlayerInfo([position.current[0], position.current[1], position.current[2]], modelRotation.current);

    if (input.consumeJustPressed('enter')) {
        const pPos = new THREE.Vector3(position.current[0], 0, position.current[2]);
        entities.forEach((e) => {
          if (['car', 'airplane', 'helicopter'].includes(e.type)) {
            if (pPos.distanceTo(new THREE.Vector3(e.position[0], 0, e.position[2])) < 8) {
              setCurrentControllable(e.type as any);
            }
          }
        });
    }
    
    if (state.clock.getElapsedTime() % 0.05 < 0.02) { 
        setPosState([position.current[0], position.current[1], position.current[2]]);
        const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), modelRotation.current);
        setQuatState([q.x, q.y, q.z, q.w]);
    }
  });

  return (
    <>
      <group ref={ref} visible={currentControllable === "player"}>
        <group rotation={[0, modelRotation.current, 0]}>
          <primitive object={clonedScene} position={[0, -RADIUS, 0]} />
        </group>
        <SpeechBubble message={playerMessage} position={[0, 1.2, 0]} />
      </group>
      {Array.from(remotePlayers.values()).map((p) => (
        <NetworkPlayer key={p.id} data={p} />
      ))}
      {bullets.map(b => (
        <Bullet key={b.id} id={b.id} position={b.pos} velocity={b.vel} onKill={removeBullet} />
      ))}
    </>
  );
};

export default Player;
