import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';

// "qui la macchina si guidava molto meglio" (github.com/swift502/Sketchbook)
// -- il veicolo a raggi dell'originale, RIGA PER RIGA: cannon.js
// RaycastVehicle (la copia inclusa in Sketchbook, src/lib/cannon/cannon.js)
// fatto girare su un corpo Rapier. Il DynamicRayCastVehicleController di
// Rapier deriva dallo stesso algoritmo (Bullet) ma non e' uguale: niente
// rollInfluence (il trucco che tiene l'auto dritta in curva), attrito
// laterale calcolato in un altro modo, centro di massa dove capita. Qui
// invece:
//  - sospensioni: molla+smorzatore per unita' di massa, come cannon;
//  - attrito laterale: impulso che toglie una frazione fissa della
//    velocita' laterale della ruota (contactDamping 0.2 a 60 Hz, riportato
//    al passo vero), cerchio d'attrito = forza della sospensione * frictionSlip;
//  - spinta laterale applicata all'altezza ridotta da rollInfluence;
//  - freno: blocca la ruota (attrito di rotolamento fino a "brake").
// Il centro di massa e l'inerzia del telaio li decide chi lo usa
// (Sketchbook: origine del modello, inerzia della scatola che contiene
// tutte le forme -- vedi Car.tsx).

export interface SketchbookWheelOptions {
  connectionLocal: THREE.Vector3; // punto d'attacco della sospensione (telaio)
  directionLocal: THREE.Vector3; // verso la ruota (giu')
  axleLocal: THREE.Vector3; // asse della ruota
  radius: number;
  suspensionRestLength: number;
  maxSuspensionTravel: number;
  suspensionStiffness: number; // 1/s^2 (moltiplicato per la massa del telaio)
  dampingCompression: number; // 1/s
  dampingRelaxation: number; // 1/s
  frictionSlip: number;
  rollInfluence: number;
  maxSuspensionForce?: number;
}

interface Wheel extends SketchbookWheelOptions {
  steering: number;
  rotation: number;
  deltaRotation: number;
  engineForce: number;
  brake: number;
  suspensionLength: number;
  suspensionForce: number;
  suspensionRelativeVelocity: number;
  clippedInvContactDotSuspension: number;
  isInContact: boolean;
  sliding: boolean;
  sideImpulse: number;
  forwardImpulse: number;
  skidInfo: number;
  // mondo
  connectionWorld: THREE.Vector3;
  directionWorld: THREE.Vector3;
  hitPoint: THREE.Vector3;
  hitNormal: THREE.Vector3;
  groundBody: RAPIER.RigidBody | null; // null = statico (o niente)
  hasGround: boolean;
  axle: THREE.Vector3;
  forward: THREE.Vector3;
}

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _qs = new THREE.Quaternion();
const _m3 = new THREE.Matrix3();
const _m3t = new THREE.Matrix3();
const _rotM = new THREE.Matrix4();
const _invI = new THREE.Matrix3();
const UP_LOCAL = new THREE.Vector3();

export class SketchbookRaycastVehicle {
  readonly wheels: Wheel[] = [];
  numWheelsOnGround = 0;
  sliding = false;
  // smorzamento laterale di cannon (0.2 per passo a 60 Hz)
  contactDamping60 = 0.2;
  // L'originale lancia i raggi delle ruote dalla posa INTERPOLATA per il
  // disegno (la sua copia di cannon usa interpolatedPosition/Quaternion in
  // pointToWorldFrame/vectorToWorldFrame): a 60 fps e' la posa di un passo
  // prima, 1/60 s. Fa parte di come guidava (a velocita' alta le spinte
  // delle ruote arrivano un po' "indietro"): si riproduce uguale.
  lagSeconds = 1 / 60;
  // massa "vista" dalle sospensioni (l'aereo dell'originale la abbassa con
  // la velocita': meno peso sulle ruote al decollo)
  suspensionMassScale = 1;
  private readonly hist: { p: THREE.Vector3; q: THREE.Quaternion }[] = [];
  private readonly lagPos = new THREE.Vector3();
  private readonly lagQuat = new THREE.Quaternion();

  private readonly com = new THREE.Vector3();
  private readonly lin = new THREE.Vector3();
  private readonly ang = new THREE.Vector3();
  private readonly quat = new THREE.Quaternion();
  private invMass = 0;
  private ray: RAPIER.Ray | null = null;

  constructor(
    private readonly world: RAPIER.World,
    private readonly rapier: typeof RAPIER,
    readonly chassis: RAPIER.RigidBody,
    // inerzia principale del telaio nel SUO sistema (diagonale): serve per
    // l'attrito di rotolamento (freno), come in cannon
    private readonly inertiaLocal: THREE.Vector3
  ) {}

