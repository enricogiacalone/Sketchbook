import * as THREE from 'three';

// IK a due ossa (spalla-gomito-polso) analitico: porta il polso `hand` sul
// punto `target` (mondo) piegando `upper` e `lower`, col gomito nello stesso
// piano in cui era gia' (cosi' non si ribalta), e lascia alla mano
// l'orientamento che aveva nell'animazione. weight 0..1 = quanto seguire.
// Usato per la mano sinistra sull'astina del fucile: le pose Pistol_* del
// personaggio tengono le mani vicine, un fucile no.
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _t = new THREE.Vector3();
const _d = new THREE.Vector3();
const _bend = new THREE.Vector3();
const _e = new THREE.Vector3();
const _u = new THREE.Vector3();
const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _qw = new THREE.Quaternion();
const _qp = new THREE.Quaternion();
const _handW = new THREE.Quaternion();

function rotateWorld(bone: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3, weight: number) {
  _q.setFromUnitVectors(from, to);
  if (weight < 1) _q.slerp(_qp.identity(), 1 - weight);
  bone.getWorldQuaternion(_qw);
  _qw.premultiply(_q);
  bone.parent!.getWorldQuaternion(_qp);
  bone.quaternion.copy(_qp.invert().multiply(_qw));
  bone.updateMatrixWorld(true);
}

export function solveTwoBoneIK(upper: THREE.Object3D, lower: THREE.Object3D, hand: THREE.Object3D, target: THREE.Vector3, weight = 1) {
  if (!upper.parent || !lower.parent || !hand.parent || weight <= 0) return;
  upper.updateWorldMatrix(true, true);
  hand.getWorldQuaternion(_handW);
  upper.getWorldPosition(_a);
  lower.getWorldPosition(_b);
  hand.getWorldPosition(_c);
  const la = _a.distanceTo(_b), lb = _b.distanceTo(_c);
  _d.subVectors(target, _a);
  const dist = THREE.MathUtils.clamp(_d.length(), Math.abs(la - lb) + 1e-3, la + lb - 1e-3);
  _d.normalize();
  _t.copy(_a).addScaledVector(_d, dist);
  // direzione di piega: il gomito attuale, tolta la componente lungo _d
  _bend.subVectors(_b, _a);
  _bend.addScaledVector(_d, -_bend.dot(_d));
  if (_bend.lengthSq() < 1e-8) _bend.set(0, -1, 0).addScaledVector(_d, -_d.y);
  _bend.normalize();
  const cosA = THREE.MathUtils.clamp((la * la + dist * dist - lb * lb) / (2 * la * dist), -1, 1);
  const sinA = Math.sqrt(1 - cosA * cosA);
  _e.copy(_a).addScaledVector(_d, la * cosA).addScaledVector(_bend, la * sinA);
  // spalla: il gomito va in _e
  rotateWorld(upper, _u.subVectors(_b, _a).normalize(), _v.subVectors(_e, _a).normalize(), weight);
  // gomito: il polso va sul bersaglio
  lower.getWorldPosition(_b);
  hand.getWorldPosition(_c);
  rotateWorld(lower, _u.subVectors(_c, _b).normalize(), _v.subVectors(_t, _b).normalize(), weight);
  // la mano tiene l'orientamento dell'animazione
  hand.parent.getWorldQuaternion(_qp);
  _qw.copy(_qp).invert().multiply(_handW);
  hand.quaternion.slerp(_qw, weight);
  hand.updateMatrixWorld(true);
}
