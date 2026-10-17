import { useCallback, useRef } from "react";
import * as THREE from "three";

export function useRagdollBones(modelRootRef: React.RefObject<THREE.Object3D | null>) {
  const bonesRef = useRef<Record<string, THREE.Bone> | null>(null);
  // di quale modello sono le ossa in cache: se il modello cambia (un clone rifatto
  // da React dopo una sospensione, un cambio di colore) le ossa vecchie non valgono
  // piu' -- prima restavano quelle del clone scartato (fermo all'origine, in posa a T)
  // e i collider del corpo solido si fermavano la'
  const rootOfCache = useRef<THREE.Object3D | null>(null);

  const resolveBones = useCallback((): Record<string, THREE.Bone> | null => {
    const root = modelRootRef.current;
    if (bonesRef.current && rootOfCache.current === root) return bonesRef.current;
    if (!root) return null;
    const map: Record<string, THREE.Bone> = {};
    root.traverse((obj) => {
      if ((obj as THREE.Bone).isBone) map[obj.name] = obj as THREE.Bone;
    });
    bonesRef.current = map;
    rootOfCache.current = root;
    return map;
  }, [modelRootRef]);

  return { resolveBones, bonesRef };
}
