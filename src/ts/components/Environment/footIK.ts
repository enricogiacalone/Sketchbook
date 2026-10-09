import * as THREE from 'three';
import type { World } from '@dimforge/rapier3d-compat';
import { groundUnder } from './traversal/traversalWorld';
import { stepAt } from './stairSteps';

// "piedi che si adattano al terreno (foot IK), cosi' non scivolano": dopo
// l'animazione, ogni piede
// - poggia sul terreno vero che ha sotto (un raggio: gradino, marciapiede,
//   scala, blocco), non sul piano unico del personaggio: il bacino scende
//   quanto serve al piede piu' basso e la gamba dell'altro si piega (IK a
//   due ossa, ginocchio nel suo piano);
// - si inclina come il terreno quando appoggia;
// - quando appoggia resta fermo dov'e' nel mondo (blocco del piede): se
//   il corpo va piu' veloce o piu' piano di quello che la clip del passo
//   si aspetta (partenze, frenate, svolte, curve) il piede non striscia;
//   si stacca quando la clip lo alza o quando la gamba si allungherebbe
//   troppo (allora fa il passo).

export const footIKConfig = {
  maxOffset: 0.45, // m: dislivello massimo che le gambe recuperano
  pelvisBelowAvg: 0.12, // m: il bacino al massimo cosi' sotto la media dei due piedi
  maxPelvisDrop: 0.3, // m
  ease: 14, // 1/s: quanto in fretta si adattano quote e bacino
  plantH: 0.035, // m sopra la caviglia a riposo: sotto, il piede appoggia
  lockStretch: 0.22, // m: oltre, il piede bloccato si stacca (fa il passo)
  releaseS: 0.12, // s per tornare alla posa animata dopo lo stacco
  lockInS: 0.06, // s per arrivare sul punto d'appoggio
  settleDist: 0.08, // m: fermi, oltre questa distanza dal riposo il piede fa un passo
  stepLift: 0.1, // m: altezza dell'arco di un piede che si stacca
  swingLook: 0.14, // m: quanto avanti guarda il piede in volo sulle scale
  fade: 8, // 1/s: accensione/spegnimento di tutto l'IK
};

interface Leg {
  thigh: THREE.Object3D;
  calf: THREE.Object3D;
  foot: THREE.Object3D;
  ball: THREE.Object3D;
  offset: number; // quota del terreno sotto il piede meno quella del personaggio
  n: THREE.Vector3; // normale del terreno sotto il piede
  locked: boolean;
  stepping: boolean; // fermi, sta tornando sotto il corpo (non si ri-blocca a meta')
  lockW: number;
  lock: THREE.Vector3;
}

export interface FootIKState {
  legs: Leg[] | null;
  pelvis: THREE.Object3D | null;
  pelvisOff: number;
  restAnkle: number; // altezza della caviglia sopra i piedi quando appoggia
  w: number; // peso globale (0 = spento)
  debug: { offsets: number[]; pelvis: number; locked: boolean[]; ground: number[]; step: (number | null)[] };
}

export const newFootIK = (): FootIKState => ({
  legs: null,
  pelvis: null,
  pelvisOff: 0,
  restAnkle: 0.1,
  w: 0,
  debug: { offsets: [0, 0], pelvis: 0, locked: [false, false], ground: [0, 0], step: [null, null] },
});

const _a = new THREE.Vector3();
const _t = new THREE.Vector3();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _qw = new THREE.Quaternion();
const _qp = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);
const _g = { y: 0, nx: 0, ny: 1, nz: 0 };
const _anim: THREE.Vector3[] = [new THREE.Vector3(), new THREE.Vector3()];
const _poles: THREE.Vector3[] = [new THREE.Vector3(), new THREE.Vector3()];
const _final: THREE.Vector3[] = [new THREE.Vector3(), new THREE.Vector3()];
const _b = new THREE.Vector3();

