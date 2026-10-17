import RAPIER from '@dimforge/rapier3d-compat';

// Togliere due volte lo stesso corpo (o un collider) dal mondo Rapier non e'
// un errore in JS: il codice WASM va in panico ("unreachable") e da li' ogni
// passo di fisica fallisce ("recursive use of an object"). Smontando e
// rimontando i mondi dei pianeti capita (i cleanup di hook che creano corpi a
// mano, come quelli dei ragdoll, girano dopo che il corpo e' gia' sparito):
// qui removeRigidBody / removeCollider ignorano cio' che non c'e' piu'.
const proto = RAPIER.World.prototype as any;
if (!proto.__guarded) {
  proto.__guarded = true;
  const removeBody = proto.removeRigidBody;
  proto.removeRigidBody = function (body: { handle: number } | null) {
    try {
      if (!body || !this.getRigidBody(body.handle)) return;
    } catch {
      return;
    }
    return removeBody.call(this, body);
  };
  const removeCollider = proto.removeCollider;
  proto.removeCollider = function (collider: { handle: number } | null, wake: boolean) {
    try {
      if (!collider || !this.getCollider(collider.handle)) return;
    } catch {
      return;
    }
    return removeCollider.call(this, collider, wake);
  };
}