  addWheel(o: SketchbookWheelOptions): number {
    this.wheels.push({
      ...o,
      connectionLocal: o.connectionLocal.clone(),
      directionLocal: o.directionLocal.clone().normalize(),
      axleLocal: o.axleLocal.clone().normalize(),
      maxSuspensionForce: o.maxSuspensionForce ?? Number.MAX_VALUE,
      steering: 0,
      rotation: 0,
      deltaRotation: 0,
      engineForce: 0,
      brake: 0,
      suspensionLength: o.suspensionRestLength,
      suspensionForce: 0,
      suspensionRelativeVelocity: 0,
      clippedInvContactDotSuspension: 1,
      isInContact: false,
      sliding: false,
      sideImpulse: 0,
      forwardImpulse: 0,
      skidInfo: 1,
      connectionWorld: new THREE.Vector3(),
      directionWorld: new THREE.Vector3(),
      hitPoint: new THREE.Vector3(),
      hitNormal: new THREE.Vector3(),
      groundBody: null,
      hasGround: false,
      axle: new THREE.Vector3(),
      forward: new THREE.Vector3(),
    });
    return this.wheels.length - 1;
  }

  numWheels() {
    return this.wheels.length;
  }
  setWheelEngineForce(i: number, f: number) {
    this.wheels[i].engineForce = f;
  }
  setWheelBrake(i: number, b: number) {
    this.wheels[i].brake = b;
  }
  setWheelSteering(i: number, a: number) {
    this.wheels[i].steering = a;
  }
  wheelSteering(i: number) {
    return this.wheels[i].steering;
  }
  wheelRotation(i: number) {
    return this.wheels[i].rotation;
  }
  wheelSuspensionLength(i: number) {
    return this.wheels[i].suspensionLength;
  }
  wheelIsInContact(i: number) {
    return this.wheels[i].isInContact;
  }

  // --- stato del telaio (letto e aggiornato a ogni impulso, come cannon)
  private readChassis() {
    const b = this.chassis;
    const c = b.worldCom();
    this.com.set(c.x, c.y, c.z);
    const r = b.rotation();
    this.quat.set(r.x, r.y, r.z, r.w);
    const m = b.mass();
    this.invMass = m > 0 ? 1 / m : 0;
    this.readVel();
    // inerzia inversa nel mondo: R diag(1/I) R^T
    _rotM.makeRotationFromQuaternion(this.quat);
    _m3.setFromMatrix4(_rotM);
    _m3t.copy(_m3).transpose();
    const I = this.inertiaLocal;
    _invI.set(I.x > 0 ? 1 / I.x : 0, 0, 0, 0, I.y > 0 ? 1 / I.y : 0, 0, 0, 0, I.z > 0 ? 1 / I.z : 0);
    _invI.premultiply(_m3).multiply(_m3t);
  }
  private readVel() {
    const v = this.chassis.linvel();
    const w = this.chassis.angvel();
    this.lin.set(v.x, v.y, v.z);
    this.ang.set(w.x, w.y, w.z);
  }
  private velAt(p: THREE.Vector3, out: THREE.Vector3) {
    out.subVectors(p, this.com);
    return out.crossVectors(this.ang, out).add(this.lin);
  }
  private impulse(imp: THREE.Vector3, point: THREE.Vector3) {
    if (imp.x === 0 && imp.y === 0 && imp.z === 0) return;
    this.chassis.applyImpulseAtPoint({ x: imp.x, y: imp.y, z: imp.z }, { x: point.x, y: point.y, z: point.z }, true);
    this.readVel();
  }
  private groundVelAt(w: Wheel, p: THREE.Vector3, out: THREE.Vector3) {
    const g = w.groundBody;
    if (!g) return out.set(0, 0, 0);
    const v = g.linvel(),
      a = g.angvel(),
      c = g.worldCom();
    out.set(p.x - c.x, p.y - c.y, p.z - c.z);
    _v4.set(a.x, a.y, a.z);
    return out.crossVectors(_v4, out).add(_v3.set(v.x, v.y, v.z));
  }

