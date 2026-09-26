import { useCallback, useEffect, useRef } from "react";
import * as THREE from "three";
import { interactionGroups, useBeforePhysicsStep, useFilterContactPair, useRapier } from "@react-three/rapier";
import type { ImpulseJoint, RigidBody as RapierRigidBody } from "@dimforge/rapier3d-compat";
import {
  ACTIVE_RAGDOLL_SEGMENTS,
  ACTIVE_RAGDOLL_MASS_WEIGHT,
  ACTIVE_RAGDOLL_MASS_WEIGHT_FALLBACK,
  ACTIVE_RAGDOLL_TOTAL_MASS_KG,
  ACTIVE_RAGDOLL_WEIGHT_IDLE,
  ACTIVE_RAGDOLL_WEIGHT_MOVING,
  ACTIVE_RAGDOLL_WEIGHT_SMOOTH_RATE,
  ACTIVE_RAGDOLL_JOINT_LIMITS_DEG,
  ACTIVE_RAGDOLL_JOINT_LIMIT_FALLBACK_DEG,
  ACTIVE_RAGDOLL_JOINT_FREQ,
  ACTIVE_RAGDOLL_JOINT_FREQ_DEFAULT,
  ACTIVE_RAGDOLL_PASSIVE_JOINT_FRICTION,
  ACTIVE_RAGDOLL_HIPS_POS_STIFFNESS,
  ACTIVE_RAGDOLL_HIPS_ROT_STIFFNESS,
  ACTIVE_RAGDOLL_HIT_RECOVERY_S,
  type RagdollSegment,
} from "../ragdollConfig";
import { groupsExcluding, CollisionGroups } from "../../../../enums/CollisionGroups";
import { useStore } from "../../../../store";
import { registerShootableCollider, unregisterShootableCollider } from "../../weapons/shootableRegistry";
import {
  captureBindPose,
  captureClipPose,
  jointAxisAngles,
  measureClipJointRanges,
  type BindPoseSnapshot,
  type JointRange,
} from "../activeRagdollFrames";

// ===========================================================================
// Ragdoll attivo ("stile Euphoria") -- riscritto da zero.
//
// Vedi il commento in cima ad activeRagdollFrames.ts per la causa radice
// del vecchio comportamento ("non corrisponde al personaggio, si muove
// tantissimo"). In breve, i bug misurati dal vivo erano tre:
//  1. lo zero dei giunti Rapier NON era la posa del personaggio (coscia
//     151 gradi fuori, avambraccio 108, braccio 120) -> limiti nativi e
//     cerniere trascinavano i corpi in pose assurde ogni frame;
//  2. i motori PD calcolavano l'errore nel frame LOCALE del genitore ma
//     applicavano la coppia come se fosse in coordinate MONDO -> la coppia
//     spingeva nella direzione sbagliata non appena il genitore non era
//     allineato al mondo (cioe' sempre);
//  3. la vista di debug disegnava le capsule centrate sul PERNO del giunto
//     e orientate sull'asse Y dell'osso, non dove sta davvero il collider.
//
// Architettura nuova:
//  - tutti i corpi costruiti nel frame del personaggio in T-pose (bind),
//    con un offset costante corpo->osso: lo zero di ogni giunto E' la
//    T-pose e gli assi hanno un significato anatomico fisso;
//  - giunti Rapier generici (3 rotazioni libere, traslazione bloccata)
//    con limiti per asse e MOTORI NATIVI di Rapier (molla/smorzatore
//    implicita, risolta dentro il solver: stabile a qualunque rigidita',
//    con reazione uguale e contraria sul genitore corretta per
//    costruzione) che inseguono gli angoli dell'animazione;
//  - bacino guidato in posizione/orientamento mondo da un servo di
//    velocita' (con feed-forward della velocita' dell'animazione) ad ogni
//    passo di fisica, oppure incollato all'animazione (banco "bacino
//    ancorato");
//  - colpo = impulso vero sul corpo colpito + indebolimento temporaneo dei
//    motori di quel segmento e dei vicini, che poi recuperano: il
//    personaggio incassa e torna in guardia da solo.
//  - passivo/KO = motori spenti (solo attrito nei giunti), gravita' piena,
//    limiti anatomici sempre attivi.
// ===========================================================================

const RAW_AXIS_ANG = [3, 4, 5] as const; // RawJointAxis AngX/AngY/AngZ
const LOCKED_LINEAR_AXES_MASK = 1 | 2 | 4; // JointAxesMask LinX|LinY|LinZ = assi BLOCCATI
const MOTOR_MODEL_FORCE_BASED = 1; // RawMotorModel.ForceBased (vedi ACTIVE_RAGDOLL_JOINT_FREQ)
const TARGET_LIMIT_MARGIN_RAD = THREE.MathUtils.degToRad(1);
// Feed-forward dei motori: tetto alto apposta -- un gancio muove le
// braccia ben oltre i 25 rad/s del primo tentativo, e un tetto basso fa
// si' che lo smorzamento del motore FRENI un movimento che l'animazione
// vuole veloce (misurato: errori da 50-60 gradi in cima alla catena).
const MAX_TARGET_JOINT_SPEED = 60; // rad/s
const RUNAWAY_DISTANCE_M = 1.5;

// Collisioni del ragdoll attivo. VIVO: nessuna -- misurato col gancio: la
// posa animata scende col bacino di 40 cm e ginocchia/piedi entrano di
// qualche cm nel terreno; il contatto col terreno spingeva le gambe
// contro i motori, il bacino si ribaltava (97 gradi, 47 cm) e il corpo
// crollava. Finche' e' vivo e' l'animazione a decidere dove stanno i
// piedi (i colpi arrivano come impulsi, vedi applyActiveHit). PASSIVO/KO:
// collide con il mondo (terreno, edifici, ...), come prima.
//
// "migliora la fisica della ragdoll -- compenetrazioni" (stile GTA ma non
// finto):
//  - VIVO: tocca comunque muri/casse/ostacoli (CollisionGroups.RagdollWorld,
//    non il pavimento): un braccio che si muove contro un muro si ferma
//    sul muro invece di attraversarlo;
//  - PASSIVO/KO: in piu' tocca gli ostacoli dell'arena, le capsule solide
//    degli ALTRI combattenti e il sacco (RagdollBody), gli altri ragdoll a
//    terra E SE STESSO (segmenti non vicini: braccio contro petto, gamba
//    contro gamba) -- prima passava attraverso tutto tranne il terreno.
const ALIVE_COLLISION_GROUPS = interactionGroups([CollisionGroups.Ragdoll], [CollisionGroups.RagdollWorld]);
const PASSIVE_COLLISION_GROUPS = groupsExcluding(CollisionGroups.Ragdoll, CollisionGroups.Characters);

