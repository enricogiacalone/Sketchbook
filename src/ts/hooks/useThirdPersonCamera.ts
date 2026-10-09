import { cameraFocus } from '../lib/cameraFocus';
import { globalCameraShake } from '../lib/cameraShake';
import { useRef, useEffect } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useStore } from '../store';
import { useShallow } from 'zustand/react/shallow';
import { useInput } from './useInput';
import { droneMouseDelta, droneShake, droneCamPose } from '../lib/droneFlight';
import { aimLock, collectAimTargets, type AimTarget } from '../lib/aimTargets';
import { physicsBridge } from '../lib/physicsBridge';
import { coverState } from '../lib/coverState';
import type { Ray } from '@dimforge/rapier3d-compat';

const HELI_CAM_RADIUS = 8;
const MIN_RADIUS = 0.4;
const MAX_RADIUS = 10;
const FOCUS_Y_OFFSET = 0.4;
const _focusTarget = new THREE.Vector3();
const DUEL_START_RADIUS = 1.8;
// a piedi la camera torna dietro al personaggio solo se si muove (m/s)
const FOOT_RECENTER_MIN_SPEED = 0.5;
const DUEL_START_PHI = 10; // degrees

const SHOULDER_OFFSET_HIP = 0.45;
const SHOULDER_OFFSET_AIM = 0.55;
const SHOULDER_UP = 0.12;
const AIM_RADIUS_FACTOR = 0.55;
const MIN_AIM_RADIUS = 1.3;
const AIM_FOV = 48;
const _shoulderOffset = new THREE.Vector3();

const CAMERA_STICK_DEADZONE = 0.2;
// aggancio della mira col pad (updateAimLock)
const AIM_LOCK_RANGE = 45; // m
const AIM_LOCK_CONE = THREE.MathUtils.degToRad(30); // dal centro dello schermo
const AIM_SWITCH_CONE = THREE.MathUtils.degToRad(55);
const AIM_SNAP = 14; // 1/s: quanto in fretta il mirino arriva sul bersaglio
const AIM_FINE = 0.3; // sensibilita' della levetta intorno al bersaglio
const AIM_OFF_YAW = 7; // gradi di correzione massima
const AIM_OFF_PITCH = 6;
const AIM_BREAK_S = 0.35; // spingendo oltre il margine per tanto si sgancia
const AIM_FLICK = 0.85; // levetta oltre: cambio bersaglio
const _aimTargets: AimTarget[] = [];
const _aimFwd = new THREE.Vector3();
const _aimV = new THREE.Vector3();
const _aimDir = new THREE.Vector3();
const CAMERA_STICK_YAW_SPEED = 140;
const CAMERA_STICK_PITCH_SPEED = 110;

// (il primo livello e' la distanza di partenza a piedi, store.cameraPlayerRadius)
const ZOOM_LEVELS = [1.4, 2.5, 5, 10];

const _droneShakeOffset = new THREE.Vector3();
const DRONE_SHAKE_DECAY = 0.85;

const _carCamQ = new THREE.Quaternion();
const _carCamF = new THREE.Vector3();
const _raycaster = new THREE.Raycaster();
let _camRay: Ray | null = null;
const _rayDir = new THREE.Vector3();
const _idealCamPos = new THREE.Vector3();
const _prevVehiclePos = new THREE.Vector3();

// Collisione della telecamera: prima il raggio provava TUTTA la scena a ogni
// frame (intersectObjects ricorsivo) e solo dopo scartava personaggi, auto,
// pali...: misurato 30 ms a frame in citta' (la meta' del frame), 16 dei
// quali sui manichini (il raggio su una mesh con scheletro rifa' la posa di
// ogni vertice), anche quelli nascosti. Ora i candidati (mesh solide, niente
// personaggi ne' scheletri) si raccolgono ogni 2 secondi, e a ogni
// frame si provano solo quelli visibili la cui sfera tocca il tratto
// bersaglio -> telecamera.
const COLLIDERS_REFRESH_S = 2;
const _collSphere = new THREE.Sphere();
const _collCenter = new THREE.Vector3();
const _collToC = new THREE.Vector3();
const _collNear: THREE.Object3D[] = [];
// decisione "si ignora?" per oggetto (il nome e gli antenati non cambiano):
// la raccolta dei candidati non rifa' i ~30 confronti di nomi per ogni
// antenato di ogni oggetto a ogni giro
const _ignoreMemo = new WeakMap<THREE.Object3D, boolean>();