  updateVehicle(dt: number, filterFlags?: number, filterGroups?: number) {
    this.readChassis();
    {
      const t = this.chassis.translation();
      const steps = Math.max(0, Math.round(this.lagSeconds / dt));
      const h = this.hist;
      // teletrasportato (reset, rientro in pista...): la posa vecchia non
      // vale piu' -- i raggi partirebbero da dove era prima
      const last = h[h.length - 1];
      if (last && (last.p.distanceToSquared(_v1.set(t.x, t.y, t.z)) > 4 || Math.abs(last.q.dot(this.quat)) < 0.95)) h.length = 0;
      const cur = h.length > steps ? h.shift()! : { p: new THREE.Vector3(), q: new THREE.Quaternion() };
      cur.p.set(t.x, t.y, t.z);
      cur.q.copy(this.quat);
      h.push(cur);
      const old = h[0];
      this.lagPos.copy(old.p);
      this.lagQuat.copy(old.q);
    }
    const wheels = this.wheels;

    // sospensioni: raggi
    for (const w of wheels) this.castRay(w, filterFlags, filterGroups);

    // sospensioni: forze (cannon updateSuspension)
    const mass = (this.invMass > 0 ? 1 / this.invMass : 0) * this.suspensionMassScale;
    for (const w of wheels) {
      if (w.isInContact) {
        let force = w.suspensionStiffness * (w.suspensionRestLength - w.suspensionLength) * w.clippedInvContactDotSuspension;
        const rv = w.suspensionRelativeVelocity;
        force -= (rv < 0 ? w.dampingCompression : w.dampingRelaxation) * rv;
        w.suspensionForce = Math.max(0, force * mass);
      } else {
        w.suspensionForce = 0;
      }
    }
    for (const w of wheels) {
      if (!w.isInContact || w.suspensionForce <= 0) continue;
      const f = Math.min(w.suspensionForce, w.maxSuspensionForce!);
      this.impulse(_v1.copy(w.hitNormal).multiplyScalar(f * dt), w.hitPoint);
    }

    this.updateFriction(dt);

    // rotazione delle ruote (solo grafica)
    for (const w of wheels) {
      this.velAt(w.connectionWorld, _v1);
      if (w.isInContact) {
        _v2.set(0, 0, 1).applyQuaternion(this.quat);
        const proj = _v2.dot(w.hitNormal);
        _v2.addScaledVector(w.hitNormal, -proj);
        // (cannon: "hack" m = -1 con l'asse su = y)
        w.deltaRotation = (-_v2.dot(_v1) * dt) / w.radius;
      }
      if (Math.abs(w.brake) > Math.abs(w.engineForce)) w.deltaRotation = 0;
      w.rotation += w.deltaRotation;
      w.deltaRotation *= 0.99;
    }
  }

