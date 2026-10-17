import React, { useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { getPlanetStyle, usePlanetEpoch } from '../../lib/planet';
import { spaceState } from '../../lib/space';
import { getSunDirection, getDayFactor, getWarmth } from '../../lib/SunCycle';

// Atmospheric perspective -- "sistemiamo il cielo... nebbia atmosferica".
// The city/terrain extend ~300 units from the origin with nothing at all
// fading distant buildings into haze, so the world just stops sharply at
// whatever the far clip plane is. Exponential fog (falls off with
// distance-squared, more realistic for open outdoor scenes than linear
// fog) whose color tracks the same day/night state as the sky dome and
// sun light, so distant haze reads as "the sky's own horizon color"
// instead of a random gray that doesn't match anything.

const NIGHT_FOG = new THREE.Color('#05060d');

const SUNSET_TINT = new THREE.Color('#ffad66');

const WorldFog: React.FC = () => {
  const { scene } = useThree();
  // nebbia e foschia del pianeta (lib/planet.ts): cambiano col pianeta
  const epoch = usePlanetEpoch();
  const style = useMemo(() => getPlanetStyle(), [epoch]); // eslint-disable-line react-hooks/exhaustive-deps
  const dayFog = useMemo(() => new THREE.Color(style.fogTint), [style]);
  const fog = useMemo(() => new THREE.FogExp2('#05060d', 0.0055 * style.fogDensity), [style]);
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

    scratch.current.copy(NIGHT_FOG).lerp(dayFog, dayFactor);
    // Sunset/sunrise warm tint only shows up during the day/twilight
    // transition (warmth*dayFactor is ~0 both at full night and at noon,
    // peaking right around the horizon), not as a constant offset.
    scratch.current.lerp(SUNSET_TINT, warmth * dayFactor * 0.55);
    fog.color.copy(scratch.current);
    // nello spazio non c'e' foschia (lib/space.ts)
    const air = spaceState.fog;
    fog.density = 0.0055 * style.fogDensity * air;
  });

  return null;
};

export default WorldFog;