// IK della gamba (anca-ginocchio-caviglia) con la caviglia su `target` e il
// piede con l'orientamento dell'animazione. Il ginocchio resta nel piano in
// cui lo piega l'animazione quando e' piegato davvero; con la gamba quasi
// dritta quel piano non c'e' (o punta indietro/di lato) e il ginocchio
// girava in pose innaturali: li' va verso la punta del piede (`pole`).
const _H = new THREE.Vector3();
const _K = new THREE.Vector3();
const _A = new THREE.Vector3();
const _d = new THREE.Vector3();
const _T = new THREE.Vector3();
const _E = new THREE.Vector3();
const _bend = new THREE.Vector3();
const _pp = new THREE.Vector3();
const _u = new THREE.Vector3();
const _v = new THREE.Vector3();
const _rq = new THREE.Quaternion();
const _rw = new THREE.Quaternion();
const _rp = new THREE.Quaternion();
const _footW = new THREE.Quaternion();
function rotateWorld(bone: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3) {
  _rq.setFromUnitVectors(from, to);
  bone.getWorldQuaternion(_rw).premultiply(_rq);
  bone.parent!.getWorldQuaternion(_rp);
  bone.quaternion.copy(_rp.invert().multiply(_rw));
  bone.updateMatrixWorld(true);
}
function solveLeg(
  thigh: THREE.Object3D,
  calf: THREE.Object3D,
  foot: THREE.Object3D,
  target: THREE.Vector3,
  pole: THREE.Vector3,
  forcePole = false
) {
  if (!thigh.parent || !calf.parent || !foot.parent) return;
  thigh.updateWorldMatrix(true, true);
  foot.getWorldQuaternion(_footW);
  thigh.getWorldPosition(_H);
  calf.getWorldPosition(_K);
  foot.getWorldPosition(_A);
  const la = _H.distanceTo(_K);
  const lb = _K.distanceTo(_A);
  _d.subVectors(target, _H);
  const dist = THREE.MathUtils.clamp(_d.length(), Math.abs(la - lb) + 1e-3, la + lb - 1e-3);
  _d.normalize();
  _T.copy(_H).addScaledVector(_d, dist);
  // piano del ginocchio: quello dell'animazione se piegato in avanti, se no la punta del piede
  _pp.copy(pole).addScaledVector(_d, -pole.dot(_d));
  // bersaglio proprio nella direzione del polo (piede alzato davanti): il
  // ginocchio va in su (prima qui c'era l'asse z del mondo: a seconda di
  // dove si guardava, il ginocchio finiva all'indietro)
  if (_pp.lengthSq() < 1e-6) _pp.set(0, 1, 0).addScaledVector(_d, -_d.y);
  _pp.normalize();
  _bend.subVectors(_K, _H);
  _bend.addScaledVector(_d, -_bend.dot(_d));
  const bl = _bend.length();
  const sAnim = !forcePole && bl > 1e-6 && _bend.dot(_pp) > 0 ? THREE.MathUtils.clamp(bl / (0.25 * la), 0, 1) : 0;
  if (bl > 1e-6) _bend.divideScalar(bl);
  _bend
    .multiplyScalar(sAnim)
    .addScaledVector(_pp, 1 - sAnim)
    .normalize();
  const cosA = THREE.MathUtils.clamp((la * la + dist * dist - lb * lb) / (2 * la * dist), -1, 1);
  const sinA = Math.sqrt(1 - cosA * cosA);
  _E.copy(_H)
    .addScaledVector(_d, la * cosA)
    .addScaledVector(_bend, la * sinA);
  rotateWorld(thigh, _u.subVectors(_K, _H).normalize(), _v.subVectors(_E, _H).normalize());
  calf.getWorldPosition(_K);
  foot.getWorldPosition(_A);
  rotateWorld(calf, _u.subVectors(_A, _K).normalize(), _v.subVectors(_T, _K).normalize());
  foot.parent.getWorldQuaternion(_rp);
  foot.quaternion.copy(_rp.invert().multiply(_footW));
  foot.updateMatrixWorld(true);
}

