import type { World } from '@dimforge/rapier3d-compat';
import { vehicleBodyHandles } from '../components/Vehicles/vehicleRegistry';

// Posizione e "in movimento" di tutti i veicoli, letti una volta a frame: ogni
// personaggio sveglio controllava gli stessi ~55 corpi (auto parcheggiate,
// volanti, traffico) con 2 chiamate al motore fisico ciascuno, a ogni frame.
const MAX = 128;
export const vehicleSnap = {
  n: 0,
  x: new Float32Array(MAX),
  z: new Float32Array(MAX),
  moving: new Uint8Array(MAX),
  at: -1,
};

export function refreshVehicleSnapshot(world: World) {
  const now = performance.now();
  if (now - vehicleSnap.at < 8) return vehicleSnap;
  vehicleSnap.at = now;
  let n = 0;
  for (const h of vehicleBodyHandles) {
    if (n >= MAX) break;
    const b = world.getRigidBody(h);
    if (!b) continue;
    const t = b.translation();
    const v = b.linvel();
    vehicleSnap.x[n] = t.x;
    vehicleSnap.z[n] = t.z;
    vehicleSnap.moving[n] = v.x * v.x + v.z * v.z > 0.5 ? 1 : 0;
    n++;
  }
  vehicleSnap.n = n;
  return vehicleSnap;
}
