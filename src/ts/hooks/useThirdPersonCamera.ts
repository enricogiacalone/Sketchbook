import { cameraFocus } from '../lib/cameraFocus';
import { globalCameraShake } from '../lib/cameraShake';
import { useRef, useEffect } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useStore } from '../store';
import { useShallow } from 'zustand/react/shallow';
import { useInput } from './useInput';
import { droneMouseDelta, droneShake, droneCamPose } from '../lib/droneFlight';

const DUEL_CAR_CAM_RADIUS = 5;
const HELI_CAM_RADIUS = 8;
const MIN_RADIUS = 0.4;
const MAX_RADIUS = 10;
const FOCUS_Y_OFFSET = 0.4;
const _focusTarget = new THREE.Vector3();
const DUEL_START_RADIUS = 1.5;
const DUEL_START_PHI = 10; // degrees

const SHOULDER_OFFSET_HIP = 0.45;
const SHOULDER_OFFSET_AIM = 0.55;
const SHOULDER_UP = 0.12;
const AIM_RADIUS_FACTOR = 0.55;
const MIN_AIM_RADIUS = 1.3;
const AIM_FOV = 48;
const _shoulderOffset = new THREE.Vector3();

const CAMERA_STICK_DEADZONE = 0.2;
const CAMERA_STICK_YAW_SPEED = 140;
const CAMERA_STICK_PITCH_SPEED = 110;

const ZOOM_LEVELS = [0.85, 2.5, 5, 10];

const _droneShakeOffset = new THREE.Vector3();
const DRONE_SHAKE_DECAY = 0.85;

const _carCamQ = new THREE.Quaternion();
const _carCamF = new THREE.Vector3();
const _raycaster = new THREE.Raycaster();
const _rayDir = new THREE.Vector3();
const _idealCamPos = new THREE.Vector3();
const _prevVehiclePos = new THREE.Vector3();

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
      nameLower.includes('obstacle')
    ) {
      return true;
    }
    p = p.parent;
  }
  return false;
};

export const useThirdPersonCamera = () => {
  const { camera, gl, scene } = useThree();
  const {
    currentControllable,
    controlledEntityId,
    togglePause,
    cameraPlayerRadius,
    cameraVehicleRadius,
    cameraFootTargetY,
    cameraVehicleTargetY,
  } = useStore(
    useShallow((state) => ({
      currentControllable: state.currentControllable,
      controlledEntityId: state.controlledEntityId,
      togglePause: state.togglePause,
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

  const prevControllable = useRef<string | null>(null);
  const shoulderBlend = useRef(0);
  const focusBlend = useRef(0);
  const aimBlend = useRef(0);
  const baseFov = useRef<number | null>(null);

  const lastManualInputTime = useRef(performance.now());
  const effectiveCollisionRadius = useRef(cameraPlayerRadius);

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

    if (input.consumeJustPressed('pause')) {
      togglePause();
    }
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

    if (Math.abs(rx) > CAMERA_STICK_DEADZONE) {
      theta.current -= rx * CAMERA_STICK_YAW_SPEED * delta;
      if (isNaN(theta.current)) theta.current = 0;
      theta.current %= 360;
    }
    if (Math.abs(ry) > CAMERA_STICK_DEADZONE) {
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
        const r = currentControllable === 'helicopter' ? HELI_CAM_RADIUS : DUEL_CAR_CAM_RADIUS;
        targetRadius.current = r;
        radius.current = r;
        _prevVehiclePos.copy(targetObj.position);
      }
      prevControllable.current = currentControllable;
    }

    targetObj.getWorldPosition(target.current);
    if (isNaN(target.current.x) || isNaN(target.current.y) || isNaN(target.current.z)) return;

    target.current.y += isFootController ? cameraFootTargetY : cameraVehicleTargetY;

    const focusOn = isFootController && cameraFocus.id === targetName;
    focusBlend.current += ((focusOn ? 1 : 0) - focusBlend.current) * (1 - Math.exp(-delta * 10));
    if (focusOn) _focusTarget.set(cameraFocus.pos.x, cameraFocus.pos.y + FOCUS_Y_OFFSET, cameraFocus.pos.z);
    if (focusBlend.current > 0.001) target.current.lerp(_focusTarget, focusBlend.current);

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

    // 1. Soft Auto-Centering on Foot (GTA IV style)
    const ws = useStore.getState();
    const gunOn = isFootController && (ws.playerWeapon === 'pistol' || ws.playerWeapon === 'rifle');
    if (isFootController && !gunOn && performance.now() - lastManualInputTime.current > 1500) {
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

    const thetaRad = (theta.current * Math.PI) / 180;
    const phiRad = (phi.current * Math.PI) / 180;

    const k = 1 - Math.exp(-delta * 12);
    shoulderBlend.current += ((gunOn ? 1 : 0) - shoulderBlend.current) * k;
    aimBlend.current += ((gunOn && ws.playerAiming ? 1 : 0) - aimBlend.current) * k;
    const sb = shoulderBlend.current;
    const ab = aimBlend.current;
    const aimedRadius = Math.max(MIN_AIM_RADIUS, radius.current * AIM_RADIUS_FACTOR);
    const camRadius = THREE.MathUtils.lerp(radius.current, aimedRadius, ab);
    if (sb > 0.001) {
      const side = THREE.MathUtils.lerp(SHOULDER_OFFSET_HIP, SHOULDER_OFFSET_AIM, ab) * sb;
      _shoulderOffset.set(Math.cos(thetaRad) * side, SHOULDER_UP * sb, -Math.sin(thetaRad) * side);
      target.current.add(_shoulderOffset);
    }

    if ((camera as THREE.PerspectiveCamera).isPerspectiveCamera) {
      const pc = camera as THREE.PerspectiveCamera;
      if (baseFov.current === null) baseFov.current = pc.fov;
      let targetFov = baseFov.current;
      if (ab > 0.001) {
        targetFov = THREE.MathUtils.lerp(baseFov.current, AIM_FOV, ab);
      } else if (!isFootController) {
        const speed = targetObj.position.clone().sub(_prevVehiclePos).length() / Math.max(delta, 0.001);
        targetFov = baseFov.current + Math.min(speed * 0.6, 12);
      }
      const fov = THREE.MathUtils.lerp(pc.fov, targetFov, k);
      if (!isNaN(fov) && Math.abs(pc.fov - fov) > 0.01) {
        pc.fov = fov;
        pc.updateProjectionMatrix();
      }
    }

    _idealCamPos.set(
      target.current.x + camRadius * Math.sin(thetaRad) * Math.cos(phiRad),
      target.current.y + camRadius * Math.sin(phiRad),
      target.current.z + camRadius * Math.cos(thetaRad) * Math.cos(phiRad)
    );

    // 3. World Collision (Spherecast / Occlusion Probe) with exclusions
    _rayDir.copy(_idealCamPos).sub(target.current);
    const distToIdeal = _rayDir.length();
    let hitDist = distToIdeal;

    if (distToIdeal > 0.001) {
      _rayDir.normalize();
      _raycaster.set(target.current, _rayDir, 0, distToIdeal);
      _raycaster.camera = camera;
      const intersects = _raycaster.intersectObjects(scene.children, true);

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
};
