import React, { useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { getSunDirection, getDayFactor, getWarmth } from '../../lib/SunCycle';

// Atmospheric perspective -- "sistemiamo il cielo... nebbia atmosferica".
// The city/terrain extend ~300 units from the origin with nothing at all
// fading distant buildings into haze, so the world just stops sharply at
// whatever the far clip plane is. Exponential fog (falls off with
// distance-squared, more realistic for open outdoor scenes than linear
// fog) whose color tracks the same day/night state as the sky dome and
// sun light, so distant haze reads as "the sky's own horizon color"
// instead of a random gray that doesn't match anything.
const FOG_DENSITY = 0.0055;

const NIGHT_FOG = new THREE.Color('#05060d');
const DAY_FOG = new THREE.Color('#c9d8e6');
const SUNSET_TINT = new THREE.Color('#ffad66');

const WorldFog: React.FC = () => {
  const { scene } = useThree();
  const fog = useMemo(() => new THREE.FogExp2('#05060d', FOG_DENSITY), []);
  const scratch = useRef(new THREE.Color());

  // Own the scene's fog for as long as this component is mounted --
  // restore whatever was there before on unmount (nothing, currently,
  // but this keeps the component self-contained instead of assuming it's
  // the only thing that will ever touch scene.fog).
  React.useEffect(() => {
    const previous = scene.fog;
    scene.fog = fog;
    return () => {
      scene.fog = previous;
    };
  }, [scene, fog]);

  useFrame((state) => {
    const dir = getSunDirection(state.clock.elapsedTime);
    const dayFactor = getDayFactor(dir.y);
    const warmth = getWarmth(dir.y);

    scratch.current.copy(NIGHT_FOG).lerp(DAY_FOG, dayFactor);
    // Sunset/sunrise warm tint only shows up during the day/twilight
    // transition (warmth*dayFactor is ~0 both at full night and at noon,
    // peaking right around the horizon), not as a constant offset.
    scratch.current.lerp(SUNSET_TINT, warmth * dayFactor * 0.55);
    fog.color.copy(scratch.current);
  });

  return null;
};

export default WorldFog;