// Helper to check if an object or its ancestors should be excluded from camera collision
const shouldIgnoreForCollision = (obj: THREE.Object3D, targetObj: THREE.Object3D): boolean => {
  let p: THREE.Object3D | null = obj;
  while (p) {
    if (p === targetObj || p.name === 'camera' || p.name === 'helper') {
      return true;
    }
    const nameLower = (p.name || '').toLowerCase();

    // Exclude other characters, vehicles, lampposts/poles/streetlights
    if (
      nameLower.includes('pedestrian') ||
      nameLower.includes('enemy') ||
      nameLower.includes('soldier') ||
      nameLower.includes('citizen') ||
      nameLower.includes('mannequin') ||
      nameLower.includes('fighter') ||
      nameLower.includes('police') ||
      nameLower.includes('agente') ||
      nameLower.includes('passante') ||
      nameLower.includes('nemico') ||
      nameLower.includes('combat') ||
      nameLower.includes('car') ||
      nameLower.includes('vehicle') ||
      nameLower.includes('helicopter') ||
      nameLower.includes('airplane') ||
      nameLower.includes('heli') ||
      nameLower.includes('wheel') ||
      nameLower.includes('door') ||
      nameLower.includes('drone') ||
      nameLower.includes('pole') ||
      nameLower.includes('lamp') ||
      nameLower.includes('palo') ||
      nameLower.includes('light') ||
      nameLower.includes('streetlamp') ||
      nameLower.includes('post') ||
      nameLower.includes('column') ||
      nameLower.includes('pillar') ||
      nameLower.includes('pendulum') ||
      nameLower.includes('piston') ||
      nameLower.includes('spinner') ||
      nameLower.includes('blade') ||
      nameLower.includes('bag') ||
      nameLower.includes('punchingbag') ||
      nameLower.includes('crate') ||
      nameLower.includes('prop') ||
      nameLower.includes('obstacle') ||
      nameLower.includes('crowd')
    ) {
      return true;
    }
    p = p.parent;
  }
  return false;
};