// Auto-collisione da KO: coppie SEMPRE escluse = segmenti a 1-2 passi
// nell'albero (collegati da un giunto, fratelli, nonno-nipote): capsule
// corte e tozze della colonna, clavicole, attacchi di anche/spalle si
// sovrappongono per costruzione e si spingerebbero a vicenda. Eccezione:
// le due cosce (fratelle) -- ginocchia che si attraversano sono proprio
// la compenetrazione da evitare; le si lascia alla regola dinamica sotto.
// Coppie gia' compenetrate nell'istante in cui il corpo va KO (es. mano
// sul viso in guardia) restano escluse finche' non si separano di
// SELF_RELEASE_M: riattivarle subito le farebbe esplodere via.
const SELF_OVERLAP_M = 0.005;
const SELF_RELEASE_M = 0.02;
const SELF_ALWAYS_COLLIDE = new Set(["Thigh_L|Thigh_R", "Thigh_R|Thigh_L"]);
const SEGMENT_INDEX: Record<string, number> = {};
ACTIVE_RAGDOLL_SEGMENTS.forEach((seg, i) => { SEGMENT_INDEX[seg.name] = i; });
const pairKey = (a: number, b: number) => (a < b ? a * 64 + b : b * 64 + a);
const SELF_STATIC_EXCLUDED: Set<number> = (() => {
  const out = new Set<number>();
  const parentOf = (n: string) => ACTIVE_RAGDOLL_SEGMENTS.find((x) => x.name === n)?.parent ?? null;
  const segs = ACTIVE_RAGDOLL_SEGMENTS;
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const a = segs[i].name, b = segs[j].name;
      if (SELF_ALWAYS_COLLIDE.has(`${a}|${b}`)) continue;
      const pa = parentOf(a), pb = parentOf(b);
      const near =
        pa === b || pb === a || // giunto
        (pa !== null && pa === pb) || // fratelli
        (pa !== null && parentOf(pa) === b) || (pb !== null && parentOf(pb) === a); // nonno
      if (near) out.add(pairKey(i, j));
    }
  }
  return out;
})();
// CCD da KO: un avambraccio (r 5 cm) lanciato a 10+ m/s fa 8 cm per passo
// a 120 Hz -- abbastanza per attraversare uno spigolo o un altro corpo.
const PASSIVE_CCD = true;

const ALIVE_LINEAR_DAMPING = 0.2;
const ALIVE_ANGULAR_DAMPING = 1.0;
const PASSIVE_LINEAR_DAMPING = 0.4;
const PASSIVE_ANGULAR_DAMPING = 2.5;
const ALIVE_FRICTION = 0.5;
const PASSIVE_FRICTION = 1.2;

const ACTIVE_RAGDOLL_MASS_KG: Record<string, number> = {};
{
  let sum = 0;
  for (const s of ACTIVE_RAGDOLL_SEGMENTS) sum += ACTIVE_RAGDOLL_MASS_WEIGHT[s.name] ?? ACTIVE_RAGDOLL_MASS_WEIGHT_FALLBACK;
  if (sum <= 0) sum = 1;
  for (const s of ACTIVE_RAGDOLL_SEGMENTS) {
    ACTIVE_RAGDOLL_MASS_KG[s.name] =
      ((ACTIVE_RAGDOLL_MASS_WEIGHT[s.name] ?? ACTIVE_RAGDOLL_MASS_WEIGHT_FALLBACK) / sum) * ACTIVE_RAGDOLL_TOTAL_MASS_KG;
  }
}

type LimitsRad = { x: [number, number]; y: [number, number]; z: [number, number] };

// Rapier costruisce il frame angolare di un giunto generico dal solo asse
// passato (qui X del corpo) completandolo con una base ortonormale SUA --
// misurato dal vivo: e' ruotata di 90 gradi attorno a X rispetto al frame
// del personaggio (l'asse Y di Rapier e' la nostra Z e viceversa, con un
// segno). Senza questa rimappatura i motori di spalle/gomiti/anche
// inseguivano l'angolo giusto sull'asse sbagliato (la tabella lo mostrava
// chiaramente: attuale Y = animazione Z). Il frame vero si legge dal giunto
// (jointFrameX1) e si usa per convertire bersagli e limiti.
interface JointFrameMap {
  F: THREE.Quaternion; // frame del giunto nel frame del corpo
  Finv: THREE.Quaternion;
  // asse Rapier k -> asse del personaggio j, con segno
  axes: { j: number; sign: number }[];
}

interface BodyEntry {
  segment: RagdollSegment;
  body: RapierRigidBody;
  bone: THREE.Bone;
  // osso(mondo) = corpo(mondo) * bodyToBone
  bodyToBone: THREE.Quaternion;
  bodyFromBone: THREE.Quaternion;
  // collider nel frame del corpo
  capsuleOffset: THREE.Vector3;
  capsuleRot: THREE.Quaternion;
  radius: number;
  halfHeight: number;
  joint: ImpulseJoint | null;
  // limiti nel frame del personaggio (config/tabella) e gli stessi
  // rimappati sugli assi del frame del giunto Rapier (vedi JointFrameMap)
  limitsRad: LimitsRad | null;
  rapierLimitsRad: [number, number][] | null;
  // bersaglio animato (orientazione/posizione del CORPO) di questo frame
  targetQuat: THREE.Quaternion;
  targetPos: THREE.Vector3;
  targetLinVel: THREE.Vector3;
  targetAngVel: THREE.Vector3;
  targetValid: boolean;
  captureAt: number; // performance.now() della cattura del bersaglio
  // angoli del giunto chiesti dall'animazione (rad, prima del clamp ai
  // limiti) e quelli effettivamente mandati al motore
  targetJointAngles: THREE.Vector3;
  motorJointAngles: THREE.Vector3;
  prevMotorJointAngles: THREE.Vector3;
  motorAnglesValid: boolean;
  // 0 = motore pieno, 1 = motore spento; sale con un colpo e ricade a 0
  hitWeakness: number;
  // inerzia (kg*m^2) di tutto cio' che questo giunto muove, attorno al
  // perno -- scala rigidita'/smorzamento del motore (vedi
  // ACTIVE_RAGDOLL_JOINT_FREQ)
  subtreeInertia: number;
  // Posa ANIMATA locale dell'osso salvata prima che la fisica la
  // sovrascriva (vedi restoreActiveAnimationPose).
  animLocalQuat: THREE.Quaternion;
  animLocalPos: THREE.Vector3;
  animSaved: boolean;
}

export interface ActiveRagdollJointDebug {
  cur: [number, number, number]; // gradi
  target: [number, number, number]; // gradi (richiesta dell'animazione)
  limits: { x: [number, number]; y: [number, number]; z: [number, number] };
  targetOutside: boolean;
  atLimit: boolean;
}

export interface ActiveRagdollSegmentDebug {
  name: string;
  // posa mondo del collider FISICO
  x: number; y: number; z: number;
  qx: number; qy: number; qz: number; qw: number;
  // posa mondo del collider BERSAGLIO (dove l'animazione vuole il corpo)
  tx: number; ty: number; tz: number;
  tqx: number; tqy: number; tqz: number; tqw: number;
  hasTarget: boolean;
  radius: number;
  halfHeight: number;
  posErrCm: number;
  angErrDeg: number;
  hitWeakness: number;
  overLimit: boolean;
  joint: ActiveRagdollJointDebug | null;
  // prodotto scalare quaternione genitore/figlio (deve restare > 0)
  parentDot: number;
}

function toLimitsRad(name: string): LimitsRad {
  const d = ACTIVE_RAGDOLL_JOINT_LIMITS_DEG[name];
  const f = ACTIVE_RAGDOLL_JOINT_LIMIT_FALLBACK_DEG;
  const r = THREE.MathUtils.degToRad;
  const ax = (a?: [number, number]): [number, number] => (a ? [r(a[0]), r(a[1])] : [r(-f), r(f)]);
  return { x: ax(d?.x), y: ax(d?.y), z: ax(d?.z) };
}

