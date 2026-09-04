import { useRef, useEffect } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useStore } from '../store';

export const useThirdPersonCamera = () => {
  const { camera, gl } = useThree();
  const { currentControllable, controlledEntityId } = useStore();
  
  // State for camera orientation
  const theta = useRef(0); // Horizontal angle
  const phi = useRef(15);   // Vertical angle
  const radius = useRef(5); // Current distance
  const targetRadius = useRef(5);
  
  // Smoothing refs
  const smoothTarget = useRef(new THREE.Vector3());
  const sensitivity = useRef(new THREE.Vector2(0.3, 0.3));

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (document.pointerLockElement === gl.domElement) {
        theta.current -= e.movementX * sensitivity.current.x;
        phi.current += e.movementY * sensitivity.current.y;
        
        // Clamp vertical rotation to prevent flipping
        phi.current = THREE.MathUtils.clamp(phi.current, -10, 80);
      }
    };

    const handleWheel = (e: WheelEvent) => {
      targetRadius.current = THREE.MathUtils.clamp(targetRadius.current + e.deltaY * 0.005, 2, 25);
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

  useFrame((state, delta) => {
    // Determine the target object name
    const targetName = currentControllable === 'player' ? 'player' : controlledEntityId;
    if (!targetName) return;

    const targetObj = state.scene.getObjectByName(targetName);
    if (!targetObj) return;

    // Get the target position in world coordinates
    const targetPos = new THREE.Vector3();
    targetObj.getWorldPosition(targetPos);

    // Adjust target offset based on entity type for better visibility
    let heightOffset = 0.8;
    let lookAtOffset = 1.0;
    if (currentControllable === 'airplane') {
      heightOffset = 1.5;
      lookAtOffset = 0.5;
    } else if (currentControllable === 'helicopter') {
      heightOffset = 2.0;
      lookAtOffset = 0.5;
    } else if (currentControllable === 'car') {
      heightOffset = 1.0;
      lookAtOffset = 0.5;
    }

    // 1. Smoothly follow the target position
    const lerpTarget = new THREE.Vector3(targetPos.x, targetPos.y + heightOffset, targetPos.z);
    smoothTarget.current.lerp(lerpTarget, 0.1);
    
    // 2. Smoothly adjust the radius
    radius.current = THREE.MathUtils.lerp(radius.current, targetRadius.current, 0.1);

    // 3. Calculate position on a sphere around the target
    const thetaRad = THREE.MathUtils.degToRad(theta.current);
    const phiRad = THREE.MathUtils.degToRad(phi.current);

    const x = smoothTarget.current.x + radius.current * Math.sin(thetaRad) * Math.cos(phiRad);
    const y = smoothTarget.current.y + radius.current * Math.sin(phiRad);
    const z = smoothTarget.current.z + radius.current * Math.cos(thetaRad) * Math.cos(phiRad);

    // 4. Update camera
    camera.position.set(x, y, z);
    camera.lookAt(smoothTarget.current.x, smoothTarget.current.y - heightOffset + lookAtOffset, smoothTarget.current.z);
  });

  return { theta, phi, radius };
};