export const useThirdPersonCamera = () => {
  const { camera, gl, scene } = useThree();
  const { currentControllable, controlledEntityId, cameraPlayerRadius, cameraVehicleRadius, cameraFootTargetY, cameraVehicleTargetY } =
    useStore(
      useShallow((state) => ({
        currentControllable: state.currentControllable,
        controlledEntityId: state.controlledEntityId,
        cameraPlayerRadius: state.cameraPlayerRadius,
        cameraVehicleRadius: state.cameraVehicleRadius,
        cameraFootTargetY: state.cameraFootTargetY,
        cameraVehicleTargetY: state.cameraVehicleTargetY,
      }))
    );
  const input = useInput();

  const theta = useRef(0);
  const phi = useRef(0);
  const radius = useRef(cameraPlayerRadius);
  const targetRadius = useRef(cameraPlayerRadius);
  const target = useRef(new THREE.Vector3());
  const sensitivity = useRef(new THREE.Vector2(0.3, 0.24));
  const zoomIndex = useRef(0);
  // aggancio della mira: gia' provato su questa pressione di L2, correzione
  // fine (gradi), da quanto si spinge oltre il margine, levetta del frame prima
  const lockRef = useRef({ tried: false, offYaw: 0, offPitch: 0, push: 0, prevRx: 0 });

  const prevControllable = useRef<string | null>(null);
  const shoulderBlend = useRef(0);
  const focusBlend = useRef(0);
  const aimBlend = useRef(0);
  const baseFov = useRef<number | null>(null);

  const lastManualInputTime = useRef(performance.now());
  const effectiveCollisionRadius = useRef(cameraPlayerRadius);
  const footPrev = useRef(new THREE.Vector3());
  const footSpeed = useRef(0);

  useEffect(() => {
    if (import.meta.env.DEV) {
      (window as any).__camera = {
        get theta() {
          return theta.current;
        },
        get phi() {
          return phi.current;
        },
        setTheta: (deg: number) => {
          theta.current = isNaN(deg) ? 0 : deg;
        },
        setPhi: (deg: number) => {
          phi.current = isNaN(deg) ? 0 : THREE.MathUtils.clamp(deg, -85, 85);
        },
        lookTowards: (fromX: number, fromZ: number, toX: number, toZ: number) => {
          const dx = toX - fromX;
          const dz = toZ - fromZ;
          const len = Math.hypot(dx, dz) || 1;
          theta.current = (Math.atan2(-dx / len, -dz / len) * 180) / Math.PI;
        },
        get camPos() {
          return camera.position.toArray();
        },
        get camQuat() {
          return camera.quaternion.toArray();
        },
        get target() {
          return target.current.toArray();
        },
      };
    }
  }, []);

  const collidersRef = useRef<{ list: THREE.Mesh[]; age: number; target: THREE.Object3D | null }>({
    list: [],
    age: Infinity,
    target: null,
  });
  const cachedTargetName = useRef<string | null>(null);
  const cachedTargetObj = useRef<THREE.Object3D | null>(null);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (document.pointerLockElement !== gl.domElement) return;
      if (useStore.getState().weaponWheelOpen) return;
      if (useStore.getState().isDrone) {
        droneMouseDelta.x += e.movementX;
        droneMouseDelta.y += e.movementY;
        return;
      }
      if (isNaN(e.movementX) || isNaN(e.movementY)) return;
      lastManualInputTime.current = performance.now();
      theta.current -= e.movementX * (sensitivity.current.x / 2);
      if (isNaN(theta.current)) theta.current = 0;
      theta.current %= 360;
      phi.current += e.movementY * (sensitivity.current.y / 2);
      if (isNaN(phi.current)) phi.current = 0;
      phi.current = THREE.MathUtils.clamp(phi.current, -85, 85);
    };

    const handleWheel = (e: WheelEvent) => {
      if (isNaN(e.deltaY)) return;
      targetRadius.current = THREE.MathUtils.clamp(targetRadius.current + e.deltaY * 0.005, MIN_RADIUS, MAX_RADIUS);
    };

    const handleClick = () => {
      // ispettore NPC: il mouse resta libero per scegliere i personaggi
      if (useStore.getState().npcInspector) return;
      if (document.pointerLockElement !== gl.domElement) {
        gl.domElement.requestPointerLock();
      }
    };

    gl.domElement.addEventListener('mousemove', handleMouseMove);
    gl.domElement.addEventListener('wheel', handleWheel);
    gl.domElement.addEventListener('click', handleClick);

    return () => {
      gl.domElement.removeEventListener('mousemove', handleMouseMove);
      gl.domElement.removeEventListener('wheel', handleWheel);
      gl.domElement.removeEventListener('click', handleClick);
    };
  }, [gl]);

  useFrame((_state, delta) => {
    if (useStore.getState().debugOrthoCamera) return;
    if (isNaN(delta) || delta <= 0 || delta > 0.5) delta = 0.016;

    // Start/Esc: la pausa la gestisce GameFreeze.tsx (deve funzionare anche
    // a gioco fermo, quando questo useFrame non gira); qui si scarta solo
    input.consumeJustPressed('pause');
    if (input.consumeJustPressed('camera')) {
      zoomIndex.current = (zoomIndex.current + 1) % ZOOM_LEVELS.length;
      targetRadius.current = ZOOM_LEVELS[zoomIndex.current];
    }

    const phoneInput = (window as any).__phoneControllerInput;
    let rx = 0;
    let ry = 0;

    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
    let pad: Gamepad | null = null;
    for (let i = 0; i < pads.length; i++) {
      if (pads[i]) {
        pad = pads[i] as Gamepad;
        break;
      }
    }
    if (pad && !useStore.getState().weaponWheelOpen) {
      rx = pad.axes[2] ?? 0;
      ry = pad.axes[3] ?? 0;
    } else if (phoneInput && phoneInput.axesRight) {
      rx = phoneInput.axesRight[0] ?? 0;
      ry = phoneInput.axesRight[1] ?? 0;
    }

    if (Math.abs(rx) > CAMERA_STICK_DEADZONE || Math.abs(ry) > CAMERA_STICK_DEADZONE) {
      lastManualInputTime.current = performance.now();
    }

    // agganciati a un bersaglio (mira col pad, sotto): la levetta destra
    // corregge la mira intorno al bersaglio invece di girare la camera
    if (Math.abs(rx) > CAMERA_STICK_DEADZONE && !aimLock.id) {
      theta.current -= rx * CAMERA_STICK_YAW_SPEED * delta;
      if (isNaN(theta.current)) theta.current = 0;
      theta.current %= 360;
    }
    if (Math.abs(ry) > CAMERA_STICK_DEADZONE && !aimLock.id) {
      phi.current = THREE.MathUtils.clamp(phi.current + ry * CAMERA_STICK_PITCH_SPEED * delta, -85, 85);
      if (isNaN(phi.current)) phi.current = 0;
    }

    const isFootController = currentControllable === 'player' || currentControllable === 'combatSoldier';
    const targetName = currentControllable === 'player' ? 'player' : controlledEntityId;
    if (!targetName) return;

    if (cachedTargetName.current !== targetName || !cachedTargetObj.current || !cachedTargetObj.current.parent) {
      cachedTargetObj.current = scene.getObjectByName(targetName) ?? null;
      cachedTargetName.current = targetName;
    }
    const targetObj = cachedTargetObj.current;
    if (!targetObj) return;

    if (prevControllable.current !== currentControllable) {
      const snapped = isFootController ? cameraPlayerRadius : cameraVehicleRadius;
      targetRadius.current = snapped;
      radius.current = snapped;
      effectiveCollisionRadius.current = snapped;
      if (currentControllable === 'combatSoldier') {
        theta.current = THREE.MathUtils.radToDeg(targetObj.rotation.y);
        phi.current = DUEL_START_PHI;
        targetRadius.current = DUEL_START_RADIUS;
        radius.current = DUEL_START_RADIUS;
      } else if (
        (currentControllable === 'car' || currentControllable === 'helicopter') &&
        (prevControllable.current === 'combatSoldier' || prevControllable.current === 'player')
      ) {
        targetObj.getWorldQuaternion(_carCamQ);
        _carCamF.set(0, 0, 1).applyQuaternion(_carCamQ);
        theta.current = THREE.MathUtils.radToDeg(Math.atan2(_carCamF.x, _carCamF.z) + Math.PI);
        phi.current = 15;
        // (in auto parte gia' alla sua distanza: prima partiva da 5 m e si
        // avvicinava a quella di guida, un'avanti-indietro inutile)
        const r = currentControllable === 'helicopter' ? HELI_CAM_RADIUS : cameraVehicleRadius;
        targetRadius.current = r;
        radius.current = r;
        _prevVehiclePos.copy(targetObj.position);
      }
      prevControllable.current = currentControllable;
    }

    targetObj.getWorldPosition(target.current);
    if (isNaN(target.current.x) || isNaN(target.current.y) || isNaN(target.current.z)) return;

    target.current.y += isFootController ? cameraFootTargetY : cameraVehicleTargetY;

    const ws = useStore.getState();
    const gunOn = isFootController && (ws.playerWeapon === 'pistol' || ws.playerWeapon === 'rifle');

    // R3 tenuto a piedi: guarda dietro (come in GTA), senza toccare la camera vera
    const lookBack = isFootController && !!pad?.buttons[11]?.pressed && !ws.playerAiming;
    const thetaRad = ((theta.current + (lookBack ? 180 : 0)) * Math.PI) / 180;
    const phiRad = (phi.current * Math.PI) / 180;

    if (isFootController && gunOn) {
      const sb_val = shoulderBlend.current;
      const ab_val = aimBlend.current;
      const forwardLook = THREE.MathUtils.lerp(0.6, 1.3, ab_val);
      const sideLook = THREE.MathUtils.lerp(0.35, 0.55, ab_val) * sb_val;
      target.current.x += Math.sin(thetaRad) * forwardLook + Math.cos(thetaRad) * sideLook;
      target.current.z += Math.cos(thetaRad) * forwardLook - Math.sin(thetaRad) * sideLook;
    }

    const focusOn = isFootController && cameraFocus.id === targetName;
    focusBlend.current += ((focusOn ? 1 : 0) - focusBlend.current) * (1 - Math.exp(-delta * 10));
    if (focusOn) _focusTarget.set(cameraFocus.pos.x, cameraFocus.pos.y + FOCUS_Y_OFFSET, cameraFocus.pos.z);
    if (focusBlend.current > 0.001) target.current.lerp(_focusTarget, focusBlend.current);

    // "sistema la mira, falla come gta" (aggancio morbido di GTA V): mirando
    // col pad (L2 con un'arma) il mirino va sul petto del bersaglio piu'
    // vicino al centro dello schermo e lo segue; la levetta destra sposta la
    // mira di qualche grado intorno a lui (per la testa o le gambe), un colpo
    // deciso di levetta passa al bersaglio accanto da quella parte, e
    // spingendo oltre il margine per un attimo ci si sgancia e si mira
    // libero. Col mouse la mira resta libera, come su PC.
    updateAimLock(isFootController && gunOn && !!ws.playerAiming && !!pad?.buttons[6]?.pressed, rx, ry, delta);

    if (useStore.getState().isDrone) {
      camera.position.copy(droneCamPose.position);
      camera.quaternion.copy(droneCamPose.quaternion);
      if (droneShake.current > 0.0001) {
        _droneShakeOffset.set(
          (Math.random() - 0.5) * droneShake.current,
          (Math.random() - 0.5) * droneShake.current,
          (Math.random() - 0.5) * droneShake.current
        );
        camera.position.add(_droneShakeOffset);
      }
      droneShake.current *= Math.pow(DRONE_SHAKE_DECAY, delta * 60);
      return;
    }

    // In copertura (lib/coverState.ts) la telecamera resta dove la metti:
    // "disabilita l'autocalibratura della camera mentre nascosto"
    const inCover = isFootController && coverState.on && performance.now() - coverState.t < 200;

    // 1. Soft Auto-Centering on Foot (GTA IV style)
    // "deve attivarsi solo quando sto camminando o correndo, non da fermo":
    // velocita' del personaggio (dal suo spostamento, smussata)
    if (isFootController) {
      if (footPrev.current.lengthSq() === 0) footPrev.current.copy(targetObj.position);
      const v = Math.hypot(targetObj.position.x - footPrev.current.x, targetObj.position.z - footPrev.current.z) / Math.max(delta, 0.001);
      footPrev.current.copy(targetObj.position);
      footSpeed.current += (Math.min(v, 15) - footSpeed.current) * (1 - Math.exp(-delta * 8));
    }
    const footMoving = footSpeed.current > FOOT_RECENTER_MIN_SPEED;
    if (isFootController && footMoving && !gunOn && !inCover && performance.now() - lastManualInputTime.current > 1500) {
      const charHeadingDeg = THREE.MathUtils.radToDeg(targetObj.rotation.y);
      if (!isNaN(charHeadingDeg)) {
        let diff = (charHeadingDeg - theta.current) % 360;
        if (diff > 180) diff -= 360;
        if (diff < -180) diff += 360;
        theta.current += diff * (1 - Math.exp(-delta * 2));
        theta.current %= 360;
      }
    }

    // 2. Vehicle Velocity Follow & Dynamic FOV/Radius (GTA IV style)
    if (!isFootController) {
      if (_prevVehiclePos.lengthSq() === 0) {
        _prevVehiclePos.copy(targetObj.position);
      }
      const vel = targetObj.position.clone().sub(_prevVehiclePos).divideScalar(Math.max(delta, 0.001));
      _prevVehiclePos.copy(targetObj.position);
      const speed = Math.min(vel.length(), 50);
      if (speed > 0.3) {
        const velTheta = THREE.MathUtils.radToDeg(Math.atan2(vel.x, vel.z)) + 180;
        let diff = (velTheta - theta.current) % 360;
        if (diff > 180) diff -= 360;
        if (diff < -180) diff += 360;
        theta.current += diff * (1 - Math.exp(-delta * 3));
        theta.current %= 360;
      }
      const baseR = currentControllable === 'helicopter' ? HELI_CAM_RADIUS : cameraVehicleRadius;
      targetRadius.current = baseR + Math.min(speed * 0.2, 5);
    } else {
      // If on foot, follow store setting if user changes it via lil-gui
      if (Math.abs(targetRadius.current - cameraPlayerRadius) > 0.5 && document.activeElement?.tagName !== 'INPUT') {
        // Only update if not actively scrolling/zooming wheel far from default
      }
    }

    // Strict clamping on targetRadius and radius to prevent any runaway zoom out
    targetRadius.current = THREE.MathUtils.clamp(targetRadius.current, MIN_RADIUS, MAX_RADIUS);
    radius.current = THREE.MathUtils.lerp(radius.current, targetRadius.current, 0.1);
    radius.current = THREE.MathUtils.clamp(radius.current, MIN_RADIUS, MAX_RADIUS);
    if (isNaN(radius.current)) radius.current = cameraPlayerRadius;

    const k = 1 - Math.exp(-delta * 12);
    shoulderBlend.current += ((gunOn ? 1 : 0) - shoulderBlend.current) * k;
    aimBlend.current += ((gunOn && ws.playerAiming ? 1 : 0) - aimBlend.current) * k;
    const sb = shoulderBlend.current;
    const ab = aimBlend.current;
    const aimedRadius = Math.max(MIN_AIM_RADIUS, radius.current * AIM_RADIUS_FACTOR);
    const camRadius = THREE.MathUtils.lerp(radius.current, aimedRadius, ab);
    _idealCamPos.set(
      target.current.x + camRadius * Math.sin(thetaRad) * Math.cos(phiRad),
      target.current.y + camRadius * Math.sin(phiRad),
      target.current.z + camRadius * Math.cos(thetaRad) * Math.cos(phiRad)
    );

    if (sb > 0.001) {
      const side = THREE.MathUtils.lerp(SHOULDER_OFFSET_HIP, SHOULDER_OFFSET_AIM, ab) * sb;
      _shoulderOffset.set(-Math.cos(thetaRad) * side, SHOULDER_UP * sb, Math.sin(thetaRad) * side);
      _idealCamPos.add(_shoulderOffset);
    }

    // 3. World Collision (Spherecast / Occlusion Probe) with exclusions
    _rayDir.copy(_idealCamPos).sub(target.current);
    const distToIdeal = _rayDir.length();
    let hitDist = distToIdeal;

    const pb = physicsBridge;
    if (distToIdeal > 0.001 && pb.world && pb.rapier) {
      // "fai la 4" (prestazioni): il raggio contro le mesh costava ~10 ms a
      // frame in citta' (misurato: 356 candidati, quasi tutti instanced che
      // coprono la citta' intera e mesh grandi senza BVH -- un terzo del
      // frame). Ora un raggio della fisica contro i soli collider fissi
      // (palazzi, terreno, oggetti fermi): microsecondi, e la telecamera si
      // ferma sulla forma di collisione, come in GTA. Niente personaggi ne'
      // veicoli (dinamici/cinematici): non c'e' niente da escludere a mano.
      _rayDir.normalize();
      const R = pb.rapier;
      _camRay ??= new R.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });
      _camRay.origin = { x: target.current.x, y: target.current.y, z: target.current.z };
      _camRay.dir = { x: _rayDir.x, y: _rayDir.y, z: _rayDir.z };
      let best = Infinity;
      pb.world.intersectionsWithRay(
        _camRay,
        distToIdeal,
        true,
        (h) => {
          const t = h.timeOfImpact;
          if (t > 0.2 && t < best) best = t;
          return true;
        },
        R.QueryFilterFlags.EXCLUDE_DYNAMIC | R.QueryFilterFlags.EXCLUDE_KINEMATIC | R.QueryFilterFlags.EXCLUDE_SENSORS
      );
      if (best < Infinity) hitDist = Math.max(0.4, best - 0.2);
    } else if (distToIdeal > 0.001) {
      // (senza mondo fisico: il vecchio raggio contro le mesh)
      _rayDir.normalize();
      _raycaster.set(target.current, _rayDir);
      _raycaster.near = 0;
      _raycaster.far = distToIdeal;
      _raycaster.camera = camera;
      const cc = collidersRef.current;
      cc.age += delta;
      if (cc.age > COLLIDERS_REFRESH_S || cc.target !== targetObj) {
        cc.age = 0;
        cc.target = targetObj;
        cc.list.length = 0;
        scene.traverse((o) => {
          const m = o as THREE.Mesh;
          if (!m.isMesh || (m as unknown as THREE.SkinnedMesh).isSkinnedMesh) return;
          if (targetObj) {
            let ign = _ignoreMemo.get(m);
            if (ign === undefined) {
              ign = shouldIgnoreForCollision(m, targetObj);
              _ignoreMemo.set(m, ign);
            }
            if (ign) return;
          }
          if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere();
          cc.list.push(m);
        });
      }
      // solo i candidati visibili vicini al tratto bersaglio -> telecamera
      _collNear.length = 0;
      for (const m of cc.list) {
        if (!m.visible || !m.parent) continue;
        if ((m as unknown as THREE.InstancedMesh).isInstancedMesh) {
          _collNear.push(m);
          continue;
        }
        const bs = m.geometry.boundingSphere;
        if (!bs) continue;
        _collSphere.copy(bs).applyMatrix4(m.matrixWorld);
        _collCenter.copy(_collSphere.center);
        _collToC.subVectors(_collCenter, target.current);
        const along = THREE.MathUtils.clamp(_collToC.dot(_rayDir), 0, distToIdeal);
        _collToC.addScaledVector(_rayDir, -along);
        if (_collToC.lengthSq() <= _collSphere.radius * _collSphere.radius) _collNear.push(m);
      }
      const intersects = _raycaster.intersectObjects(_collNear, false);

      for (let i = 0; i < intersects.length; i++) {
        const obj = intersects[i].object;
        if (shouldIgnoreForCollision(obj, targetObj)) {
          continue;
        }
        if (intersects[i].distance > 0.2 && !isNaN(intersects[i].distance)) {
          hitDist = Math.max(0.4, intersects[i].distance - 0.2);
          break;
        }
      }
    }

    if (isNaN(hitDist)) hitDist = camRadius;
    effectiveCollisionRadius.current = THREE.MathUtils.lerp(
      effectiveCollisionRadius.current,
      hitDist,
      hitDist < effectiveCollisionRadius.current ? 0.5 : 0.1
    );
    effectiveCollisionRadius.current = THREE.MathUtils.clamp(effectiveCollisionRadius.current, MIN_RADIUS, MAX_RADIUS);
    if (isNaN(effectiveCollisionRadius.current)) effectiveCollisionRadius.current = camRadius;

    camera.position.set(
      target.current.x + effectiveCollisionRadius.current * Math.sin(thetaRad) * Math.cos(phiRad),
      target.current.y + effectiveCollisionRadius.current * Math.sin(phiRad),
      target.current.z + effectiveCollisionRadius.current * Math.cos(thetaRad) * Math.cos(phiRad)
    );

    // 4. Global Camera Shake System
    if (globalCameraShake.intensity > 0.0001 && !isNaN(globalCameraShake.intensity)) {
      camera.position.x += (Math.random() - 0.5) * globalCameraShake.intensity;
      camera.position.y += (Math.random() - 0.5) * globalCameraShake.intensity;
      camera.position.z += (Math.random() - 0.5) * globalCameraShake.intensity;
      globalCameraShake.intensity *= Math.pow(0.85, delta * 60);
      if (isNaN(globalCameraShake.intensity)) globalCameraShake.intensity = 0;
    }

    camera.lookAt(target.current);
  });

  return { theta, phi, radius };

  function updateAimLock(aimPad: boolean, rx: number, ry: number, delta: number) {
    const lk = lockRef.current;
    if (!aimPad) {
      if (aimLock.id) aimLock.id = null;
      lk.tried = false;
      lk.prevRx = 0;
      publishLock();
      return;
    }
    collectAimTargets(_aimTargets);
    camera.getWorldDirection(_aimFwd);
    if (!aimLock.id && !lk.tried) {
      // si aggancia solo appena si preme L2 (come in GTA: per riprovare si
      // ripreme)
      lk.tried = true;
      const best = pickAimTarget(_aimFwd, null, 0);
      if (best) {
        aimLock.id = best.id;
        lk.offYaw = 0;
        lk.offPitch = 0;
        lk.push = 0;
      }
    }
    const cur = aimLock.id ? _aimTargets.find((t) => t.id === aimLock.id) : undefined;
    if (aimLock.id && (!cur || Math.hypot(cur.x - camera.position.x, cur.z - camera.position.z) > AIM_LOCK_RANGE * 1.3)) aimLock.id = null;
    if (aimLock.id && cur) {
      // colpo deciso di levetta: bersaglio accanto da quella parte
      if (Math.abs(rx) > AIM_FLICK && Math.abs(lk.prevRx) < 0.5) {
        const next = pickAimTarget(_aimFwd, cur, Math.sign(rx));
        if (next) {
          aimLock.id = next.id;
          lk.offYaw = 0;
          lk.offPitch = 0;
          lk.push = 0;
        }
      } else {
        // correzione fine intorno al bersaglio; spingere oltre il margine
        // per AIM_BREAK_S sgancia
        if (Math.abs(rx) > CAMERA_STICK_DEADZONE) lk.offYaw -= rx * CAMERA_STICK_YAW_SPEED * AIM_FINE * delta;
        if (Math.abs(ry) > CAMERA_STICK_DEADZONE) lk.offPitch += ry * CAMERA_STICK_PITCH_SPEED * AIM_FINE * delta;
        const atEdge = Math.abs(lk.offYaw) > AIM_OFF_YAW || Math.abs(lk.offPitch) > AIM_OFF_PITCH;
        lk.offYaw = THREE.MathUtils.clamp(lk.offYaw, -AIM_OFF_YAW, AIM_OFF_YAW);
        lk.offPitch = THREE.MathUtils.clamp(lk.offPitch, -AIM_OFF_PITCH, AIM_OFF_PITCH);
        lk.push = atEdge ? lk.push + delta : 0;
        if (lk.push > AIM_BREAK_S) aimLock.id = null;
      }
    }
    lk.prevRx = rx;
    const t = aimLock.id ? _aimTargets.find((x) => x.id === aimLock.id) : undefined;
    if (t) {
      aimLock.x = t.x;
      aimLock.y = t.y;
      aimLock.z = t.z;
      // camera, punto guardato e petto del bersaglio in fila: il mirino (al
      // centro dello schermo) e' sul bersaglio
      _aimDir.set(t.x - target.current.x, t.y - target.current.y, t.z - target.current.z).normalize();
      const wantTheta = THREE.MathUtils.radToDeg(Math.atan2(-_aimDir.x, -_aimDir.z)) + lk.offYaw;
      const wantPhi = THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(Math.asin(-_aimDir.y)) + lk.offPitch, -85, 85);
      const k = 1 - Math.exp(-delta * AIM_SNAP);
      let dT = (wantTheta - theta.current) % 360;
      if (dT > 180) dT -= 360;
      if (dT < -180) dT += 360;
      theta.current = (theta.current + dT * k) % 360;
      phi.current += (wantPhi - phi.current) * k;
    }
    publishLock();
  }

  // il bersaglio migliore: dentro il cono davanti alla camera, il piu' vicino
  // al centro (un po' preferiti i vicini). Con `from` e `side`: il primo
  // dalla parte `side` (+1 destra dello schermo, -1 sinistra) rispetto a `from`.
  function pickAimTarget(fwd: THREE.Vector3, from: AimTarget | undefined | null, side: number) {
    const cp = camera.position;
    const fromYaw = from ? Math.atan2(from.x - cp.x, from.z - cp.z) : 0;
    let best: AimTarget | null = null;
    let bestScore = Infinity;
    for (const t of _aimTargets) {
      if (from && t.id === from.id) continue;
      _aimV.set(t.x - cp.x, t.y - cp.y, t.z - cp.z);
      const d = _aimV.length();
      if (d < 1 || d > AIM_LOCK_RANGE) continue;
      const ang = Math.acos(THREE.MathUtils.clamp(_aimV.dot(fwd) / d, -1, 1));
      if (ang > (from ? AIM_SWITCH_CONE : AIM_LOCK_CONE)) continue;
      let score = ang + d * 0.004;
      if (from) {
        // a destra dello schermo = yaw che diminuisce (sistema di theta)
        let dy = Math.atan2(t.x - cp.x, t.z - cp.z) - fromYaw;
        dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        if (-dy * side <= 0.01) continue;
        score = Math.abs(dy) + d * 0.004;
      }
      if (score < bestScore) {
        bestScore = score;
        best = t;
      }
    }
    return best;
  }

  function publishLock() {
    const on = !!aimLock.id;
    if (useStore.getState().aimLocked !== on) useStore.setState({ aimLocked: on });
  }
};