export function useRagdollActive(
  modelRootRef: React.RefObject<THREE.Object3D | null>,
  resolveBones: () => Record<string, THREE.Bone> | null,
  // Proprietario dei collider per i proiettili (vedi shootableRegistry.ts)
  ownerId?: string
) {
  const { world, rapier } = useRapier();
  const activeBodiesRef = useRef<Record<string, BodyEntry>>({});
  const activeJointsRef = useRef<ImpulseJoint[]>([]);
  const bindRef = useRef<BindPoseSnapshot | null>(null);
  // Posa di riferimento (zero dei giunti): la guardia se e' stata data
  // una clip neutra (setNeutralClip), altrimenti la T-pose di bind.
  const refPoseRef = useRef<BindPoseSnapshot | null>(null);
  const neutralClipRef = useRef<THREE.AnimationClip | null>(null);
  const jointFrameRef = useRef<JointFrameMap | null>(null);
  const passiveRef = useRef(false);
  // handle del collider -> indice del segmento (solo i NOSTRI collider)
  const colliderIndexRef = useRef<Map<number, number>>(new Map());
  // coppie proprie escluse ora (statiche + compenetrate all'inizio del KO)
  const selfExcludedRef = useRef<Set<number>>(new Set());
  const selfPendingRef = useRef<Array<[number, number]>>([]);
  const hipsPinnedRef = useRef(false);
  const gravityScaleRef = useRef<number | null>(null);
  const activeRagdollWeightRef = useRef(ACTIVE_RAGDOLL_WEIGHT_MOVING);
  const builtNonceRef = useRef(0);
  // "Barcollamento" globale dopo un colpo (0..1): indebolisce per un
  // attimo TUTTO il corpo (servo del bacino compreso), non solo il
  // segmento colpito -- misurato: con i soli segmenti colpiti indeboliti
  // un colpo da 6 m/s in testa spostava la testa di 3-7 cm, perche' il
  // resto del corpo (75 kg) e il servo del bacino assorbivano e
  // annullavano subito l'impulso. Cosi' il corpo incassa davvero.
  const staggerRef = useRef(0);
  const effWeakness = (e: BodyEntry) =>
    Math.max(e.hitWeakness, staggerRef.current * (e.segment.parent ? 0.85 : 1));

  // scratch
  const s = useRef({
    v1: new THREE.Vector3(),
    v2: new THREE.Vector3(),
    v3: new THREE.Vector3(),
    q1: new THREE.Quaternion(),
    q2: new THREE.Quaternion(),
    q3: new THREE.Quaternion(),
    ang: new THREE.Vector3(),
    ang2: new THREE.Vector3(),
    q4: new THREE.Quaternion(),
    v4: new THREE.Vector3(),
  }).current;

  const hasRig = () => Object.keys(activeBodiesRef.current).length > 0;

  // ------------------------------------------------------------------ build
  const ensureActiveRagdoll = useCallback((): boolean => {
    if (Object.keys(activeBodiesRef.current).length > 0) return true;
    const bones = resolveBones();
    const root = modelRootRef.current;
    if (!bones || !root) return false;

    const names = new Set<string>(["thigh_l", "thigh_r", "pelvis"]);
    for (const seg of ACTIVE_RAGDOLL_SEGMENTS) {
      names.add(seg.drivingBone);
      names.add(seg.toBone);
    }
    const bind = captureBindPose(root, [...names]);
    if (!bind) return false;
    bindRef.current = bind;
    const ref =
      (neutralClipRef.current && captureClipPose(root, neutralClipRef.current, 0, [...names], bind)) || bind;
    refPoseRef.current = ref;
    const refInv = ref.refQuat.clone().invert();
    const yAxis = new THREE.Vector3(0, 1, 0);

    const entries: Record<string, BodyEntry> = {};
    for (const seg of ACTIVE_RAGDOLL_SEGMENTS) {
      const bone = bones[seg.drivingBone];
      const bFrom = bind.pos[seg.drivingBone];
      const bTo = bind.pos[seg.toBone];
      const bq = bind.quat[seg.drivingBone];
      const nq = ref.quat[seg.drivingBone];
      if (!bone || !bFrom || !bTo || !bq || !nq) continue;

      // Nella posa di riferimento tutti i corpi hanno orientazione ref.
      const bodyToBone = refInv.clone().multiply(nq);
      const bodyFromBone = bodyToBone.clone().invert();

      bone.getWorldPosition(s.v1);
      bone.getWorldQuaternion(s.q1);
      const bodyQuat = s.q1.clone().multiply(bodyFromBone);
      // Segno del quaternione coerente col genitore (dot >= 0): il solver
      // dei giunti di Rapier misura l'errore angolare sulle componenti
      // del quaternione relativo SENZA riportarlo nell'emisfero w >= 0 --
      // con un segno "sbagliato" (q e -q sono la stessa rotazione per
      // three.js, non per il motore) il motore spinge nella direzione
      // OPPOSTA e il giunto oscilla senza mai fermarsi (misurato: braccio
      // che ondeggiava per secondi anche con rigidita' x10).
      const parentEntryForSign = seg.parent ? entries[seg.parent] : undefined;
      if (parentEntryForSign) {
        const pr = parentEntryForSign.body.rotation();
        if (pr.x * bodyQuat.x + pr.y * bodyQuat.y + pr.z * bodyQuat.z + pr.w * bodyQuat.w < 0) {
          bodyQuat.set(-bodyQuat.x, -bodyQuat.y, -bodyQuat.z, -bodyQuat.w);
        }
      }

      // Direzione della capsula: vettore osso->osso nel frame dell'OSSO
      // (costante, misurato in bind), portato nel frame del corpo.
      const dirWorld = bTo.clone().sub(bFrom);
      const rawLen = dirWorld.length() || 0.05;
      const dirBody = dirWorld.normalize().applyQuaternion(bq.clone().invert()).applyQuaternion(bodyToBone);
      const length = Math.max(0.05, rawLen * (seg.lengthScale ?? 0.92));
      const halfHeight = Math.max(0.01, length / 2 - seg.radius);
      const capsuleRot = new THREE.Quaternion().setFromUnitVectors(yAxis, dirBody);
      const capsuleOffset = dirBody.clone().multiplyScalar(length / 2);

      const body = world.createRigidBody(
        rapier.RigidBodyDesc.dynamic()
          .setTranslation(s.v1.x, s.v1.y, s.v1.z)
          .setRotation({ x: bodyQuat.x, y: bodyQuat.y, z: bodyQuat.z, w: bodyQuat.w })
          .setLinearDamping(ALIVE_LINEAR_DAMPING)
          .setAngularDamping(ALIVE_ANGULAR_DAMPING)
      );
      const activeCollider = world.createCollider(
        rapier.ColliderDesc.capsule(halfHeight, seg.radius)
          .setTranslation(capsuleOffset.x, capsuleOffset.y, capsuleOffset.z)
          .setRotation({ x: capsuleRot.x, y: capsuleRot.y, z: capsuleRot.z, w: capsuleRot.w })
          .setCollisionGroups(ALIVE_COLLISION_GROUPS)
          .setFriction(ALIVE_FRICTION)
          .setMass(ACTIVE_RAGDOLL_MASS_KG[seg.name] ?? 1),
        body
      );
      if (ownerId) registerShootableCollider(activeCollider.handle, { ownerId, segment: seg.name });
      colliderIndexRef.current.set(activeCollider.handle, SEGMENT_INDEX[seg.name]);

      entries[seg.name] = {
        segment: seg,
        body,
        bone,
        bodyToBone,
        bodyFromBone,
        capsuleOffset,
        capsuleRot,
        radius: seg.radius,
        halfHeight,
        joint: null,
        limitsRad: null,
        rapierLimitsRad: null,
        targetQuat: bodyQuat.clone(),
        targetPos: s.v1.clone(),
        targetLinVel: new THREE.Vector3(),
        targetAngVel: new THREE.Vector3(),
        targetValid: false,
        captureAt: 0,
        targetJointAngles: new THREE.Vector3(),
        motorJointAngles: new THREE.Vector3(),
        prevMotorJointAngles: new THREE.Vector3(),
        motorAnglesValid: false,
        hitWeakness: 0,
        subtreeInertia: 0,
        animLocalQuat: new THREE.Quaternion(),
        animLocalPos: new THREE.Vector3(),
        animSaved: false,
      };
    }

    // Inerzia del sotto-albero di ogni giunto attorno al suo perno (posa
    // di bind): somma su ogni segmento discendente di m*(d^2 + L^2/12 +
    // r^2/2), con d = distanza del centro della capsula dal perno.
    {
      const centers: Record<string, { c: THREE.Vector3; m: number; own: number }> = {};
      for (const seg of ACTIVE_RAGDOLL_SEGMENTS) {
        const e = entries[seg.name];
        if (!e) continue;
        const from = ref.pos[seg.drivingBone];
        const to = ref.pos[seg.toBone];
        if (!from || !to) continue;
        const len = from.distanceTo(to) * (seg.lengthScale ?? 0.92);
        const c = to.clone().sub(from).normalize().multiplyScalar(len / 2).add(from);
        const m = ACTIVE_RAGDOLL_MASS_KG[seg.name] ?? 1;
        centers[seg.name] = { c, m, own: m * (len * len / 12 + seg.radius * seg.radius * 0.5) };
      }
      const isDescendant = (name: string, ancestor: string): boolean => {
        let cur: string | null = name;
        while (cur) {
          if (cur === ancestor) return true;
          cur = ACTIVE_RAGDOLL_SEGMENTS.find((x) => x.name === cur)?.parent ?? null;
        }
        return false;
      };
      for (const seg of ACTIVE_RAGDOLL_SEGMENTS) {
        const e = entries[seg.name];
        if (!e) continue;
        const pivot = ref.pos[seg.drivingBone];
        let inertia = 0;
        for (const other of ACTIVE_RAGDOLL_SEGMENTS) {
          const info = centers[other.name];
          if (!info || !isDescendant(other.name, seg.name)) continue;
          inertia += info.m * info.c.distanceToSquared(pivot) + info.own;
        }
        e.subtreeInertia = Math.max(1e-3, inertia);
      }
    }

    const created: BodyEntry[] = [];
    for (const seg of ACTIVE_RAGDOLL_SEGMENTS) {
      if (!seg.parent) continue;
      const e = entries[seg.name];
      const p = entries[seg.parent];
      if (!e || !p) continue;
      const parentPivot = ref.pos[p.segment.drivingBone];
      const childPivot = ref.pos[seg.drivingBone];
      const anchor1 = childPivot.clone().sub(parentPivot).applyQuaternion(refInv);
      const data = rapier.JointData.generic(
        { x: anchor1.x, y: anchor1.y, z: anchor1.z },
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
        LOCKED_LINEAR_AXES_MASK
      );
      if (!data) continue;
      const joint = world.createImpulseJoint(data, p.body, e.body, true);
      // genitore/figlio si toccano per costruzione al perno: mai contatti
      joint.setContactsEnabled(false);
      e.joint = joint;
      created.push(e);
      activeJointsRef.current.push(joint);
    }

    // Frame angolare reale dei giunti (uguale per tutti: stesso asse X).
    const F = new THREE.Quaternion();
    if (created.length) {
      const raw = (created[0].joint as any).rawSet;
      const rr = raw.jointFrameX1(created[0].joint!.handle);
      F.set(rr.x, rr.y, rr.z, rr.w).normalize();
      rr.free?.();
    }
    const el = new THREE.Matrix4().makeRotationFromQuaternion(F).elements;
    const axes = [0, 1, 2].map((k) => {
      const col = [el[4 * k], el[4 * k + 1], el[4 * k + 2]];
      let j = 0;
      for (let i = 1; i < 3; i++) if (Math.abs(col[i]) > Math.abs(col[j])) j = i;
      return { j, sign: col[j] >= 0 ? 1 : -1 };
    });
    jointFrameRef.current = { F, Finv: F.clone().invert(), axes };

    for (const e of created) {
      const joint = e.joint!;
      const raw = (joint as any).rawSet;
      const limits = toLimitsRad(e.segment.name);
      const my = [limits.x, limits.y, limits.z];
      const rl: [number, number][] = axes.map(({ j, sign }) =>
        sign > 0 ? [my[j][0], my[j][1]] : [-my[j][1], -my[j][0]]
      );
      for (let k = 0; k < 3; k++) {
        raw.jointSetLimits(joint.handle, RAW_AXIS_ANG[k], rl[k][0], rl[k][1]);
        raw.jointConfigureMotorModel(joint.handle, RAW_AXIS_ANG[k], MOTOR_MODEL_FORCE_BASED);
      }
      raw.jointSetContactsEnabled(joint.handle, false);
      e.limitsRad = limits;
      e.rapierLimitsRad = rl;
    }

    activeBodiesRef.current = entries;
    passiveRef.current = false;
    hipsPinnedRef.current = false;
    gravityScaleRef.current = null;
    builtNonceRef.current = useStore.getState().ragdollBench.rebuildNonce;
    return true;
  }, [rapier, world, resolveBones, modelRootRef, s, ownerId]);

  const destroyActiveRagdoll = useCallback(() => {
    for (const joint of activeJointsRef.current) {
      try {
        world.removeImpulseJoint(joint, true);
      } catch {
        /* gia' rimosso insieme al corpo */
      }
    }
    activeJointsRef.current = [];
    colliderIndexRef.current.clear();
    selfPendingRef.current = [];
    passiveRef.current = false;
    for (const key of Object.keys(activeBodiesRef.current)) {
      try {
        const b = activeBodiesRef.current[key].body;
        for (let i = 0; i < b.numColliders(); i++) unregisterShootableCollider(b.collider(i).handle);
        world.removeRigidBody(b);
      } catch {
        /* mondo gia' distrutto */
      }
    }
    activeBodiesRef.current = {};
    activeRagdollWeightRef.current = ACTIVE_RAGDOLL_WEIGHT_MOVING;
  }, [world]);

  // --------------------------------------------------- bersagli animazione
  // Va chiamata DOPO mixer.update() (o skeleton.pose() in T-pose) e PRIMA
  // che syncActiveBonesBlended sovrascriva le ossa con la fisica.
  const captureActiveTargets = useCallback((delta: number) => {
    const entries = activeBodiesRef.current;
    for (const key of Object.keys(entries)) {
      const e = entries[key];
      e.bone.getWorldPosition(s.v1);
      e.bone.getWorldQuaternion(s.q1);
      s.q1.multiply(e.bodyFromBone);
      if (e.targetValid && delta > 1e-4) {
        e.targetLinVel.copy(s.v1).sub(e.targetPos).divideScalar(delta);
        // velocita' angolare mondo da q_prev -> q_now
        s.q2.copy(s.q1).multiply(s.q3.copy(e.targetQuat).invert());
        if (s.q2.w < 0) s.q2.set(-s.q2.x, -s.q2.y, -s.q2.z, -s.q2.w);
        const sinHalf = Math.sqrt(s.q2.x * s.q2.x + s.q2.y * s.q2.y + s.q2.z * s.q2.z);
        if (sinHalf > 1e-8) {
          const angle = 2 * Math.atan2(sinHalf, s.q2.w);
          e.targetAngVel.set(s.q2.x, s.q2.y, s.q2.z).multiplyScalar(angle / sinHalf / delta);
        } else {
          e.targetAngVel.set(0, 0, 0);
        }
        // un salto enorme (teletrasporto, cambio posa istantaneo) non e'
        // una velocita' da inseguire -- soglie alte: un gancio ruota il
        // bacino a ~17 rad/s e le braccia ben oltre.
        if (e.targetLinVel.lengthSq() > 30 * 30) e.targetLinVel.set(0, 0, 0);
        if (e.targetAngVel.lengthSq() > 80 * 80) e.targetAngVel.set(0, 0, 0);
      } else {
        e.targetLinVel.set(0, 0, 0);
        e.targetAngVel.set(0, 0, 0);
      }
      e.targetPos.copy(s.v1);
      e.targetQuat.copy(s.q1);
      e.targetValid = true;
      e.captureAt = performance.now();
    }
  }, [s]);

  // ------------------------------------------------- auto-collisione da KO
  // Inizio KO: esclusioni statiche + coppie che in questo istante si
  // compenetrano gia' (verranno riattivate quando si separano).
  const beginSelfCollision = () => {
    const entries = activeBodiesRef.current;
    const excluded = selfExcludedRef.current;
    excluded.clear();
    for (const k of SELF_STATIC_EXCLUDED) excluded.add(k);
    const pending: Array<[number, number]> = [];
    const list = Object.values(entries).filter((e) => e.body.numColliders() > 0);
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = SEGMENT_INDEX[list[i].segment.name], b = SEGMENT_INDEX[list[j].segment.name];
        const key = pairKey(a, b);
        if (excluded.has(key)) continue;
        const c = list[i].body.collider(0).contactCollider(list[j].body.collider(0), SELF_OVERLAP_M);
        if (c && c.distance < SELF_OVERLAP_M) {
          excluded.add(key);
          pending.push([a, b]);
        }
      }
    }
    selfPendingRef.current = pending;
  };

  // Durante il KO: le coppie escluse all'inizio tornano a collidere appena
  // si sono separate.
  const updateSelfCollision = () => {
    const pending = selfPendingRef.current;
    if (!pending.length) return;
    const entries = activeBodiesRef.current;
    const segs = ACTIVE_RAGDOLL_SEGMENTS;
    for (let i = pending.length - 1; i >= 0; i--) {
      const [a, b] = pending[i];
      const ea = entries[segs[a].name], eb = entries[segs[b].name];
      if (!ea || !eb) continue;
      const c = ea.body.collider(0).contactCollider(eb.body.collider(0), SELF_RELEASE_M);
      if (!c) {
        selfExcludedRef.current.delete(pairKey(a, b));
        pending.splice(i, 1);
      }
    }
  };

  // DEV: misure di compenetrazione dal browser (window.__activeRagdolls)
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const reg = ((window as any).__activeRagdolls ??= {});
    const key = ownerId ?? `rig${Math.random().toString(36).slice(2, 7)}`;
    reg[key] = {
      world,
      rapier,
      entries: () => activeBodiesRef.current,
      passive: () => passiveRef.current,
      excluded: () => selfExcludedRef.current,
      pending: () => selfPendingRef.current,
      index: SEGMENT_INDEX,
      pairKey,
    };
    return () => { delete reg[key]; };
  }, [world, rapier, ownerId]);

  useFilterContactPair((c1, c2) => {
    const own = colliderIndexRef.current;
    const a = own.get(c1);
    const b = own.get(c2);
    if (a === undefined && b === undefined) return null; // non e' nostro
    if (a !== undefined && b !== undefined && selfExcludedRef.current.has(pairKey(a, b))) {
      return rapier.SolverFlags.EMPTY;
    }
    return rapier.SolverFlags.COMPUTE_IMPULSE;
  });

  // ------------------------------------------------------ modalita' e motori
  const setMode = useCallback((passive: boolean, pinHips: boolean, aliveGravity: number) => {
    const entries = activeBodiesRef.current;
    const gravity = passive ? 1 : aliveGravity;
    const modeChanged = passive !== passiveRef.current;
    if (modeChanged || gravityScaleRef.current !== gravity) {
      for (const key of Object.keys(entries)) {
        const b = entries[key].body;
        b.setGravityScale(gravity, true);
        b.setLinearDamping(passive ? PASSIVE_LINEAR_DAMPING : ALIVE_LINEAR_DAMPING);
        b.setAngularDamping(passive ? PASSIVE_ANGULAR_DAMPING : ALIVE_ANGULAR_DAMPING);
        if (b.numColliders() > 0) {
          const col = b.collider(0);
          col.setFriction(passive ? PASSIVE_FRICTION : ALIVE_FRICTION);
          col.setCollisionGroups(passive ? PASSIVE_COLLISION_GROUPS : ALIVE_COLLISION_GROUPS);
          // filtro coppie (auto-collisione, vedi useFilterContactPair sotto)
          col.setActiveHooks(passive ? rapier.ActiveHooks.FILTER_CONTACT_PAIRS : 0);
        }
        if (PASSIVE_CCD) b.enableCcd(passive);
      }
      if (modeChanged && passive) beginSelfCollision();
      gravityScaleRef.current = gravity;
      passiveRef.current = passive;
    }
    const wantPinned = pinHips && !passive;
    const hips = entries.Hips;
    if (hips && wantPinned !== hipsPinnedRef.current) {
      hips.body.setBodyType(
        wantPinned ? rapier.RigidBodyType.KinematicPositionBased : rapier.RigidBodyType.Dynamic,
        true
      );
      if (!wantPinned) {
        hips.body.setGravityScale(gravity, true);
      }
      hipsPinnedRef.current = wantPinned;
    }
  }, [rapier]);

  const driveActiveRagdoll = useCallback((delta: number, passive: boolean) => {
    const entries = activeBodiesRef.current;
    const bench = useStore.getState().ragdollBench;
    setMode(passive, bench.pinHips, bench.aliveGravityScale);
    if (passive) updateSelfCollision();
    const decay = delta / Math.max(0.05, ACTIVE_RAGDOLL_HIT_RECOVERY_S);
    staggerRef.current = Math.max(0, staggerRef.current - delta / Math.max(0.05, ACTIVE_RAGDOLL_HIT_RECOVERY_S * 1.25));

    for (const key of Object.keys(entries)) {
      const e = entries[key];
      e.hitWeakness = Math.max(0, e.hitWeakness - decay);
      if (!e.joint || !e.limitsRad || !e.segment.parent) continue;
      const p = entries[e.segment.parent];
      if (!p) continue;
      const raw = (e.joint as any).rawSet;
      const h = e.joint.handle;

      if (passive) {
        const friction = ACTIVE_RAGDOLL_PASSIVE_JOINT_FRICTION * e.subtreeInertia;
        for (let k = 0; k < 3; k++) {
          raw.jointConfigureMotor(h, RAW_AXIS_ANG[k], 0, 0, 0, friction);
        }
        e.motorAnglesValid = false;
        continue;
      }
      if (!e.targetValid || !p.targetValid) continue;

      s.q1.copy(p.targetQuat).invert().multiply(e.targetQuat);
      jointAxisAngles(s.q1, e.targetJointAngles); // frame del personaggio (tabella)
      const jf = jointFrameRef.current;
      if (jf) s.q1.premultiply(jf.Finv).multiply(jf.F); // -> frame del giunto Rapier
      jointAxisAngles(s.q1, s.ang2);
      const rl = e.rapierLimitsRad ?? [[-Math.PI, Math.PI], [-Math.PI, Math.PI], [-Math.PI, Math.PI]];
      const clampAxis = (v: number, l: [number, number]) =>
        Math.min(l[1] - TARGET_LIMIT_MARGIN_RAD, Math.max(l[0] + TARGET_LIMIT_MARGIN_RAD, v));
      e.motorJointAngles.set(clampAxis(s.ang2.x, rl[0]), clampAxis(s.ang2.y, rl[1]), clampAxis(s.ang2.z, rl[2]));

      // Molla/smorzatore "force based" in unita' fisiche, dalla pulsazione
      // voluta e dall'inerzia del sotto-albero: k = 2*w^2*I (il fattore 2
      // perche' Rapier misura l'errore come sin(angolo/2)), c = 2*z*w*I.
      // Verificato su un giunto isolato: w=25 -> bersaglio raggiunto in
      // ~0.1s senza rimbalzo.
      const freq = (ACTIVE_RAGDOLL_JOINT_FREQ[e.segment.name] ?? ACTIVE_RAGDOLL_JOINT_FREQ_DEFAULT) *
        Math.sqrt(Math.max(0.01, bench.stiffnessMul * (1 - 0.97 * effWeakness(e))));
      const I = e.subtreeInertia;
      const k = 2 * freq * freq * I;
      const c = 2 * bench.dampingRatio * freq * I + ACTIVE_RAGDOLL_PASSIVE_JOINT_FRICTION * I;
      const vel = [0, 0, 0];
      if (bench.motorFeedForward && e.motorAnglesValid && delta > 1e-4) {
        vel[0] = (e.motorJointAngles.x - e.prevMotorJointAngles.x) / delta;
        vel[1] = (e.motorJointAngles.y - e.prevMotorJointAngles.y) / delta;
        vel[2] = (e.motorJointAngles.z - e.prevMotorJointAngles.z) / delta;
        for (let i = 0; i < 3; i++) vel[i] = Math.max(-MAX_TARGET_JOINT_SPEED, Math.min(MAX_TARGET_JOINT_SPEED, vel[i]));
      }
      // Il passo di fisica di @react-three/rapier gira PRIMA di questo
      // useFrame: i bersagli di questo frame verranno usati al passo del
      // frame SUCCESSIVO. Si anticipa quindi il bersaglio di un frame con
      // la sua velocita' (misurato: con un gancio il bacino ruota a quasi
      // 1000 gradi/s -> un frame di ritardo = 16 gradi di errore).
      const ahead = bench.motorFeedForward ? Math.min(delta, 0.05) : 0;
      const tgt = [
        clampAxis(e.motorJointAngles.x + vel[0] * ahead, rl[0]),
        clampAxis(e.motorJointAngles.y + vel[1] * ahead, rl[1]),
        clampAxis(e.motorJointAngles.z + vel[2] * ahead, rl[2]),
      ];
      for (let a = 0; a < 3; a++) {
        raw.jointConfigureMotor(h, RAW_AXIS_ANG[a], tgt[a], vel[a], k, c);
      }
      e.prevMotorJointAngles.copy(e.motorJointAngles);
      e.motorAnglesValid = true;
    }
  }, [setMode, s]);

  // Bacino: servo di velocita' verso posizione/orientamento mondo
  // dell'animazione, ad OGNI passo di fisica (1/120s) -- indipendente dal
  // frame rate. Con feed-forward della velocita' dell'animazione il
  // bacino non resta indietro nemmeno in corsa.
  // Bersaglio (posizione/orientamento del corpo) anticipato al momento
  // di questo passo: il passo di fisica di @react-three/rapier gira PRIMA
  // dell'useFrame del combattente, quindi usa il bersaglio catturato nel
  // frame precedente (misurato: col gancio il bacino ruota a quasi 1000
  // gradi/s -> un frame di ritardo = 16 gradi).
  const extrapolateTarget = (e: BodyEntry, now: number, outPos: THREE.Vector3, outQuat: THREE.Quaternion) => {
    const ahead = Math.min(0.05, Math.max(0, (now - e.captureAt) / 1000));
    outPos.copy(e.targetLinVel).multiplyScalar(ahead).add(e.targetPos);
    const wl = e.targetAngVel.length();
    if (wl > 1e-6) {
      outQuat.setFromAxisAngle(s.v4.copy(e.targetAngVel).divideScalar(wl), wl * ahead).multiply(e.targetQuat);
    } else {
      outQuat.copy(e.targetQuat);
    }
  };

  // Errore d'orientamento mondo (asse*angolo, emisfero corto) da q_cur a
  // q_target, scritto in out.
  const orientationError = (target: THREE.Quaternion, cur: { x: number; y: number; z: number; w: number }, out: THREE.Vector3) => {
    s.q2.set(cur.x, cur.y, cur.z, cur.w).invert();
    s.q3.copy(target).multiply(s.q2);
    if (s.q3.w < 0) s.q3.set(-s.q3.x, -s.q3.y, -s.q3.z, -s.q3.w);
    const sinHalf = Math.sqrt(s.q3.x * s.q3.x + s.q3.y * s.q3.y + s.q3.z * s.q3.z);
    const angle = 2 * Math.atan2(sinHalf, s.q3.w);
    const kk = sinHalf > 1e-8 ? angle / sinHalf : 2;
    out.set(s.q3.x * kk, s.q3.y * kk, s.q3.z * kk);
    return out;
  };

  // Ad ogni passo di fisica (1/120s):
  //  1. bacino: servo di velocita' verso posizione/orientamento mondo
  //     dell'animazione (con feed-forward), applicato come moto RIGIDO a
  //     tutto il ragdoll -- oppure bacino cinematico se "ancorato";
  //  2. ogni altro segmento: un servo d'orientamento MONDO piu' morbido
  //     (bench.worldDriveFreq) in aggiunta ai motori dei giunti. Motivo,
  //     misurato col gancio: i motori dei giunti inseguono ciascuno solo
  //     l'angolo RELATIVO al genitore, e con la parte alta del corpo che
  //     frusta (bacino che ruota a 1000 gradi/s, braccia che accelerano)
  //     gli errori piccoli di ogni giunto si SOMMANO lungo la catena
  //     (bacino->busto->spina->clavicola->braccio: 50-60 gradi di errore in
  //     cima anche con giunti a 10-20). Il servo mondo tira ogni corpo
  //     direttamente verso dove l'animazione lo vuole nel mondo, senza
  //     accumulo. Indebolito come i motori quando il segmento e' colpito.
  useBeforePhysicsStep((w) => {
    const entries = activeBodiesRef.current;
    const hips = entries.Hips;
    if (!hips || !hips.targetValid || passiveRef.current) return;
    const bench = useStore.getState().ragdollBench;
    const dt = (w as any).timestep ?? 1 / 120;
    const now = performance.now();
    const tp = s.v3;
    const tq = s.q1;
    extrapolateTarget(hips, now, tp, tq);

    if (hipsPinnedRef.current) {
      hips.body.setNextKinematicTranslation({ x: tp.x, y: tp.y, z: tp.z });
      const cr0 = hips.body.rotation();
      const sgn = cr0.x * tq.x + cr0.y * tq.y + cr0.z * tq.z + cr0.w * tq.w < 0 ? -1 : 1; // continuita' del segno
      hips.body.setNextKinematicRotation({ x: tq.x * sgn, y: tq.y * sgn, z: tq.z * sgn, w: tq.w * sgn });
    } else {
      // Quadratico: con un colpo pieno il servo del bacino si spegne quasi
      // del tutto per un attimo (il corpo deve poter essere spinto via).
      const strength = (1 - effWeakness(hips)) ** 2;
      const kp = ACTIVE_RAGDOLL_HIPS_POS_STIFFNESS * strength;
      const cp = 2 * Math.sqrt(kp);
      const kr = ACTIVE_RAGDOLL_HIPS_ROT_STIFFNESS * strength;
      const cr = 2 * Math.sqrt(kr);
      const b = hips.body;
      const t = b.translation();
      const v = b.linvel();
      const tv = hips.targetLinVel;
      const ta = hips.targetAngVel;
      const dvx = (kp * (tp.x - t.x) + cp * (tv.x - v.x)) * dt;
      const dvy = (kp * (tp.y - t.y) + cp * (tv.y - v.y)) * dt;
      const dvz = (kp * (tp.z - t.z) + cp * (tv.z - v.z)) * dt;
      const err = orientationError(tq, b.rotation(), s.ang);
      const av = b.angvel();
      const dwx = (kr * err.x + cr * (ta.x - av.x)) * dt;
      const dwy = (kr * err.y + cr * (ta.y - av.y)) * dt;
      const dwz = (kr * err.z + cr * (ta.z - av.z)) * dt;
      // Moto RIGIDO a tutto il ragdoll (traslazione + rotazione attorno al
      // bacino), non al solo bacino: spingendo solo il bacino il resto del
      // corpo "diluisce" la correzione (15 kg contro 75) e il corpo intero
      // ondeggia lento (misurato: errore medio 15->36->6 gradi per oltre
      // un secondo dopo un cambio di posa). Un moto rigido non eccita
      // nessun modo interno dei giunti.
      for (const key of Object.keys(entries)) {
        const body = entries[key].body;
        const bt = body.translation();
        const rx = bt.x - t.x, ry = bt.y - t.y, rz = bt.z - t.z;
        const bv = body.linvel();
        const bw = body.angvel();
        body.setLinvel(
          {
            x: bv.x + dvx + (dwy * rz - dwz * ry),
            y: bv.y + dvy + (dwz * rx - dwx * rz),
            z: bv.z + dvz + (dwx * ry - dwy * rx),
          },
          true
        );
        body.setAngvel({ x: bw.x + dwx, y: bw.y + dwy, z: bw.z + dwz }, true);
      }
    }

    const f = bench.worldDriveFreq;
    if (f > 0) {
      for (const key of Object.keys(entries)) {
        const e = entries[key];
        if (!e.segment.parent || !e.targetValid) continue;
        const strength = (1 - effWeakness(e)) ** 2;
        const k = f * f * strength;
        const c = 2 * f * Math.sqrt(strength);
        extrapolateTarget(e, now, s.v1, s.q4);
        const err = orientationError(s.q4, e.body.rotation(), s.ang2);
        const av = e.body.angvel();
        const ta = e.targetAngVel;
        e.body.setAngvel(
          {
            x: av.x + (k * err.x + c * (ta.x - av.x)) * dt,
            y: av.y + (k * err.y + c * (ta.y - av.y)) * dt,
            z: av.z + (k * err.z + c * (ta.z - av.z)) * dt,
          },
          true
        );
        // Anche la parte LINEARE: molla+smorzatore verso posizione e
        // velocita' del perno animato. Gli arti che frustano (gancio)
        // restano indietro soprattutto in POSIZIONE (la mano gira attorno
        // al corpo), che un servo solo angolare non puo' correggere.
        const t = e.body.translation();
        const lv = e.body.linvel();
        const tv = e.targetLinVel;
        e.body.setLinvel(
          {
            x: lv.x + (k * (s.v1.x - t.x) + c * (tv.x - lv.x)) * dt,
            y: lv.y + (k * (s.v1.y - t.y) + c * (tv.y - lv.y)) * dt,
            z: lv.z + (k * (s.v1.z - t.z) + c * (tv.z - lv.z)) * dt,
          },
          true
        );
      }
    }
  });

  // ----------------------------------------------------------------- colpi
  const applyActiveHit = useCallback(
    (segmentName: string, dirWorld: THREE.Vector3, speed: number, pointWorld?: THREE.Vector3): boolean => {
      const entries = activeBodiesRef.current;
      const e = entries[segmentName] ?? entries.Torso;
      // anche da passivo/KO: un proiettile su un corpo a terra lo sposta
      if (!e) return false;
      const dir = s.v3.copy(dirWorld);
      if (dir.lengthSq() < 1e-8) return false;
      dir.normalize().multiplyScalar(speed * e.body.mass());
      if (pointWorld) {
        e.body.applyImpulseAtPoint({ x: dir.x, y: dir.y, z: dir.z }, { x: pointWorld.x, y: pointWorld.y, z: pointWorld.z }, true);
      } else {
        e.body.applyImpulse({ x: dir.x, y: dir.y, z: dir.z }, true);
      }
      // Indebolimento: colpito quasi molle, genitori e figli via via meno.
      const weaken = (name: string | null, amount: number) => {
        if (!name) return;
        const x = entries[name];
        if (x) x.hitWeakness = Math.max(x.hitWeakness, amount);
      };
      weaken(e.segment.name, 0.9);
      staggerRef.current = Math.max(staggerRef.current, Math.min(1, speed / 10));
      let parent = e.segment.parent;
      let amount = 0.65;
      while (parent && amount > 0.1) {
        weaken(parent, amount);
        parent = entries[parent]?.segment.parent ?? null;
        amount *= 0.55;
      }
      for (const key of Object.keys(entries)) {
        if (entries[key].segment.parent === e.segment.name) weaken(key, 0.6);
      }
      return true;
    },
    [s]
  );

  // ------------------------------------------------------ fisica -> ossa
  const syncActiveBonesBlended = useCallback((delta: number, isIdle: boolean, overrideWeight?: number) => {
    const bench = useStore.getState().ragdollBench;
    let weight: number;
    if (overrideWeight !== undefined || bench.physicsOnlyRender) {
      weight = bench.physicsOnlyRender ? 1 : (overrideWeight as number);
      activeRagdollWeightRef.current = weight;
    } else {
      const targetWeight = isIdle ? ACTIVE_RAGDOLL_WEIGHT_IDLE : ACTIVE_RAGDOLL_WEIGHT_MOVING;
      const rate = Math.min(1, Math.max(0, delta) * ACTIVE_RAGDOLL_WEIGHT_SMOOTH_RATE);
      activeRagdollWeightRef.current += (targetWeight - activeRagdollWeightRef.current) * rate;
      weight = activeRagdollWeightRef.current;
    }
    // Durante un colpo il modello mostra la fisica (anche se si sta
    // muovendo e il blend normale darebbe piu' peso all'animazione),
    // altrimenti l'incasso si vedrebbe solo a meta'.
    weight = Math.max(weight, staggerRef.current);
    if (weight <= 0.001) return;
    const entries = activeBodiesRef.current;
    let first = true;
    for (const seg of ACTIVE_RAGDOLL_SEGMENTS) {
      const e = entries[seg.name];
      if (!e) continue;
      const bone = e.bone;
      const parent = bone.parent;
      if (!parent) continue;
      if (first) {
        parent.updateWorldMatrix(true, false);
        first = false;
      }
      e.animLocalQuat.copy(bone.quaternion);
      e.animLocalPos.copy(bone.position);
      e.animSaved = true;
      const r = e.body.rotation();
      s.q1.set(r.x, r.y, r.z, r.w).multiply(e.bodyToBone); // osso mondo
      parent.getWorldQuaternion(s.q2);
      s.q2.invert().multiply(s.q1); // osso locale
      bone.quaternion.slerp(s.q2, weight);
      if (!seg.parent) {
        const t = e.body.translation();
        s.v1.set(t.x, t.y, t.z);
        parent.worldToLocal(s.v1);
        bone.position.lerp(s.v1, weight);
      }
      bone.updateWorldMatrix(false, false);
    }
  }, [s]);

  // "si muove tantissimo" (seconda causa, misurata dal vivo): se in un
  // frame NESSUNA azione del mixer scrive un certo osso (clip finita,
  // azione fermata, dissolvenza a peso zero...), three.js lascia l'osso
  // com'era -- cioe' con la posa FISICA scritta al frame prima. Il
  // bersaglio del frame dopo diventava quindi la fisica stessa: un anello
  // di retroazione in cui il corpo insegue se stesso e deriva fino ai
  // limiti (misurato: bacino-spina che vagava 10-43 gradi mentre
  // l'animazione pura stava ferma a 29.6). Va chiamata a INIZIO frame,
  // prima di mixer.update(): rimette nelle ossa la posa animata salvata,
  // cosi' il bersaglio e' sempre l'animazione e mai la fisica.
  const restoreActiveAnimationPose = useCallback(() => {
    const entries = activeBodiesRef.current;
    for (const key of Object.keys(entries)) {
      const e = entries[key];
      if (!e.animSaved) continue;
      e.bone.quaternion.copy(e.animLocalQuat);
      e.bone.position.copy(e.animLocalPos);
    }
  }, []);

  const resyncActiveRagdollToBones = useCallback(() => {
    const entries = activeBodiesRef.current;
    for (const seg of ACTIVE_RAGDOLL_SEGMENTS) {
      const e = entries[seg.name];
      if (!e) continue;
      e.bone.getWorldPosition(s.v1);
      e.bone.getWorldQuaternion(s.q1).multiply(e.bodyFromBone);
      // stesso vincolo di segno del build (vedi ensureActiveRagdoll)
      const ref = seg.parent && entries[seg.parent] ? entries[seg.parent].body.rotation() : e.body.rotation();
      if (ref.x * s.q1.x + ref.y * s.q1.y + ref.z * s.q1.z + ref.w * s.q1.w < 0) {
        s.q1.set(-s.q1.x, -s.q1.y, -s.q1.z, -s.q1.w);
      }
      e.body.setTranslation({ x: s.v1.x, y: s.v1.y, z: s.v1.z }, true);
      e.body.setRotation({ x: s.q1.x, y: s.q1.y, z: s.q1.z, w: s.q1.w }, true);
      e.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      e.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      e.motorAnglesValid = false;
      e.hitWeakness = 0;
      staggerRef.current = 0;
    }
  }, [s]);

  const checkActiveRagdollRunaway = useCallback((): boolean => {
    const entries = activeBodiesRef.current;
    for (const key of Object.keys(entries)) {
      const e = entries[key];
      const t = e.body.translation();
      const lv = e.body.linvel();
      if (![t.x, t.y, t.z, lv.x, lv.y, lv.z].every(Number.isFinite)) return true;
    }
    const hips = entries.Hips;
    if (hips && hips.targetValid && !passiveRef.current) {
      const t = hips.body.translation();
      const dx = t.x - hips.targetPos.x, dy = t.y - hips.targetPos.y, dz = t.z - hips.targetPos.z;
      if (dx * dx + dy * dy + dz * dz > RUNAWAY_DISTANCE_M * RUNAWAY_DISTANCE_M) return true;
    }
    return false;
  }, []);

  // Ricostruzione su richiesta dal banco (parametri che valgono al build).
  const rebuildIfRequested = useCallback(() => {
    const nonce = useStore.getState().ragdollBench.rebuildNonce;
    if (hasRig() && nonce !== builtNonceRef.current) {
      destroyActiveRagdoll();
      ensureActiveRagdoll();
    }
  }, [destroyActiveRagdoll, ensureActiveRagdoll]);

  // ----------------------------------------------------------------- debug
  const getActiveRagdollDebugSegments = useCallback((): ActiveRagdollSegmentDebug[] => {
    const entries = activeBodiesRef.current;
    const out: ActiveRagdollSegmentDebug[] = [];
    const deg = THREE.MathUtils.radToDeg;
    for (const seg of ACTIVE_RAGDOLL_SEGMENTS) {
      const e = entries[seg.name];
      if (!e) continue;
      const t = e.body.translation();
      const r = e.body.rotation();
      s.q1.set(r.x, r.y, r.z, r.w);
      // collider fisico
      s.v1.copy(e.capsuleOffset).applyQuaternion(s.q1).add(s.v2.set(t.x, t.y, t.z));
      s.q2.copy(s.q1).multiply(e.capsuleRot);
      // collider bersaglio
      s.v3.copy(e.capsuleOffset).applyQuaternion(e.targetQuat).add(e.targetPos);
      s.q3.copy(e.targetQuat).multiply(e.capsuleRot);
      const posErrCm = e.targetValid ? s.v1.distanceTo(s.v3) * 100 : 0;
      const dot = Math.min(1, Math.abs(s.q1.dot(e.targetQuat)));
      const angErrDeg = e.targetValid ? deg(2 * Math.acos(dot)) : 0;

      let joint: ActiveRagdollJointDebug | null = null;
      let overLimit = false;
      let parentDot = 1;
      if (seg.parent && entries[seg.parent]) {
        const pr = entries[seg.parent].body.rotation();
        parentDot = pr.x * r.x + pr.y * r.y + pr.z * r.z + pr.w * r.w;
      }
      if (e.limitsRad && seg.parent && entries[seg.parent]) {
        const pr = entries[seg.parent].body.rotation();
        const relq = new THREE.Quaternion(pr.x, pr.y, pr.z, pr.w).invert().multiply(s.q1);
        jointAxisAngles(relq, s.ang);
        const L = e.limitsRad;
        const tol = THREE.MathUtils.degToRad(2);
        const outside = (v: number, l: [number, number], m: number) => v < l[0] - m || v > l[1] + m;
        overLimit = outside(s.ang.x, L.x, tol) || outside(s.ang.y, L.y, tol) || outside(s.ang.z, L.z, tol);
        const ta = e.targetJointAngles;
        joint = {
          cur: [deg(s.ang.x), deg(s.ang.y), deg(s.ang.z)],
          target: [deg(ta.x), deg(ta.y), deg(ta.z)],
          limits: {
            x: [deg(L.x[0]), deg(L.x[1])],
            y: [deg(L.y[0]), deg(L.y[1])],
            z: [deg(L.z[0]), deg(L.z[1])],
          },
          targetOutside: outside(ta.x, L.x, 0) || outside(ta.y, L.y, 0) || outside(ta.z, L.z, 0),
          atLimit: overLimit,
        };
      }
      out.push({
        name: seg.name,
        x: s.v1.x, y: s.v1.y, z: s.v1.z,
        qx: s.q2.x, qy: s.q2.y, qz: s.q2.z, qw: s.q2.w,
        tx: s.v3.x, ty: s.v3.y, tz: s.v3.z,
        tqx: s.q3.x, tqy: s.q3.y, tqz: s.q3.z, tqw: s.q3.w,
        hasTarget: e.targetValid,
        radius: e.radius,
        halfHeight: e.halfHeight,
        posErrCm,
        angErrDeg,
        hitWeakness: effWeakness(e),
        overLimit,
        joint,
        parentDot,
      });
    }
    return out;
  }, [s]);

  const measureClipRanges = useCallback(
    (clips: THREE.AnimationClip[]): { all: Record<string, JointRange>; perClip: Record<string, Record<string, JointRange>> } | null => {
      const root = modelRootRef.current;
      if (!root) return null;
      const ref = refPoseRef.current;
      if (!ref) return null; // il rig va costruito prima (stessa posa di riferimento dei giunti)
      return measureClipJointRanges(root, clips, ACTIVE_RAGDOLL_SEGMENTS, ref);
    },
    [modelRootRef]
  );

  useEffect(
    () => () => {
      destroyActiveRagdoll();
    },
    [destroyActiveRagdoll]
  );

  return {
    activeBodiesRef,
    ensureActiveRagdoll,
    destroyActiveRagdoll,
    rebuildIfRequested,
    captureActiveTargets,
    driveActiveRagdoll,
    syncActiveBonesBlended,
    restoreActiveAnimationPose,
    resyncActiveRagdollToBones,
    checkActiveRagdollRunaway,
    applyActiveHit,
    getActiveRagdollDebugSegments,
    measureClipRanges,
    isActiveRagdollPassive: () => passiveRef.current,
    setNeutralClip: (clip: THREE.AnimationClip | null) => {
      neutralClipRef.current = clip;
    },
  };
}
