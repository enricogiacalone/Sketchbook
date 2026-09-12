import React, { useRef, useEffect, useState, useMemo, useCallback } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { RigidBody, BallCollider, RapierRigidBody, CollisionEnterHandler } from "@react-three/rapier";
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
import { CollisionGroups, groupsExcluding } from "../enums/CollisionGroups";
import { UPPER_BODY_BONES, LOWER_BODY_BONES, filterTracksByBones } from "../lib/characterAnimation";
import Bullet from "./Bullet";

interface EnemyProps {
  id: string;
  initialPosition: [number, number, number];
  // Called once this enemy has spent GIVE_UP_TIME straight without ever
  // closing to within CATCH_DISTANCE of the player -- see the chase timer
  // in the useFrame below. CityDetails.tsx's handler drops this id from
  // its pedestrianEnemies list (unmounting this component) and the
  // matching Pedestrian.tsx instance -- same id, never actually
  // destroyed, just frozen -- picks its patrol back up on its own.
  onGiveUp: (id: string) => void;
}

const Enemy: React.FC<EnemyProps> = ({ id, initialPosition, onGiveUp }) => {
  const { scene, animations } = useGLTF("boxman.glb");
  const clonedScene = useMemo(() => SkeletonUtils.clone(scene), [scene]);
  const { actions, mixer, clips } = useAnimations(animations, clonedScene);
  const { playerPos, updateEntity, removeEntity } = useStore(
    useShallow((state) => ({
      playerPos: state.playerPos,
      updateEntity: state.updateEntity,
      removeEntity: state.removeEntity,
    }))
  );

  const [health, setHealth] = useState(100);
  const [isExploded, setIsExploded] = useState(false);
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

  const ref = useRef<RapierRigidBody>(null);

  // Migrated from cannon's e.body.userData?.type === "bullet" (cannon lets
  // you stash arbitrary data straight on the Body). Rapier's own userData
  // prop is passed down to the THREE.Object3D instead (see CollisionGroups
  // usage elsewhere for the groups side of this) -- so the bullet's
  // userData is read off payload.other.rigidBodyObject here. Shared across
  // all three sphere colliders below since a bullet can hit any of them.
  // "se sparo ai pedoni diventano nemici e anche loro mi possono sparare" --
  // now that enemies fire their own bullets (owner:'enemy', see below), this
  // needs an owner check too, otherwise one enemy's shot at the player
  // would splash damage onto every OTHER enemy whose collider it also
  // happens to touch along the way (all enemies share the same
  // collisionGroups). Only bullets owned by the player count as a hit here.
  const handleBulletHit: CollisionEnterHandler = (payload) => {
    const otherData = payload.other.rigidBodyObject?.userData as { type?: string; owner?: string } | undefined;
    if (otherData?.type === "bullet" && otherData?.owner === "player" && health > 0) {
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
  };

  const velocity = useRef([0, 0, 0]);
  const position = useRef([...initialPosition]);
  const modelRotation = useRef(0);
  const velocitySim = useSpringVector(60, 0.7);
  // "Essere nemico e' un'istanza dei passanti che dopo un po', se non ti
  // raggiungono, ridiventano semplici pedoni" -- an enemy that spends this
  // long in a row without ever actually closing to CATCH_DISTANCE gives up
  // the chase and reverts to an ordinary pedestrian (see onGiveUp). Reset
  // to 0 any frame it IS that close, so a chase that's actually working
  // (or one that briefly catches up before the player breaks away again)
  // never times out -- only a chase that's genuinely going nowhere does.
  const giveUpTimer = useRef(0);
  const CATCH_DISTANCE = 1.6;
  const GIVE_UP_TIME = 15;
  const hasGivenUp = useRef(false);

  // "anche loro mi possono sparare" -- an enemy's own ranged attack,
  // mirroring Player.tsx's combat block (same Bullet component, same 50
  // units/s muzzle velocity) rather than only ever catching up to melee
  // range. Local state/refs exactly like Player.tsx's bullets/lastFireTime,
  // scoped per-enemy since each Enemy instance fires independently.
  const [bullets, setBullets] = useState<{ id: string; pos: [number, number, number]; vel: [number, number, number] }[]>([]);
  const lastFireTime = useRef(0);
  const FIRE_RANGE = 12;
  const FIRE_COOLDOWN = 1200;
  const removeBullet = useCallback((bulletId: string) => {
    setBullets((prev) => prev.filter((b) => b.id !== bulletId));
  }, []);

  // "il nemico o il pedone o il player devono avere tutti le stesse
  // animazioni e caratteristiche sono tutti characters" -- same layered
  // upper/lower-body pool architecture as Player.tsx (see its big comment
  // on why plain weight=1 blending doesn't work), built from the SAME
  // shared bone lists (../lib/characterAnimation) so an enemy shooting
  // looks identical to the player shooting: legs keep running/idling while
  // only the upper body plays the aim/recoil pose. Limited to idle/run
  // (enemies never sprint or jump) and to a single ONE-SHOT burst per
  // bullet fired (see the fire block below) rather than Player's
  // held-down loop, since an enemy fires in short bursts, not continuously.
  const ENEMY_LOCOMOTION_CLIPS = ["idle", "run"];
  const shootUpperActionRef = useRef<THREE.AnimationAction | null>(null);
  const lowerActionsRef = useRef<Record<string, THREE.AnimationAction>>({});
  const currentAnimRef = useRef("idle");
  const currentPoolRef = useRef<"full" | "lower">("full");
  const shootAnimTimer = useRef(0);

  useEffect(() => {
    const createdActions: THREE.AnimationAction[] = [];

    const baseShootClip = clips.find((c) => c.name === "shoot");
    let shootAction: THREE.AnimationAction | null = null;
    if (baseShootClip) {
      const upperClip = new THREE.AnimationClip("shoot_upper_enemy", baseShootClip.duration, filterTracksByBones(baseShootClip, UPPER_BODY_BONES));
      shootAction = mixer.clipAction(upperClip, clonedScene);
      shootAction.setLoop(THREE.LoopOnce, 1);
      shootAction.clampWhenFinished = false;
      createdActions.push(shootAction);
    }
    shootUpperActionRef.current = shootAction;

    const lowerActions: Record<string, THREE.AnimationAction> = {};
    for (const name of ENEMY_LOCOMOTION_CLIPS) {
      const base = clips.find((c) => c.name === name);
      if (!base) continue;
      const lowerClip = new THREE.AnimationClip(name + "_lower_enemy", base.duration, filterTracksByBones(base, LOWER_BODY_BONES));
      const action = mixer.clipAction(lowerClip, clonedScene);
      lowerActions[name] = action;
      createdActions.push(action);
    }
    lowerActionsRef.current = lowerActions;

    return () => {
      createdActions.forEach((action) => {
        action.stop();
        mixer.uncacheClip(action.getClip());
      });
      shootUpperActionRef.current = null;
      lowerActionsRef.current = {};
    };
  }, [clips, mixer, clonedScene]);

  const playAnim = (name: string, lowerOnly: boolean) => {
    const pool: "full" | "lower" = lowerOnly ? "lower" : "full";
    if (currentAnimRef.current === name && currentPoolRef.current === pool) return;
    currentAnimRef.current = name;
    currentPoolRef.current = pool;
    Object.values(actions).forEach((action) => action?.fadeOut(0.2));
    Object.values(lowerActionsRef.current).forEach((action) => action?.fadeOut(0.2));
    const targetAction = lowerOnly ? lowerActionsRef.current[name] : actions[name];
    if (targetAction) targetAction.reset().fadeIn(0.2).play();
  };

  const phrases = [
    "I'm coming for you!",
    "You can't escape!",
    "Gotcha!",
    "Stop right there!",
    "Found you!",
  ];

  useFrame((state, delta) => {
    const body = ref.current;
    if (!body || health <= 0) return;

    // Synchronous Rapier reads (no more worker-subscription lag -- see
    // Player.tsx's rigidBodyRef comment for the general explanation).
    const t = body.translation();
    const lv = body.linvel();
    position.current[0] = t.x;
    position.current[1] = t.y;
    position.current[2] = t.z;
    velocity.current[0] = lv.x;
    velocity.current[1] = lv.y;
    velocity.current[2] = lv.z;

    const enemyPos = new THREE.Vector3(...(position.current as [number, number, number]));
    const targetPos = new THREE.Vector3(...playerPos);
    const distance = enemyPos.distanceTo(targetPos);

    if (distance <= CATCH_DISTANCE) {
      giveUpTimer.current = 0;
    } else {
      giveUpTimer.current += delta;
      if (giveUpTimer.current >= GIVE_UP_TIME && !hasGivenUp.current) {
        hasGivenUp.current = true;
        onGiveUp(id);
        return;
      }
    }

    // Ranged attack -- fires toward the player whenever in range, on its
    // own cooldown, independent of the chase-timeout logic just above.
    if (distance <= FIRE_RANGE) {
      const nowMs = state.clock.elapsedTime * 1000;
      if (nowMs - lastFireTime.current > FIRE_COOLDOWN) {
        const fireDir = new THREE.Vector3().subVectors(targetPos, enemyPos);
        fireDir.y = 0;
        if (fireDir.lengthSq() > 0.0001) {
          fireDir.normalize();
          lastFireTime.current = nowMs;
          const bulletId = `enemy-bullet-${id}-${Date.now()}`;
          setBullets((prev) => [...prev, {
            id: bulletId,
            pos: [
              enemyPos.x + fireDir.x * 0.5,
              enemyPos.y + height / 2,
              enemyPos.z + fireDir.z * 0.5,
            ],
            vel: [fireDir.x * 50, 0, fireDir.z * 50],
          }]);
          // Same upper-body overlay Player.tsx uses while firing, just
          // triggered as a one-shot burst here instead of held for as long
          // as a button is down -- shootAnimTimer keeps the lower-body-only
          // pool selected below for exactly as long as this pose plays.
          const shootAction = shootUpperActionRef.current;
          if (shootAction) {
            shootAnimTimer.current = shootAction.getClip().duration;
            shootAction.reset().fadeIn(0.05).play();
          }
        }
      }
    }

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
    // physically collides with the terrain/road (see collisionGroups
    // below), so this is the only thing placing it vertically. Enemies
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

    body.setLinvel({ x: worldVel.x, y: yVel, z: worldVel.z }, true);

    if (Math.random() < 0.002 && !message) {
      const phrase = phrases[Math.floor(Math.random() * phrases.length)];
      setMessage(phrase);
      setTimeout(() => setMessage(""), 3000);
    }

    if (shootAnimTimer.current > 0) {
      shootAnimTimer.current = Math.max(0, shootAnimTimer.current - delta);
    }
    const nextAnim = isMoving ? "run" : "idle";
    playAnim(nextAnim, shootAnimTimer.current > 0);

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
    <>
    <RigidBody
      ref={ref}
      type="dynamic"
      colliders={false}
      position={initialPosition}
      lockRotations
      // Proactively applied here even though the original never set this
      // explicitly for Enemy: Player.tsx's chassis needed allowSleep:false/
      // canSleep={false} because a sleeping body silently ignores every
      // velocity write, which is exactly the every-frame
      // body.setLinvel(...) pattern this component also uses for its
      // ground-snap + movement below -- so it's exposed to the identical
      // "stops responding after ~1s idle" failure mode Player.tsx already
      // diagnosed and fixed, whether or not it was ever separately reported
      // for enemies specifically.
      canSleep={false}
    >
      <BallCollider
        args={[radius]}
        position={[0, 0, 0]}
        friction={0}
        restitution={0}
        collisionGroups={groupsExcluding(CollisionGroups.Characters, CollisionGroups.TrimeshColliders)}
        onCollisionEnter={handleBulletHit}
      />
      <BallCollider
        args={[radius]}
        position={[0, height / 2, 0]}
        friction={0}
        restitution={0}
        collisionGroups={groupsExcluding(CollisionGroups.Characters, CollisionGroups.TrimeshColliders)}
        onCollisionEnter={handleBulletHit}
      />
      <BallCollider
        args={[radius]}
        position={[0, -height / 2, 0]}
        friction={0}
        restitution={0}
        collisionGroups={groupsExcluding(CollisionGroups.Characters, CollisionGroups.TrimeshColliders)}
        onCollisionEnter={handleBulletHit}
      />
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
    </RigidBody>
    {bullets.map((b) => (
      <Bullet key={b.id} id={b.id} position={b.pos} velocity={b.vel} owner="enemy" onKill={removeBullet} />
    ))}
    </>
  );
};

export default Enemy;
