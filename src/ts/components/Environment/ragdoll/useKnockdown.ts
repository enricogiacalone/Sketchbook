import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { GETUP_CLIP, measureLyingPose, newKnockdown, stepKnockdown, getUpPlacement, type LyingPose } from './knockdown';
import type { RagdollController } from './useRagdoll';

// "allinea la ragdoll dei passanti con quella dei nemici nell'arena" -- KO
// fisico e rialzo in UN solo pezzo, usato da giocatore
// (PlayerCombatSoldier), nemico del duello (CombatSoldier) e personaggi
// della citta' (city/useMannequinActor: passanti, nemici, poliziotti).
// Prima ognuno aveva la sua copia e si erano disallineati (la citta' non
// cadeva affatto, il nemico del duello non aveva l'alzata del rialzo).
//
// Sequenza: start() -> il corpo attivo va KO (useRagdoll.knockDown) ->
// step() a ogni frame finche' e' a terra (si gira sulla schiena se serve,
// vedi knockdown.ts) -> quando e' fermo step() dice dove mettere la radice
// e con che rotazione: chi chiama sposta il personaggio li' e fa partire
// GETUP_CLIP senza dissolvenza -> lift() alza il modello all'inizio del
// rialzo e scende piano (tick() a ogni frame).
//
// Rotazione: quella dei combattenti (FighterData.rotation, = rotation.y del
// gruppo del giocatore, il cui modello e' girato di PI). Chi monta il
// modello senza quel PI (useMannequinActor) aggiunge PI al gruppo.

// rialzo da terra: alzata massima della clip (m) e in quanto torna a zero (s).
// La clip ha le articolazioni a filo del suolo (bacino a 4 cm), il corpo
// fisico ci sta sopra con il suo spessore (bacino a ~15): senza alzarla i
// motori tiravano gomiti e mani dentro il pavimento.
export const GETUP_LIFT_MAX = 0.25;
export const GETUP_LIFT_S = 0.9;

export interface GetUpPlace {
  x: number;
  z: number;
  rotation: number;
}

export type KnockdownStep = { done: false } | { done: true; place: GetUpPlace | null };

export function useKnockdown(ragdoll: RagdollController, scene: THREE.Object3D, getUpClip: THREE.AnimationClip | undefined) {
  const kdRef = useRef(newKnockdown());
  const liftRef = useRef({ lift0: 0, t: 0, on: false });
  const lyingPose: LyingPose | null = useMemo(() => measureLyingPose(scene, getUpClip), [scene, getUpClip]);

  return useMemo(() => {
    // alzata iniziale dal corpo a terra (bacino fisico vs bacino della clip)
    const armLift = (feetY: number) => {
      const ly = ragdoll.getLyingState();
      const l = liftRef.current;
      l.t = 0;
      l.on = true;
      l.lift0 = ly && lyingPose ? THREE.MathUtils.clamp(ly.pelvis.y - (feetY + lyingPose.pelvisY), 0, GETUP_LIFT_MAX) : 0;
    };
    return {
      clipName: GETUP_CLIP,
      lyingPose,
      isDown: () => kdRef.current.active,
      runtime: () => kdRef.current,
      // KO fisico (colpo forte). false se non c'e' il layer attivo: chi
      // chiama ripiega su una spinta (pulseHit).
      start(dirX: number, dirZ: number, speed: number, up = 0.3): boolean {
        if (kdRef.current.active) return false;
        if (!ragdoll.knockDown(new THREE.Vector3(dirX, up, dirZ).normalize(), speed)) return false;
        kdRef.current = { ...newKnockdown(), active: true };
        liftRef.current.on = false;
        return true;
      },
      // un passo a terra; quando e' finito, dove rialzarsi (null = non era
      // davvero a terra o manca la posa: riprende in piedi e basta)
      step(dt: number, feetY: number): KnockdownStep {
        if (!kdRef.current.active) return { done: true, place: null };
        const place = stepKnockdown(kdRef.current, dt, ragdoll, lyingPose);
        if (kdRef.current.active) return { done: false };
        if (place) armLift(feetY);
        return { done: true, place };
      },
      // rialzo dal corpo a terra senza KO (dopo la morte, giocatore)
      placeFromLying(feetY: number): GetUpPlace | null {
        const ly = ragdoll.getLyingState();
        if (!ly || !lyingPose || ly.pelvis.y - feetY >= 1.2) return null;
        armLift(feetY);
        return getUpPlacement(ly, lyingPose);
      },
      // interrompe tutto (personaggio parcheggiato/lontano)
      cancel() {
        if (kdRef.current.active) ragdoll.standUp();
        kdRef.current = newKnockdown();
        liftRef.current.on = false;
      },
      tick(dt: number) {
        const l = liftRef.current;
        if (!l.on) return;
        l.t += dt;
        if (l.t >= GETUP_LIFT_S) l.on = false;
      },
      lift(): number {
        const l = liftRef.current;
        if (!l.on || l.lift0 <= 0) return 0;
        const k = Math.max(0, 1 - l.t / GETUP_LIFT_S);
        return l.lift0 * k * k * (3 - 2 * k);
      },
      stopLift() {
        liftRef.current.on = false;
      },
    };
  }, [ragdoll, lyingPose]);
}

export type KnockdownController = ReturnType<typeof useKnockdown>;
