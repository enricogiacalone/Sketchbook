import React, { useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { getPlanetStyle, usePlanetEpoch } from '../../lib/planet';
import { spaceState } from '../../lib/space';
import { getCurrentSite } from '../../lib/site';
import { PLANET_RADIUS } from '../../lib/planetSurface';
import { getSunDirection, getDayFactor, getWarmth } from '../../lib/SunCycle';
import { useStore } from '../../store';
import { weather } from '../../lib/weather';

// Atmospheric perspective -- "sistemiamo il cielo... nebbia atmosferica".
// The city/terrain extend ~300 units from the origin with nothing at all
// fading distant buildings into haze, so the world just stops sharply at
// whatever the far clip plane is. Exponential fog (falls off with
// distance-squared, more realistic for open outdoor scenes than linear
// fog) whose color tracks the same day/night state as the sky dome and
// sun light, so distant haze reads as "the sky's own horizon color"
// instead of a random gray that doesn't match anything.

const NIGHT_FOG = new THREE.Color('#05060d');
const UNDER_FOG = new THREE.Color('#0a5a6c');
const NEON_FOG = new THREE.Color('#0c1c3d'); // nebbia blu della notte neon

const SUNSET_TINT = new THREE.Color('#ffad66');
const GREY_FOG = new THREE.Color('#9aa3ab'); // nebbia e pioggia: grigio chiaro (scuro di notte, vedi sotto)
const _fp = new THREE.Vector3();
const _fq = new THREE.Quaternion();
const _gf = new THREE.Color();

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

    scratch.current.copy(NIGHT_FOG).lerp(NEON_FOG, useStore.getState().neonNight ? 1 : 0).lerp(dayFog, dayFactor);
    // Sunset/sunrise warm tint only shows up during the day/twilight
    // transition (warmth*dayFactor is ~0 both at full night and at noon,
    // peaking right around the horizon), not as a constant offset.
    scratch.current.lerp(SUNSET_TINT, warmth * dayFactor * 0.55);
    // sott'acqua (lib/waterMaterial.ts): foschia fitta azzurro-verde
    const uw = spaceState.underwater;
    if (uw > 0.002) scratch.current.lerp(UNDER_FOG.clone().multiplyScalar(0.35 + 0.65 * dayFactor), uw);
    // meteo (lib/weather.ts): pioggia e nebbia mattutina schiariscono e ingrigiscono la foschia
    if (weather.grey > 0.002) scratch.current.lerp(_gf.copy(GREY_FOG).multiplyScalar(0.18 + 0.82 * dayFactor), weather.grey * (0.35 + 0.65 * dayFactor));
    fog.color.copy(scratch.current);
    // nello spazio non c'e' foschia (lib/space.ts)
    const air = spaceState.fog;
    // meno foschia lontano dalla citta': si vedono i laghi e le montagne lontane. Dipende dalla POSIZIONE sul pianeta
    // (distanza angolare dal polo), non dal sito montato: cambiare sito non cambia la nebbia
    const site = getCurrentSite();
    _fp.set(state.camera.position.x, state.camera.position.y + PLANET_RADIUS + site.hN, state.camera.position.z).applyQuaternion(_fq.copy(site.quat).invert()).normalize();
    const away = Math.min(1, Math.max(0, (Math.acos(Math.min(1, Math.max(-1, _fp.y))) - 0.1) / 0.2));
    fog.density = 0.0055 * style.fogDensity * air * (0.5 - 0.2 * away * away * (3 - 2 * away));
    fog.density *= weather.fogMul;
    fog.density = THREE.MathUtils.lerp(fog.density, 0.035, uw);
  });

  return null;
};

export default WorldFog;
