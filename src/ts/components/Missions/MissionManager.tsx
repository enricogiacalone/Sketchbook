import React, { useCallback, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useStore } from "../../store";
import { useShallow } from "zustand/react/shallow";
import { getTerrainHeight } from "../Environment/Terrain";
import { getRoadOffset } from "../Environment/Road";
import { MISSIONS, MISSION_BEACON_POS } from "../../missions/missionDefinitions";
import Enemy from "../Enemy";

// "crea una missione come in gta" -- the state machine behind the 3-stage
// chain in ../../missions/missionDefinitions.ts. Lives inside <Physics>
// (mounted from Scene.tsx) because 'eliminate'/'survive' need to spawn
// real Enemy.tsx instances (RigidBody, needs the physics world), not
// because it renders much of its own -- the two marker meshes below are
// the only visuals actually owned here.
//
// Store fields (missionStage/Status/Title/Briefing/TimeRemaining/
// TargetPos) are OUTPUT ONLY from this component's point of view -- it's
// the only writer, everything else (MissionHUD, Minimap's target blip)
// just reads them, same split as Player.tsx owning isGrounded/health and
// the HUD/minimap only ever reading them.
const BEACON_RADIUS = 3;
const TRANSITION_DISPLAY_TIME = 3; // seconds a success/failed banner stays up before advancing/retrying
const WAVE_SPAWN_RADIUS = 8;

