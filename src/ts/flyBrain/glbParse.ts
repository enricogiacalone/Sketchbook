// Parser GLB minimale (browser, Web Worker e Node: niente DOM/texture,
// input = ArrayBuffer): ricostruisce la
// gerarchia dei nodi, lo scheletro (SkinnedMesh vuota con le inverseBind
// della skin, cosi' skeleton.pose() da' la vera posa di bind come nel
// gioco) e le clip di animazione come THREE.AnimationClip.
import * as THREE from 'three';

interface Glb { json: any; bin: DataView }

export function readGlb(buf: ArrayBuffer): Glb {
  const dv = new DataView(buf);
  let off = 12;
  let json: any = null;
  let bin: DataView | null = null;
  while (off < buf.byteLength) {
    const len = dv.getUint32(off, true);
    const type = dv.getUint32(off + 4, true);
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, off + 8, len)));
    else if (type === 0x004e4942) bin = new DataView(buf, off + 8, len);
    off += 8 + len;
  }
  return { json, bin: bin as DataView };
}

function accessor(g: Glb, idx: number): Float32Array {
  const a = g.json.accessors[idx];
  const bv = g.json.bufferViews[a.bufferView];
  const comps = ({ SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 } as Record<string, number>)[a.type];
  const start = (bv.byteOffset || 0) + (a.byteOffset || 0);
  if (a.componentType !== 5126) throw new Error('solo float32, trovato ' + a.componentType);
  const stride = bv.byteStride || comps * 4;
  const out = new Float32Array(a.count * comps);
  for (let i = 0; i < a.count; i++) for (let c = 0; c < comps; c++) out[i * comps + c] = g.bin.getFloat32(start + i * stride + c * 4, true);
  return out;
}

export interface LoadedModel {
  root: THREE.Object3D;
  bones: Record<string, THREE.Bone>;
  skeleton: THREE.Skeleton;
}

// Modello con skin (soldier-citizen.glb)
export function parseSkinnedModel(buf: ArrayBuffer): LoadedModel {
  const g = readGlb(buf);
  const skin = g.json.skins[0];
  const jointSet = new Set<number>(skin.joints);
  const objs: THREE.Object3D[] = g.json.nodes.map((n: any, i: number) => {
    const o = jointSet.has(i) ? new THREE.Bone() : new THREE.Object3D();
    o.name = n.name || '';
    if (n.translation) o.position.fromArray(n.translation);
    if (n.rotation) o.quaternion.fromArray(n.rotation);
    if (n.scale) o.scale.fromArray(n.scale);
    if (n.matrix) new THREE.Matrix4().fromArray(n.matrix).decompose(o.position, o.quaternion, o.scale);
    return o;
  });
  g.json.nodes.forEach((n: any, i: number) => (n.children || []).forEach((c: number) => objs[i].add(objs[c])));
  const root = new THREE.Object3D();
  root.name = 'fly-model-root';
  for (const i of g.json.scenes[g.json.scene || 0].nodes) root.add(objs[i]);
  const ibm = accessor(g, skin.inverseBindMatrices);
  const bonesArr = skin.joints.map((j: number) => objs[j] as THREE.Bone);
  const inverses = skin.joints.map((_: number, k: number) => new THREE.Matrix4().fromArray(ibm, k * 16));
  const skeleton = new THREE.Skeleton(bonesArr, inverses);
  const mesh = new THREE.SkinnedMesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial());
  // bindMatrix esplicita: senza, bind() ricalcola le inverse dalle ossa
  // (ancora non aggiornate) e butta via quelle della skin
  mesh.bind(skeleton, new THREE.Matrix4());
  root.add(mesh);
  root.updateMatrixWorld(true);
  const bones: Record<string, THREE.Bone> = {};
  for (const b of bonesArr) bones[b.name] = b;
  return { root, bones, skeleton };
}

// Clip di animazione (tracce per nome dell'osso, come nel gioco)
export function parseClips(buf: ArrayBuffer): THREE.AnimationClip[] {
  const g = readGlb(buf);
  return (g.json.animations || []).map((an: any) => {
    const tracks: THREE.KeyframeTrack[] = [];
    for (const ch of an.channels) {
      const s = an.samplers[ch.sampler];
      const node = g.json.nodes[ch.target.node].name;
      const times = accessor(g, s.input);
      const vals = accessor(g, s.output);
      const p = ch.target.path;
      if (p === 'translation') tracks.push(new THREE.VectorKeyframeTrack(node + '.position', times as any, vals as any));
      else if (p === 'rotation') tracks.push(new THREE.QuaternionKeyframeTrack(node + '.quaternion', times as any, vals as any));
      else if (p === 'scale') tracks.push(new THREE.VectorKeyframeTrack(node + '.scale', times as any, vals as any));
    }
    return new THREE.AnimationClip(an.name, -1, tracks);
  });
}
