import * as THREE from 'three';
import { mergeBufferGeometries as mergeGeometries } from 'three-stdlib';

// Un modello fatto di decine di mesh piccole (la pistola: ~43 pezzi) costa una draw call e un nodo da aggiornare per
// pezzo, per ogni personaggio. Qui i pezzi FERMI con lo stesso materiale diventano UNA mesh (le geometrie si
// portano nel frame della radice); i sottoalberi in `keep` (pezzi che si muovono: carrello, caricatore) restano
// nodi a se', ma anche i loro pezzi si fondono tra loro. Chiamare dopo aver clonato (le geometrie del clone sono
// condivise con l'originale: qui se ne creano di nuove, l'originale non si tocca).
export function mergeStaticMeshes(root: THREE.Object3D, keep: Array<string | THREE.Object3D | null | undefined> = []): void {
  // (prove A/B dalla console: window.__noMerge = true prima di entrare)
  if (typeof window !== 'undefined' && (window as unknown as { __noMerge?: boolean }).__noMerge) return;
  root.updateMatrixWorld(true);
  const keepNodes = new Set<THREE.Object3D>();
  const keepNames = keep.filter((k): k is string => typeof k === 'string');
  for (const k of keep) if (k && typeof k !== 'string') keepNodes.add(k);
  root.traverse((o) => {
    if (keepNames.includes(o.name)) keepNodes.add(o);
  });
  const ownerOf = (o: THREE.Object3D): THREE.Object3D => {
    for (let p: THREE.Object3D | null = o; p && p !== root; p = p.parent) if (keepNodes.has(p)) return p;
    return root;
  };
  // materiali "uguali" (stesso tipo, colori, parametri e texture, anche se sono oggetti diversi) si fondono insieme
  const matKey = (mat: THREE.Material) => {
    const m = mat as THREE.MeshStandardMaterial;
    return [m.type, m.color?.getHexString(), m.emissive?.getHexString(), m.emissiveIntensity, m.roughness, m.metalness, m.opacity, m.transparent, m.side, m.map?.uuid, m.vertexColors].join('|');
  };
  // mesh per (proprietario, materiale)
  const groups = new Map<THREE.Object3D, Map<string, THREE.Mesh[]>>();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || (m as THREE.SkinnedMesh).isSkinnedMesh || (m as THREE.InstancedMesh).isInstancedMesh || Array.isArray(m.material)) return;
    if (keepNodes.has(m)) return; // un nodo mobile che e' lui stesso una mesh: resta com'e'
    // sotto un osso (animato da un mixer) non si fonde mai
    for (let p: THREE.Object3D | null = m.parent; p && p !== root; p = p.parent) if ((p as THREE.Bone).isBone) return;
    const owner = ownerOf(m);
    let byMat = groups.get(owner);
    if (!byMat) groups.set(owner, (byMat = new Map()));
    const k = matKey(m.material);
    const list = byMat.get(k);
    if (list) list.push(m);
    else byMat.set(k, [m]);
  });
  const _inv = new THREE.Matrix4();
  for (const [owner, byMat] of groups) {
    _inv.copy(owner.matrixWorld).invert();
    for (const meshes of byMat.values()) {
      if (meshes.length < 2) continue;
      const material = meshes[0].material;
      const geos = meshes.map((m) => {
        const g = m.geometry.clone();
        g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(_inv, m.matrixWorld));
        return g;
      });
      // stessi attributi in tutte, tutte indicizzate o nessuna
      const names = ['position', 'normal', 'uv'].filter((n) => geos.every((g) => g.getAttribute(n)));
      for (const g of geos) for (const n of Object.keys(g.attributes)) if (!names.includes(n)) g.deleteAttribute(n);
      if (!geos.every((g) => !!g.index) && geos.some((g) => !!g.index)) for (let i = 0; i < geos.length; i++) geos[i] = geos[i].toNonIndexed();
      const merged = mergeGeometries(geos, false);
      for (const g of geos) g.dispose();
      if (!merged) continue;
      const first = meshes[0];
      const mesh = new THREE.Mesh(merged, material);
      mesh.name = 'merged';
      mesh.castShadow = meshes.some((m) => m.castShadow);
      mesh.receiveShadow = meshes.some((m) => m.receiveShadow);
      mesh.frustumCulled = first.frustumCulled;
      owner.add(mesh);
      for (const m of meshes) m.parent?.remove(m);
    }
  }
  root.updateMatrixWorld(true);
}