const MissionManager: React.FC = () => {
  const {
    missionStage,
    missionStatus,
    playerPos,
    isPlayerGrounded,
    isPaused,
    health,
    entities,
    setMissionStage,
    setMissionStatus,
    setMissionInfo,
    setMissionTimeRemaining,
    setMissionTargetPos,
    removeEntity,
  } = useStore(
    useShallow((state) => ({
      missionStage: state.missionStage,
      missionStatus: state.missionStatus,
      playerPos: state.playerPos,
      isPlayerGrounded: state.isPlayerGrounded,
      isPaused: state.isPaused,
      health: state.health,
      entities: state.entities,
      setMissionStage: state.setMissionStage,
      setMissionStatus: state.setMissionStatus,
      setMissionInfo: state.setMissionInfo,
      setMissionTimeRemaining: state.setMissionTimeRemaining,
      setMissionTargetPos: state.setMissionTargetPos,
      removeEntity: state.removeEntity,
    }))
  );

  // Locally-rendered mission-spawned enemies (the 'eliminate' target, or
  // the 'survive' wave) -- separate from the store's `entities` map, which
  // Enemy.tsx itself populates for the minimap once mounted. Kept as plain
  // state (not a ref) because it drives JSX below.
  const [missionEnemies, setMissionEnemies] = useState<{ id: string; position: [number, number, number] }[]>([]);
  const targetEnemyId = useRef<string | null>(null);
  const timeRemainingRef = useRef(0);
  const transitionTimerRef = useRef(0);
  const lastDisplayedSecond = useRef<number | null>(null);

  // Standalone mission enemies never revert to "an ordinary pedestrian"
  // (they were never one -- same as EnemySpawner.tsx's random spawns), so
  // there's nothing for onGiveUp to actually do: it just means the enemy
  // stops closing the distance for now and settles into idling, which
  // Enemy.tsx already does on its own once hasGivenUp latches (see its own
  // comment on that ref) -- it keeps existing and can still be killed.
  const handleEnemyGiveUp = useCallback(() => {}, []);

  const despawnMissionEnemies = useCallback(() => {
    // Explicit removeEntity for each -- Enemy.tsx has no unmount effect of
    // its own to clean up its minimap dot, so simply dropping them from
    // missionEnemies here (unmounting the <Enemy>) would otherwise leave a
    // stray, never-updating dot on the minimap forever (same latent gap as
    // EnemySpawner.tsx's own handleGiveUp -- not fixing that one here, but
    // not repeating it either).
    setMissionEnemies((prev) => {
      prev.forEach((e) => removeEntity(e.id));
      return [];
    });
    targetEnemyId.current = null;
  }, [removeEntity]);

  const startStage = useCallback(
    (stageIndex: number) => {
      const def = MISSIONS[stageIndex];
      if (!def) return;
      setMissionStatus("active");
      setMissionInfo(def.title, def.briefing);
      timeRemainingRef.current = def.timeLimit;
      lastDisplayedSecond.current = null;
      setMissionTimeRemaining(def.timeLimit);
      setMissionTargetPos(def.targetPos ?? null);

      if (def.type === "eliminate" && def.targetPos) {
        const eid = `mission-enemy-${def.id}`;
        targetEnemyId.current = eid;
        setMissionEnemies([{ id: eid, position: [def.targetPos[0], 15, def.targetPos[1]] }]);
      } else if (def.type === "survive") {
        const count = def.waveCount ?? 3;
        const spawned: { id: string; position: [number, number, number] }[] = [];
        for (let i = 0; i < count; i++) {
          const angle = (i / count) * Math.PI * 2;
          const rx = playerPos[0] + Math.cos(angle) * WAVE_SPAWN_RADIUS;
          const rz = playerPos[2] + Math.sin(angle) * WAVE_SPAWN_RADIUS;
          spawned.push({ id: `mission-wave-${def.id}-${i}`, position: [rx, 15, rz] });
        }
        setMissionEnemies(spawned);
      } else {
        setMissionEnemies([]);
      }
    },
    [playerPos, setMissionInfo, setMissionStatus, setMissionTargetPos, setMissionTimeRemaining]
  );

  const finishStage = useCallback(
    (outcome: "success" | "failed") => {
      setMissionStatus(outcome);
      transitionTimerRef.current = TRANSITION_DISPLAY_TIME;
      // 'eliminate' successes already despawned themselves (the target
      // died -- see the check below), but a timed-out drive/survive fail,
      // or a survive success reached purely by outlasting the clock, can
      // still have live mission enemies standing around; clear them so
      // they don't linger confusingly through the retry/next-briefing
      // wait below.
      despawnMissionEnemies();
    },
    [despawnMissionEnemies, setMissionStatus]
  );

  useFrame((_state, delta) => {
    if (isPaused) return;

    if (missionStatus === "inactive") {
      if (missionStage >= MISSIONS.length) return;
      const dx = playerPos[0] - MISSION_BEACON_POS[0];
      const dz = playerPos[2] - MISSION_BEACON_POS[1];
      if (isPlayerGrounded && dx * dx + dz * dz < BEACON_RADIUS * BEACON_RADIUS) {
        startStage(missionStage);
      }
      return;
    }

    if (missionStatus === "active") {
      const def = MISSIONS[missionStage];
      if (!def) return;

      timeRemainingRef.current = Math.max(0, timeRemainingRef.current - delta);
      const displaySecond = Math.ceil(timeRemainingRef.current);
      if (displaySecond !== lastDisplayedSecond.current) {
        lastDisplayedSecond.current = displaySecond;
        setMissionTimeRemaining(timeRemainingRef.current);
      }

      if (def.type === "survive") {
        // Win condition here is outlasting the clock, not the time
        // running out on you -- the opposite of drive/eliminate below.
        if (health <= 0) {
          finishStage("failed");
          return;
        }
        if (timeRemainingRef.current <= 0) {
          finishStage("success");
          return;
        }
        return;
      }

      if (timeRemainingRef.current <= 0) {
        finishStage("failed");
        return;
      }

      if (def.type === "drive" && def.targetPos && def.arriveRadius) {
        // playerPos freezes the instant you sit down in a vehicle (Player.tsx
        // only copies it while on foot) -- can't use it to track the
        // vehicle mid-drive. Every car/plane/heli already registers its
        // own live position in the shared entities map (same one the
        // minimap's vehicle icons read), so scan that instead of needing
        // the currently-controlled vehicle's id specifically -- simpler,
        // and it still only matters once one is actually close enough.
        let arrived = false;
        entities.forEach((entity) => {
          if (arrived) return;
          if (entity.type !== "car" && entity.type !== "airplane" && entity.type !== "helicopter") return;
          const dx = entity.position[0] - def.targetPos![0];
          const dz = entity.position[2] - def.targetPos![1];
          if (dx * dx + dz * dz < def.arriveRadius! * def.arriveRadius!) arrived = true;
        });
        if (arrived) finishStage("success");
      } else if (def.type === "eliminate") {
        // The dead target already removed itself from `entities` (Enemy.tsx's
        // own Explosion -> removeEntity(id), see its onFinish) -- this just
        // notices that and ends the mission; finishStage's own
        // despawnMissionEnemies() clears missionEnemies/targetEnemyId (its
        // removeEntity call becomes a harmless no-op for an id that's
        // already gone).
        if (targetEnemyId.current && !entities.has(targetEnemyId.current)) {
          finishStage("success");
        }
      }
      return;
    }

    // 'success' / 'failed' -- hold the banner up for a moment, then either
    // advance to the next stage (briefing shown while 'inactive', waiting
    // at the beacon again) or, on failure, go back to 'inactive' on the
    // SAME stage so walking back into the beacon retries it.
    if (missionStatus === "success" || missionStatus === "failed") {
      transitionTimerRef.current -= delta;
      if (transitionTimerRef.current > 0) return;

      if (missionStatus === "success") {
        const nextStage = missionStage + 1;
        setMissionTargetPos(null);
        if (nextStage >= MISSIONS.length) {
          setMissionStage(nextStage);
          setMissionStatus("allComplete");
          setMissionInfo("Tutte le missioni completate!", "");
        } else {
          setMissionStage(nextStage);
          setMissionStatus("inactive");
          setMissionInfo(MISSIONS[nextStage].title, MISSIONS[nextStage].briefing);
        }
      } else {
        setMissionTargetPos(null);
        setMissionStatus("inactive");
        setMissionInfo(MISSIONS[missionStage].title, MISSIONS[missionStage].briefing);
      }
    }
  });

  // -- Markers -------------------------------------------------------------
  const beaconRef = useRef<THREE.Mesh>(null);
  const targetRef = useRef<THREE.Mesh>(null);
  const beaconGroundY = getTerrainHeight(MISSION_BEACON_POS[0], MISSION_BEACON_POS[1]) + getRoadOffset(MISSION_BEACON_POS[0], MISSION_BEACON_POS[1]);

  const activeDef = MISSIONS[missionStage];
  const showBeacon = missionStatus === "inactive" && missionStage < MISSIONS.length;
  const showTarget = missionStatus === "active" && !!activeDef?.targetPos;
  const targetPos = activeDef?.targetPos;
  const targetGroundY = targetPos ? getTerrainHeight(targetPos[0], targetPos[1]) + getRoadOffset(targetPos[0], targetPos[1]) : 0;

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (beaconRef.current) {
      beaconRef.current.rotation.y = t * 1.4;
      beaconRef.current.position.y = beaconGroundY + 1.4 + Math.sin(t * 2) * 0.2;
    }
    if (targetRef.current) {
      targetRef.current.rotation.y = t * 1.8;
      targetRef.current.position.y = targetGroundY + 2.5 + Math.sin(t * 2.5) * 0.3;
    }
  });

  return (
    <>
      {showBeacon && (
        <mesh ref={beaconRef} position={[MISSION_BEACON_POS[0], beaconGroundY + 1.4, MISSION_BEACON_POS[1]]}>
          <octahedronGeometry args={[0.6, 0]} />
          <meshStandardMaterial color="#39c5ff" emissive="#0088ff" emissiveIntensity={1.4} />
        </mesh>
      )}
      {showTarget && targetPos && (
        <mesh ref={targetRef} position={[targetPos[0], targetGroundY + 2.5, targetPos[1]]}>
          <octahedronGeometry args={[0.9, 0]} />
          <meshStandardMaterial color="#ffd54a" emissive="#ff9900" emissiveIntensity={1.6} />
        </mesh>
      )}
      {missionEnemies.map((e) => (
        <Enemy key={e.id} id={e.id} initialPosition={e.position} onGiveUp={handleEnemyGiveUp} />
      ))}
    </>
  );
};

export default MissionManager;