// la tibia piega verso il polo (ginocchio al contrario)?
const _kn = new THREE.Vector3();
const _kf = new THREE.Vector3();
const _ks = new THREE.Vector3();
function kneeBackward(l: Leg, pole: THREE.Vector3) {
  l.thigh.getWorldPosition(_H);
  l.calf.getWorldPosition(_K);
  l.foot.getWorldPosition(_A);
  _kn.subVectors(_K, _H).normalize();
  _ks.subVectors(_A, _K).normalize();
  _ks.addScaledVector(_kn, -_ks.dot(_kn));
  return _ks.dot(pole) > 0.02 * pole.length();
}

// l'altro piede sta facendo un passo (staccato, non ancora riappoggiato)
function otherStepping(s: FootIKState, l: Leg) {
  return !!s.legs?.some((o) => o !== l && !o.locked && o.lockW > 0);
}

export function applyFootIK(
  s: FootIKState,
  root: THREE.Object3D,
  ctx: {
    world: World;
    rapier: any;
    feetY: number;
    baseY: number;
    active: boolean;
    dt: number;
    // passo accorciato (scale): sulle scale la camminata gira alla cadenza
    // normale ma il corpo avanza di una pedata a passo; i piedi animati si
    // avvicinano al corpo lungo l'avanti di quanto serve a restare fermi
    // quando appoggiano. root = punto a terra del personaggio.
    stride?: { scale: number; fwdX: number; fwdZ: number; rootX: number; rootZ: number };
    // avanti del corpo (a terra) e se ci si sta muovendo
    fwdX: number;
    fwdZ: number;
    moving: boolean;
  }
) {
  const cfg = footIKConfig;
  const dt = Math.min(ctx.dt, 0.1);
  s.w += ((ctx.active ? 1 : 0) - s.w) * Math.min(1, cfg.fade * dt);
  if (!ctx.active && s.w < 0.01) {
    s.w = 0;
    s.pelvisOff = 0;
    if (s.legs) for (const l of s.legs) ((l.locked = false), (l.lockW = 0), (l.offset = 0));
    return;
  }
  if (!s.legs) {
    const get = (n: string) => root.getObjectByName(n);
    const bones = ['thigh_l', 'calf_l', 'foot_l', 'ball_l', 'thigh_r', 'calf_r', 'foot_r', 'ball_r', 'pelvis'].map(get);
    if (bones.some((b) => !b)) return;
    const leg = (i: number): Leg => ({
      thigh: bones[i]!,
      calf: bones[i + 1]!,
      foot: bones[i + 2]!,
      ball: bones[i + 3]!,
      offset: 0,
      n: new THREE.Vector3(0, 1, 0),
      locked: false,
      stepping: false,
      lockW: 0,
      lock: new THREE.Vector3(),
    });
    s.legs = [leg(0), leg(4)];
    s.pelvis = bones[8]!;
  }
  const k = Math.min(1, cfg.ease * dt);
  root.updateWorldMatrix(true, true);

  // dove va ogni piede (posa animata, o il punto in cui e' bloccato) e il
  // terreno proprio li'
  let pelvisWant = 0;
  let offSum = 0;
  s.legs.forEach((l, i) => {
    l.foot.getWorldPosition(_anim[i]);
    const A = _anim[i];
    l.ball.getWorldPosition(_b);
    const st = ctx.stride;
    if (st && st.scale < 0.999) {
      const along = (A.x - st.rootX) * st.fwdX + (A.z - st.rootZ) * st.fwdZ;
      const sh = along * (1 - st.scale);
      A.x -= st.fwdX * sh;
      A.z -= st.fwdZ * sh;
      _b.x -= st.fwdX * sh;
      _b.z -= st.fwdZ * sh;
    }

    // ginocchio: avanti del corpo, girato verso la punta del piede solo se
    // la punta guarda avanti (piede girato in fuori). Col piede che si stacca
    // la punta scende e finisce DIETRO la caviglia: usarla (come prima)
    // mandava il ginocchio all'indietro. Un po' in su per i piedi alzati
    // davanti.
    const tl = Math.hypot(_b.x - A.x, _b.z - A.z) || 1;
    const tx = (_b.x - A.x) / tl;
    const tz = (_b.z - A.z) / tl;
    const toeW = Math.max(0, tx * ctx.fwdX + tz * ctx.fwdZ);
    _poles[i].set(ctx.fwdX + tx * toeW, 0.25, ctx.fwdZ + tz * toeW);
    // caviglia a riposo: il punto piu' basso che raggiunge (inviluppo lento)
    const h = A.y - ctx.feetY;
    if (h > 0) s.restAnkle = Math.min(s.restAnkle + 0.02 * dt, h);
    // blocco del piede
    const planted = h < s.restAnkle + cfg.plantH;
    if (l.stepping && l.lockW <= 0) l.stepping = false;
    if (planted && ctx.active && !l.stepping) {
      if (!l.locked && l.lockW <= 0) {
        l.locked = true;
        l.lock.set(A.x, 0, A.z);
        // sulle scale il piede appoggia al centro di una pedata (meta' piede
        // sul centro), non a cavallo dello spigolo
        const sh = stepAt((A.x + _b.x) / 2, (A.z + _b.z) / 2, ctx.feetY);
        if (sh) l.lock.x = sh.centerX - (_b.x - A.x) / 2;
      } else if (!l.locked) {
        // ri-appoggio mentre stava tornando: si ricomincia da dove e'
        l.locked = true;
        l.lock.set(THREE.MathUtils.lerp(A.x, l.lock.x, l.lockW), 0, THREE.MathUtils.lerp(A.z, l.lock.z, l.lockW));
      }
      if (Math.hypot(A.x - l.lock.x, A.z - l.lock.z) > cfg.lockStretch) l.locked = false;
      // fermi: un piede rimasto bloccato lontano da dove lo vuole il riposo
      // (o su un'altra pedata) fa un passo per tornare sotto il corpo, uno
      // alla volta. Prima restava li' finche' non si stirava la gamba: sulle
      // scale anche due gradini piu' in basso.
      else if (!ctx.moving && l.lockW >= 1 && !otherStepping(s, l)) {
        const far = Math.hypot(A.x - l.lock.x, A.z - l.lock.z) > cfg.settleDist;
        const sa = stepAt((A.x + _b.x) / 2, (A.z + _b.z) / 2, ctx.feetY);
        const topA = sa ? sa.top : null;
        const sl = stepAt(l.lock.x + (_b.x - A.x) / 2, l.lock.z + (_b.z - A.z) / 2, ctx.feetY);
        const otherTread = topA !== null && sl !== null && Math.abs(sl.top - topA) > 0.05;
        if (far || otherTread) {
          l.locked = false;
          l.stepping = true;
        }
      }
    } else l.locked = false;
    // il blocco entra in fretta (il piede scivola sul centro della pedata in
    // un attimo invece di saltarci) ed esce piano
    l.lockW = l.locked ? Math.min(1, l.lockW + dt / cfg.lockInS) : Math.max(0, l.lockW - dt / cfg.releaseS);
    const lw = l.lockW * s.w;
    // un piede che si stacca fa un piccolo arco, non striscia
    const lift = !l.locked && l.lockW > 0 ? cfg.stepLift * Math.sin(Math.PI * l.lockW) * s.w : 0;
    _final[i].set(THREE.MathUtils.lerp(A.x, l.lock.x, lw), A.y + lift, THREE.MathUtils.lerp(A.z, l.lock.z, lw));
    // il terreno si cerca a meta' piede (tra caviglia e avampiede), dove il
    // piede sta davvero
    const mx = _final[i].x + (_b.x - A.x) / 2;
    const mz = _final[i].z + (_b.z - A.z) / 2;
    groundUnder(ctx.world, ctx.rapier, mx, mz, ctx.feetY + 0.5, ctx.baseY, _g);
    // sulle scale si cammina su una rampa liscia: il piede va sul gradino vero
    const sh = stepAt(mx, mz, _g.y);
    let step = sh ? sh.top : null;
    // piede in volo: guarda anche un po' avanti, cosi' si alza prima dello
    // spigolo del gradino dopo invece di sbatterci la punta
    if (!planted && step !== null) {
      const fl = Math.hypot(_b.x - A.x, _b.z - A.z) || 1;
      const ax = mx + ((_b.x - A.x) / fl) * cfg.swingLook;
      const az = mz + ((_b.z - A.z) / fl) * cfg.swingLook;
      const ahead = stepAt(ax, az, _g.y);
      if (ahead && ahead.top > step) step = ahead.top;
    }
    s.debug.ground[i] = _g.y;
    s.debug.step[i] = step;
    if (step !== null) {
      _g.y = step;
      _g.nx = 0;
      _g.ny = 1;
      _g.nz = 0;
    }
    const want = THREE.MathUtils.clamp(_g.y - ctx.feetY, -cfg.maxOffset, cfg.maxOffset);
    l.offset += (want - l.offset) * k;
    l.n.set(_g.nx, _g.ny, _g.nz);
    pelvisWant = Math.min(pelvisWant, l.offset);
    offSum += l.offset;
  });
  // il bacino scende per il piede piu' basso, ma non oltre la media dei due
  // meno PELVIS_BELOW_AVG: sulle scale ripide (passo della camminata su due
  // o tre gradini) scendere tutto accucciava l'altra gamba col ginocchio
  // al petto; cosi' la gamba dietro finisce di spingere in punta di piede
  pelvisWant = Math.max(pelvisWant, offSum / 2 - cfg.pelvisBelowAvg, -cfg.maxPelvisDrop);
  s.pelvisOff += (pelvisWant - s.pelvisOff) * k;

  // bacino giu' (solo giu': su una gamba piu' corta non si stira l'altra)
  const pel = s.pelvis!;
  if (Math.abs(s.pelvisOff * s.w) > 1e-4 && pel.parent) {
    pel.getWorldPosition(_p);
    _p.y += s.pelvisOff * s.w;
    pel.position.copy(pel.parent.worldToLocal(_p));
    pel.updateMatrixWorld(true);
  }

  s.legs.forEach((l, i) => {
    const A = _anim[i];
    const h = A.y - ctx.feetY;
    _t.set(_final[i].x, _final[i].y + l.offset * s.w, _final[i].z);
    l.foot.getWorldPosition(_a);
    if (_a.distanceToSquared(_t) > 1e-6) {
      solveLeg(l.thigh, l.calf, l.foot, _t, _poles[i]);
      // mai il ginocchio al contrario: se la tibia piega in avanti rispetto
      // alla coscia (verso il polo), si rifa' col solo polo
      _kf.set(ctx.fwdX, 0.25, ctx.fwdZ);
      if (kneeBackward(l, _kf)) solveLeg(l.thigh, l.calf, l.foot, _t, _kf, true);
    }
    // piede inclinato come il terreno quando appoggia
    const tilt = s.w * (1 - THREE.MathUtils.clamp((h - s.restAnkle) / 0.08, 0, 1));
    if (tilt > 0.01 && l.n.y < 0.9995 && l.foot.parent) {
      _q.setFromUnitVectors(_up, l.n);
      _q.slerp(_qp.identity(), 1 - tilt);
      l.foot.getWorldQuaternion(_qw).premultiply(_q);
      l.foot.parent.getWorldQuaternion(_qp);
      l.foot.quaternion.copy(_qp.invert().multiply(_qw));
      l.foot.updateMatrixWorld(true);
    }
    s.debug.offsets[i] = l.offset;
    s.debug.locked[i] = l.locked;
  });
  s.debug.pelvis = s.pelvisOff;
}