  private castRay(w: Wheel, filterFlags?: number, filterGroups?: number) {
    w.isInContact = false;
    w.hasGround = false;
    w.groundBody = null;
    // (posa "in ritardo", vedi lagSeconds)
    w.connectionWorld.copy(w.connectionLocal).applyQuaternion(this.lagQuat).add(this.lagPos);
    w.directionWorld.copy(w.directionLocal).applyQuaternion(this.lagQuat);

    const rayLen = w.suspensionRestLength + w.radius;
    const ray = (this.ray ??= new this.rapier.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 }));
    ray.origin = { x: w.connectionWorld.x, y: w.connectionWorld.y, z: w.connectionWorld.z };
    ray.dir = { x: w.directionWorld.x, y: w.directionWorld.y, z: w.directionWorld.z };
    const hit = this.world.castRayAndGetNormal(ray, rayLen, true, filterFlags, filterGroups, undefined, this.chassis);
    if (!hit) {
      w.suspensionLength = w.suspensionRestLength;
      w.suspensionRelativeVelocity = 0;
      w.hitNormal.copy(w.directionWorld).negate();
      w.clippedInvContactDotSuspension = 1;
      return;
    }
    const dist = (hit as any).timeOfImpact ?? (hit as any).toi;
    w.hitPoint.copy(w.directionWorld).multiplyScalar(dist).add(w.connectionWorld);
    w.hitNormal.set(hit.normal.x, hit.normal.y, hit.normal.z);
    w.isInContact = true;
    w.hasGround = true;
    const body = hit.collider.parent();
    w.groundBody = body && body.isDynamic() ? body : null;

    w.suspensionLength = dist - w.radius;
    const minL = w.suspensionRestLength - w.maxSuspensionTravel;
    const maxL = w.suspensionRestLength + w.maxSuspensionTravel;
    if (w.suspensionLength < minL) w.suspensionLength = minL;
    if (w.suspensionLength > maxL) w.suspensionLength = maxL;

    const denominator = w.hitNormal.dot(w.directionWorld);
    this.velAt(w.hitPoint, _v1);
    const projVel = w.hitNormal.dot(_v1);
    if (denominator >= -0.1) {
      w.suspensionRelativeVelocity = 0;
      w.clippedInvContactDotSuspension = 1 / 0.1;
    } else {
      const inv = -1 / denominator;
      w.suspensionRelativeVelocity = projVel * inv;
      w.clippedInvContactDotSuspension = inv;
    }
  }

  // denominatore d'impulso del telaio in un punto lungo una direzione
  private impulseDenominator(pos: THREE.Vector3, n: THREE.Vector3) {
    _v2.subVectors(pos, this.com);
    _v3.crossVectors(_v2, n).applyMatrix3(_invI);
    _v4.crossVectors(_v3, _v2);
    return this.invMass + n.dot(_v4);
  }

  private updateFriction(dt: number) {
    const wheels = this.wheels;
    this.numWheelsOnGround = 0;
    for (const w of wheels) {
      if (w.hasGround) this.numWheelsOnGround++;
      w.sideImpulse = 0;
      w.forwardImpulse = 0;
    }
    // frazione di velocita' laterale tolta per passo, riportata al passo vero
    const damping = 1 - Math.pow(1 - this.contactDamping60, dt * 60);

    for (const w of wheels) {
      if (!w.hasGround) continue;
      // asse della ruota nel mondo (con lo sterzo), proiettato sul suolo
      _qs.setFromAxisAngle(UP_LOCAL.copy(w.directionLocal).negate(), w.steering);
      _q.copy(this.quat).multiply(_qs);
      w.axle.set(1, 0, 0).applyQuaternion(_q);
      const proj = w.axle.dot(w.hitNormal);
      w.axle.addScaledVector(w.hitNormal, -proj).normalize();
      w.forward.crossVectors(w.hitNormal, w.axle).normalize();

      // resolveSingleBilateral (cannon)
      this.velAt(w.hitPoint, _v1);
      this.groundVelAt(w, w.hitPoint, _v2);
      _v1.sub(_v2);
      const relVel = w.axle.dot(_v1);
      const gInvMass = w.groundBody ? 1 / Math.max(1e-6, w.groundBody.mass()) : 0;
      const massTerm = 1 / (this.invMass + gInvMass);
      w.sideImpulse = -damping * relVel * massTerm;
    }

    this.sliding = false;
    for (const w of wheels) {
      w.skidInfo = 1;
      if (!w.hasGround) continue;
      // calcRollingFriction: fino a "brake" (0 = ruota libera)
      const maxImpulse = w.brake ? w.brake : 0;
      let rolling = 0;
      if (maxImpulse > 0) {
        this.velAt(w.hitPoint, _v1);
        this.groundVelAt(w, w.hitPoint, _v2);
        _v1.sub(_v2);
        const vrel = w.forward.dot(_v1);
        const denom = this.impulseDenominator(w.hitPoint, w.forward);
        rolling = THREE.MathUtils.clamp(-vrel / denom, -maxImpulse, maxImpulse);
      }
      rolling += w.engineForce * dt;
      w.forwardImpulse = rolling;

      const maximp = w.suspensionForce * dt * w.frictionSlip;
      const impulseSquared = w.forwardImpulse * w.forwardImpulse + w.sideImpulse * w.sideImpulse;
      w.sliding = false;
      if (impulseSquared > maximp * maximp) {
        this.sliding = true;
        w.sliding = true;
        w.skidInfo = maximp / Math.sqrt(impulseSquared);
      }
    }
    if (this.sliding) {
      for (const w of wheels) {
        if (w.sideImpulse !== 0 && w.skidInfo < 1) {
          w.forwardImpulse *= w.skidInfo;
          w.sideImpulse *= w.skidInfo;
        }
      }
    }

    // impulsi
    for (const w of wheels) {
      if (!w.hasGround) continue;
      if (w.forwardImpulse !== 0) this.impulse(_v1.copy(w.forward).multiplyScalar(w.forwardImpulse), w.hitPoint);
      if (w.sideImpulse !== 0) {
        // punto d'applicazione abbassato verso il baricentro (rollInfluence):
        // 1 = sul punto di contatto (si ribalta facile), 0 = alla quota del
        // baricentro (non si ribalta)
        _v2.subVectors(w.hitPoint, this.com);
        _q.copy(this.quat).invert();
        _v2.applyQuaternion(_q);
        _v2.y *= w.rollInfluence;
        _v2.applyQuaternion(this.lagQuat).add(this.com);
        const imp = _v1.copy(w.axle).multiplyScalar(w.sideImpulse);
        const pt = _v4.copy(_v2);
        this.impulse(imp, pt);
        if (w.groundBody) {
          w.groundBody.applyImpulseAtPoint(
            { x: -imp.x, y: -imp.y, z: -imp.z },
            { x: w.hitPoint.x, y: w.hitPoint.y, z: w.hitPoint.z },
            true
          );
        }
      }
    }
  }
}
