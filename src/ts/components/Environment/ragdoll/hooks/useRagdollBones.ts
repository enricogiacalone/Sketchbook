import { useCallback, useRef } from "react";
import * as THREE from "three";

export function useRagdollBones(modelRootRef: React.RefObject<THREE.Object3D | null>) {
  const bonesRef = useRef<Record<string, THREE.Bone> | null>(null);

  const resolveBones = useCallback((): Record<string, THREE.Bone> | null => {
    if (bonesRef.current) return bonesRef.current;
    const root = modelRootRef.current;
    if (!root) return null;
    const map: Record<string, THREE.Bone> = {};
    root.traverse((obj) => {
      if ((obj as THREE.Bone).isBone) map[obj.name] = obj as THREE.Bone;
    });
    bonesRef.current = map;
    return map;
  }, [modelRootRef]);

  return { resolveBones, bonesRef };
}
