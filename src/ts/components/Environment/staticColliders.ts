import { useLayoutEffect } from 'react';
import { useRapier } from '@react-three/rapier';

// Collider fissi creati in blocco direttamente nel mondo Rapier, senza un
// componente React per ciascuno. Un palazzo vicino ha centinaia di pezzi
// di muro/solette/rampe: come <CuboidCollider> costavano ~15-20 ms di
// montaggio (scatto visibile quando il caricamento a zone carica un
// palazzo); creati qui costano meno di 1 ms. Gli eventi di collisione
// (proiettili, missili che esplodono sul muro) funzionano lo stesso: la
// libreria li inoltra anche per collider che non ha creato lei.

export interface StaticBox {
  half: [number, number, number]; // cilindro: [mezza altezza, raggio, -]
  pos: [number, number, number]; // relativa all'origine del corpo
  rotZ?: number;
  rot?: [number, number, number, number]; // quaternione (ha la precedenza su rotZ)
  shape?: 'cuboid' | 'cylinder';
  groups: number;
}

export function useStaticBoxes(origin: [number, number, number], boxes: StaticBox[]) {
  const { world, rapier } = useRapier();
  const [ox, oy, oz] = origin;
  useLayoutEffect(() => {
    if (boxes.length === 0) return;
    const body = world.createRigidBody(rapier.RigidBodyDesc.fixed().setTranslation(ox, oy, oz));
    for (const b of boxes) {
      const d = (
        b.shape === 'cylinder'
          ? rapier.ColliderDesc.cylinder(b.half[0], b.half[1])
          : rapier.ColliderDesc.cuboid(b.half[0], b.half[1], b.half[2])
      )
        .setTranslation(b.pos[0], b.pos[1], b.pos[2])
        .setCollisionGroups(b.groups);
      if (b.rot) d.setRotation({ x: b.rot[0], y: b.rot[1], z: b.rot[2], w: b.rot[3] });
      else if (b.rotZ) d.setRotation({ x: 0, y: 0, z: Math.sin(b.rotZ / 2), w: Math.cos(b.rotZ / 2) });
      world.createCollider(d, body);
    }
    return () => {
      // il mondo puo' essere gia' stato distrutto (smontaggio della scena)
      try {
        if (world.getRigidBody(body.handle)) world.removeRigidBody(body);
      } catch {
        /* niente */
      }
    };
  }, [world, rapier, ox, oy, oz, boxes]);
}
